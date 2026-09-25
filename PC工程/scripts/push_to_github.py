#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
push_to_github.py —— 通过 Git Data API 单次原子提交整个 PC 工程
=================================================================

为什么用 Git Data API 而不是 contents API：
  contents API 每个文件一次请求，660 个文件要 660 次往返，既慢又容易触发限流，
  而且会产生 660 个 commit。Git Data API 的做法是：
      ① 为每个文件创建 blob
      ② 用这些 blob 构建一棵 tree（可指定 base_tree 做增量）
      ③ 创建一个指向该 tree 的 commit
      ④ 把 ref 移到新 commit
  最终只有 1 个 commit，且可以通过 base_tree 精确控制"哪些没变"。

用法：
    python3 push_to_github.py --dry-run     # 只列出将要提交的文件
    python3 push_to_github.py               # 真正推送
=================================================================
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

TOKEN = os.environ.get("GH_TOKEN", "").strip()
OWNER = "stellarissss"
REPO = "Chinese-BookTitleLibrary"
BRANCH = "main"
PREFIX = "混在日本PC单机版/PC工程"      # 在仓库中的落点
SRC = "/root/.codebuddy/artifact/pc"

API = "https://cors.isteed.cc/https://api.github.com"

# 不推送的东西
EXCLUDE_DIRS = {"node_modules", ".git", "dist", "__pycache__", ".cache"}
EXCLUDE_FILES = {"package-lock.json", ".DS_Store", "Thumbs.db"}

COMMIT_MSG = """feat: 《混在日本》PC 单机版 —— 完整离线化工程

将 Android 版《混在日本》（日本版，仅主游戏）迁移为 Windows 离线单机版。
游戏过程完全脱离云端服务，所有逻辑在本地实现。

## 架构
- Electron 33.4.11 (Chromium 130) 外壳
- 原版 hun_min.js 字节级不变，全部改造以运行时猴补丁叠加
- 通过 Git Data API 原子提交

## 已实现
- 资源全部本地化（645 个文件，37 MB）
- 存档改为本地文件（Windows 原生 KV + localStorage 双写）
- AJAX / XHR / fetch / WebSocket 全局拦截，外网请求归零
- 模块裁剪：社团、FC 小游戏、艺妓、黑金小游戏、排行榜、众筹、内购
- 初始混币 20000，现金 3000
- 预留微信支付框架
- 9:16 竖屏窗口，自适应屏幕高度

## 构建
Linux 下可零 wine 构建 Windows 安装包，详见 BUILD.md。
"""


def req(method, path, payload=None, retries=3):
    url = path if path.startswith("http") else API + path
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {
        "Authorization": "token " + TOKEN,
        "Accept": "application/vnd.github+json",
        "User-Agent": "hun-pc-push",
    }
    if data:
        headers["Content-Type"] = "application/json"

    last = None
    for attempt in range(retries):
        try:
            r = urllib.request.Request(url, data=data, headers=headers, method=method)
            with urllib.request.urlopen(r, timeout=180) as resp:
                body = resp.read()
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            if e.code in (502, 503, 504) and attempt < retries - 1:
                time.sleep(2 + attempt * 2)
                last = "HTTP %d: %s" % (e.code, body[:200])
                continue
            raise RuntimeError("HTTP %d %s\n%s" % (e.code, url, body[:600]))
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2 + attempt * 2)
                last = str(e)
                continue
            raise RuntimeError("%s %s\n%s" % (method, url, e))
    raise RuntimeError("重试耗尽: " + str(last))


def collect():
    """收集待推送文件，返回 [(仓库相对路径, 本地绝对路径)]"""
    out = []
    for root, dirs, files in os.walk(SRC):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for fn in files:
            if fn in EXCLUDE_FILES:
                continue
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, SRC)
            out.append((rel.replace(os.sep, "/"), full))
    out.sort()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--prefix", default=PREFIX)
    args = ap.parse_args()

    if not TOKEN:
        print("错误：未设置环境变量 GH_TOKEN")
        return 1

    files = collect()
    total = sum(os.path.getsize(f) for _, f in files)
    print("待推送 %d 个文件，共 %.1f MB" % (len(files), total / 1024 / 1024))
    print("落点: %s/%s/\n" % (REPO, args.prefix))

    if args.dry_run:
        for rel, full in files[:40]:
            print("  %-60s %8d B" % (rel, os.path.getsize(full)))
        if len(files) > 40:
            print("  ... 其余 %d 个文件" % (len(files) - 40))
        return 0

    # ---------- ① 取当前 HEAD ----------
    print("[1/5] 读取分支 HEAD ...")
    ref = req("GET", "/repos/%s/%s/git/ref/heads/%s" % (OWNER, REPO, BRANCH))
    parent_sha = ref["object"]["sha"]
    print("      父提交 %s" % parent_sha[:12])

    commit = req("GET", "/repos/%s/%s/git/commits/%s" % (OWNER, REPO, parent_sha))
    base_tree = commit["tree"]["sha"]
    print("      基础 tree %s" % base_tree[:12])

    # ---------- ② 逐文件建 blob ----------
    print("[2/5] 创建 blob（%d 个）..." % len(files))
    tree_items = []
    done = 0
    for rel, full in files:
        with open(full, "rb") as f:
            raw = f.read()
        blob = req(
            "POST",
            "/repos/%s/%s/git/blobs" % (OWNER, REPO),
            {"content": base64.b64encode(raw).decode("ascii"), "encoding": "base64"},
        )
        tree_items.append(
            {
                "path": "%s/%s" % (args.prefix, rel),
                "mode": "100755" if os.access(full, os.X_OK) and rel.endswith(".py") else "100644",
                "type": "blob",
                "sha": blob["sha"],
            }
        )
        done += 1
        if done % 50 == 0 or done == len(files):
            print("      %d / %d" % (done, len(files)))

    # ---------- ③ 建 tree ----------
    print("[3/5] 构建 tree ...")
    tree = req(
        "POST",
        "/repos/%s/%s/git/trees" % (OWNER, REPO),
        {"base_tree": base_tree, "tree": tree_items},
    )
    print("      tree %s（%d 条目）" % (tree["sha"][:12], len(tree["tree"])))

    # ---------- ④ 建 commit ----------
    print("[4/5] 创建 commit ...")
    new_commit = req(
        "POST",
        "/repos/%s/%s/git/commits" % (OWNER, REPO),
        {"message": COMMIT_MSG, "tree": tree["sha"], "parents": [parent_sha]},
    )
    print("      commit %s" % new_commit["sha"][:12])

    # ---------- ⑤ 移动 ref ----------
    print("[5/5] 更新 %s ..." % BRANCH)
    req(
        "PATCH",
        "/repos/%s/%s/git/refs/heads/%s" % (OWNER, REPO, BRANCH),
        {"sha": new_commit["sha"], "force": False},
    )

    print("\n✅ 推送成功")
    print("   https://github.com/%s/%s/commit/%s" % (OWNER, REPO, new_commit["sha"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
