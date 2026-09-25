#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
delete_paths.py —— 通过 Git Data API 删除仓库中的指定文件

用途：Base tree 是增量语义（只覆盖同名路径、新增文件），
      因此「本地删掉的文件」不会自动从远端消失。本脚本用于显式删除。

用法：
    python3 delete_paths.py --repo Hun2 --prefix "混在日本PC单机版" --dry-run
    python3 delete_paths.py --repo Chinese-BookTitleLibrary --paths "a/b.txt,c/d.txt" \
        --message "chore: 清理临时内容"
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

TOKEN = os.environ.get("GH_TOKEN", "").strip()
API = "https://cors.isteed.cc/https://api.github.com"
BATCH = 100


def req(method, path, payload=None, retries=4):
    url = API + path
    headers = {
        "Authorization": "Bearer " + TOKEN,
        "Accept": "application/vnd.github+json",
        "User-Agent": "hun-pc-delete",
        "Content-Type": "application/json",
    }
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    last = None
    for attempt in range(retries):
        try:
            r = urllib.request.Request(url, data=data, headers=headers, method=method)
            with urllib.request.urlopen(r, timeout=180) as resp:
                body = resp.read()
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            if e.code in (403, 429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(2 + attempt * 2)
                last = "HTTP %d" % e.code
                continue
            raise RuntimeError("HTTP %d %s\n%s" % (e.code, url, body[:500]))
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2 + attempt * 2)
                last = str(e)
                continue
            raise RuntimeError("%s %s\n%s" % (method, url, e))
    raise RuntimeError("重试耗尽: " + str(last))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--owner", default="stellarissss")
    ap.add_argument("--repo", required=True)
    ap.add_argument("--branch", default="main")
    ap.add_argument("--prefix", help="限定目录前缀，如 混在日本PC单机版")
    ap.add_argument("--match", default="", help="仅删除路径中包含该子串的文件")
    ap.add_argument("--paths", default="", help="逗号分隔的精确路径")
    ap.add_argument("--message", default="", help="自定义 commit message")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not TOKEN:
        print("错误：未设置 GH_TOKEN")
        return 1

    OWNER, REPO, BRANCH = args.owner, args.repo, args.branch
    ref = req("GET", "/repos/%s/%s/git/ref/heads/%s" % (OWNER, REPO, BRANCH))
    parent_sha = ref["object"]["sha"]
    base_tree = req("GET", "/repos/%s/%s/git/commits/%s" % (OWNER, REPO, parent_sha))["tree"]["sha"]

    targets = []
    if args.paths:
        targets = [p.strip() for p in args.paths.split(",") if p.strip()]
    else:
        tree = req("GET", "/repos/%s/%s/git/trees/%s?recursive=1" % (OWNER, REPO, base_tree))
        pref = (args.prefix or "").strip("/")
        for x in tree.get("tree", []):
            if x["type"] != "blob":
                continue
            p = x["path"]
            if pref and not (p == pref or p.startswith(pref + "/")):
                continue
            if args.match and args.match not in p:
                continue
            targets.append(p)

    if not targets:
        print("没有匹配到任何文件，退出。")
        return 0

    print("将删除 %d 个文件（%s/%s）：" % (len(targets), OWNER, REPO))
    for p in targets[:50]:
        print("  - " + p)
    if len(targets) > 50:
        print("  ... 共 %d 个" % len(targets))
    if args.dry_run:
        print("\n[dry-run] 未执行实际删除")
        return 0

    # GitHub 删除文件 = 在 tree 中把该路径的 sha 置为 null
    items = [{"path": p, "mode": "100644", "type": "blob", "sha": None} for p in targets]
    tree_sha = base_tree
    for i in range(0, len(items), BATCH):
        batch = items[i:i + BATCH]
        t = req("POST", "/repos/%s/%s/git/trees" % (OWNER, REPO),
                {"base_tree": tree_sha, "tree": batch})
        tree_sha = t["sha"]
        print("  批次 %d-%d → %s" % (i + 1, i + len(batch), tree_sha[:12]))

    msg = args.message or ("chore: 删除 %s 下 %d 个文件"
                           % (args.prefix.strip("/") or "根目录", len(targets)))
    commit = req("POST", "/repos/%s/%s/git/commits" % (OWNER, REPO),
                 {"message": msg, "tree": tree_sha, "parents": [parent_sha]})
    print("  commit %s" % commit["sha"][:12])

    req("PATCH", "/repos/%s/%s/git/refs/heads/%s" % (OWNER, REPO, BRANCH),
        {"sha": commit["sha"], "force": False})
    print("\n✅ 删除完成")
    print("   https://github.com/%s/%s/commit/%s" % (OWNER, REPO, commit["sha"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
