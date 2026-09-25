#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
publish_release.py —— 把 Windows 安装包作为 GitHub Release 附件发布
=====================================================================

为什么不把 107 MB 的 exe 直接塞进 Git 仓库：
  - Git 对大二进制不友好，克隆会变成灾难（用户只想看代码却要下 300 MB）
  - GitHub 单文件硬上限 100 MB，107 MB 的安装包根本推不上去
  - Release 附件天然就是干这个的：单独下载链接、不限克隆体积、支持断点续传

用法：
    python3 publish_release.py --dry-run
    python3 publish_release.py
=================================================================
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

TOKEN = os.environ.get("GH_TOKEN", "").strip()
OWNER = "stellarissss"
REPO = "Chinese-BookTitleLibrary"
TAG = "hun-pc-v4.0.0"
NAME = "《混在日本》PC 单机版 v4.0.0"

API = "https://cors.isteed.cc/https://api.github.com"
UPLOAD_HOST = "https://cors.isteed.cc/https://uploads.github.com"
DIST = "/root/.codebuddy/artifact/dist"

ASSETS = [
    ("混在日本-4.0.0-x64.exe", "安装版（推荐）—— 双击安装，自动创建桌面与开始菜单快捷方式"),
    ("混在日本-便携版-4.0.0.exe", "便携版 —— 免安装，放到任意目录双击即可运行"),
]

BODY = """## 关于

《混在日本》（又名《混二》）**日本版**的 Windows 离线单机版。

本版本将原 Android 版的游戏内容完整迁移至 PC，**游戏过程完全脱离云端服务**，
所有逻辑均在本地实现。断网可玩。

> 游戏内容、美术、音乐、剧本的一切权利归**原作者**所有。
> 本仓库仅包含使其能在 PC 上离线运行所需的适配代码，仅供个人学习与授权范围内使用。

---

## 下载

| 文件 | 说明 | 大小 |
|---|---|---|
| `混在日本-4.0.0-x64.exe` | **安装版（推荐）**。双击安装，自动创建桌面与开始菜单快捷方式 | 107.6 MB |
| `混在日本-便携版-4.0.0.exe` | **便携版**。免安装，放到任意目录双击即可运行 | 107.4 MB |

## 运行环境

- Windows 10 / 11，64 位
- 无需联网、无需安装额外运行库
- 首次启动约 3–5 秒（需解压与初始化资源）

## 操作

- **鼠标左键点击** —— 全部交互（菜单、对话、选项、确认）
- 游戏窗口为 9:16 竖屏，会根据屏幕高度自动缩放
- `F11` 切换全屏，`Alt+F4` 退出

## 存档位置

```
%APPDATA%\\混在日本\\saves\\
```

删除该目录即可重置存档。卸载时**不会**自动删除存档。

## 本版本包含

- 完整的「混在日本」核心文字养成玩法
- 全部城市地图、人物、车辆、商品、建筑资源
- 全部随机事件与剧情分支
- 完整音频与音效

## 本版本调整

按需求，以下内容已移除：

- 内购系统（混币保留，初始 20000；现金初始 3000；微信支付框架已预留）
- 社团系统、FC 小游戏、艺妓、黑金小游戏
- 排行榜
- 全部联网功能与外链

## 从源码构建

见仓库中 `混在日本PC单机版/PC工程/BUILD.md`。

```bash
npm install && npm run build
```
"""


def req(method, url, payload=None, retries=3, raw=None, ctype=None):
    headers = {
        "Authorization": "token " + TOKEN,
        "Accept": "application/vnd.github+json",
        "User-Agent": "hun-pc-release",
    }
    data = None
    if raw is not None:
        data = raw
        headers["Content-Type"] = ctype or "application/octet-stream"
    elif payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    last = None
    for attempt in range(retries):
        try:
            r = urllib.request.Request(url, data=data, headers=headers, method=method)
            with urllib.request.urlopen(r, timeout=1800) as resp:
                b = resp.read()
                return json.loads(b) if b else {}
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            if e.code in (502, 503, 504) and attempt < retries - 1:
                time.sleep(3 + attempt * 3)
                last = "HTTP %d" % e.code
                continue
            raise RuntimeError("HTTP %d %s\n%s" % (e.code, url, body[:600]))
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(3 + attempt * 3)
                last = str(e)
                continue
            raise RuntimeError("%s %s\n%s" % (method, url, e))
    raise RuntimeError("重试耗尽: " + str(last))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not TOKEN:
        print("错误：未设置环境变量 GH_TOKEN")
        return 1

    missing = [a for a, _ in ASSETS if not os.path.exists(os.path.join(DIST, a))]
    if missing:
        print("错误：找不到产物 %s" % missing)
        return 1

    for a, desc in ASSETS:
        p = os.path.join(DIST, a)
        print("  %-38s %10.1f MB  %s" % (a, os.path.getsize(p) / 1024 / 1024, desc))
    print()

    if args.dry_run:
        return 0

    # ---------- ① 建或取 Release ----------
    print("[1/3] 创建 Release %s ..." % TAG)
    try:
        rel = req(
            "POST",
            "%s/repos/%s/%s/releases" % (API, OWNER, REPO),
            {
                "tag_name": TAG,
                "name": NAME,
                "body": BODY,
                "draft": False,
                "prerelease": False,
                "target_commitish": "main",
            },
        )
        print("      release id = %s" % rel["id"])
    except RuntimeError as e:
        if "already_exists" in str(e) or "422" in str(e):
            print("      已存在，读取现有 Release ...")
            rel = req("GET", "%s/repos/%s/%s/releases/tags/%s" % (API, OWNER, REPO, TAG))
            print("      release id = %s" % rel["id"])
        else:
            raise

    # ---------- ② 检查已上传附件 ----------
    existing = req("GET", "%s/repos/%s/%s/releases/%d/assets" % (API, OWNER, REPO, rel["id"]))
    have = {a["name"]: a["id"] for a in existing}
    print("      现有附件: %s" % (list(have) or "无"))

    # ---------- ③ 上传 ----------
    print("[2/3] 上传附件 ...")
    for name, _ in ASSETS:
        path = os.path.join(DIST, name)
        if name in have:
            print("  [跳过] %s 已存在" % name)
            continue
        size = os.path.getsize(path)
        print("  [上传] %s (%.1f MB) ..." % (name, size / 1024 / 1024))
        with open(path, "rb") as f:
            raw = f.read()
        up = "%s/repos/%s/%s/releases/%d/assets?name=%s" % (
            UPLOAD_HOST,
            OWNER,
            REPO,
            rel["id"],
            urllib.parse.quote(name),
        )
        res = req("POST", up, raw=raw, ctype="application/octet-stream", retries=2)
        print("         -> %s (%d B)" % (res.get("name"), res.get("size", 0)))

    # ---------- ③ 完成 ----------
    print("[3/3] 完成")
    rel = req("GET", "%s/repos/%s/%s/releases/tags/%s" % (API, OWNER, REPO, TAG))
    print("\n✅ Release 已发布")
    print("   %s" % rel["html_url"])
    for a in rel.get("assets", []):
        print("   - %s  (%.1f MB)" % (a["name"], a["size"] / 1024 / 1024))
    return 0


if __name__ == "__main__":
    import urllib.parse

    sys.exit(main())
