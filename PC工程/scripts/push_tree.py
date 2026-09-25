#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把暂存目录的全部文件推送到 GitHub 仓库的指定前缀下。
- 并发建 blob（8 线程）
- 分批建 tree（每批 120 条，逐批累积 base_tree）
- 空仓库：首批 tree 不带 base_tree
"""
import os, sys, json, base64, time, hashlib, threading, argparse
import urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

API   = "https://cors.isteed.cc/https://api.github.com"
TOKEN = os.environ.get("GH_TOKEN")
BATCH = 120
WORKERS = 8

def make_req():
    def req(method, path, body=None, retry=4):
        data = json.dumps(body).encode() if body is not None else None
        for attempt in range(retry):
            try:
                r = urllib.request.Request(API + path, data=data, method=method)
                r.add_header("Authorization", "Bearer " + TOKEN)
                r.add_header("Accept", "application/vnd.github+json")
                if data:
                    r.add_header("Content-Type", "application/json")
                with urllib.request.urlopen(r, timeout=120) as f:
                    return json.load(f)
            except urllib.error.HTTPError as e:
                body_txt = e.read().decode("utf-8", "ignore")[:400]
                if e.code in (403, 429, 500, 502, 503, 504) and attempt < retry - 1:
                    time.sleep(2 ** attempt); continue
                raise RuntimeError("HTTP %d %s %s -> %s" % (e.code, method, path, body_txt))
            except Exception as e:
                if attempt < retry - 1:
                    time.sleep(2 ** attempt); continue
                raise
    return req
req = make_req()

def iter_files(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames
                       if d not in ("node_modules", ".git", "__pycache__", ".vscode", ".idea")]
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            yield full, rel

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="本地源目录")
    ap.add_argument("--repo", default="Hun2")
    ap.add_argument("--owner", default="stellarissss")
    ap.add_argument("--branch", default="main")
    ap.add_argument("--prefix", default="", help="仓库内前缀，如 '混在日本PC单机版'；空=根")
    ap.add_argument("--message", default="migrate: 迁移《混在日本》PC单机版全部产物")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    OWNER, REPO, BRANCH, PREFIX = a.owner, a.repo, a.branch, a.prefix.strip("/")
    files = list(iter_files(a.src))
    print("[扫描] 本地文件数: %d" % len(files))
    total = sum(os.path.getsize(f) for f, _ in files)
    print("[扫描] 总体积: %.1f MB" % (total / 1024 / 1024))

    # 取当前 ref / base_tree（空仓库无 ref）
    try:
        ref = req("GET", "/repos/%s/%s/git/ref/heads/%s" % (OWNER, REPO, BRANCH))
        parent = ref["object"]["sha"]
        base_tree = req("GET", "/repos/%s/%s/git/commits/%s" % (OWNER, REPO, parent))["tree"]["sha"]
        print("[基座] 现有提交 %s, tree %s" % (parent[:12], base_tree[:12]))
    except Exception as e:
        print("[基座] 空仓库（无 main 分支）: %s" % str(e)[:120])
        parent = None
        base_tree = None

    if a.dry_run:
        for f, rel in files[:20]:
            print("  ", rel)
        print("  ... 共 %d 个" % len(files))
        return

    # ---- 并发建 blob ----
    print("[1/3] 并发建 blob（%d 线程）..." % WORKERS)
    tree_items = []
    lock = threading.Lock()
    done = [0]
    t0 = time.time()

    def upload(item):
        full, rel = item
        with open(full, "rb") as fh:
            raw = fh.read()
        b64 = base64.b64encode(raw).decode()
        sha = req("POST", "/repos/%s/%s/git/blobs" % (OWNER, REPO),
                  {"content": b64, "encoding": "base64"})["sha"]
        path = (PREFIX + "/" + rel) if PREFIX else rel
        with lock:
            tree_items.append({"path": path, "mode": "100644", "type": "blob", "sha": sha})
            done[0] += 1
            if done[0] % 100 == 0 or done[0] == len(files):
                print("       %d/%d  (%.0fs)" % (done[0], len(files), time.time() - t0))

    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        list(ex.map(upload, files))
    print("      完成 %d 个 blob（%.0fs）" % (len(tree_items), time.time() - t0))

    # ---- 分批建 tree ----
    print("[2/3] 分批建 tree（每批 %d 条）..." % BATCH)
    tree_items.sort(key=lambda x: x["path"])
    tree_sha = base_tree
    for i in range(0, len(tree_items), BATCH):
        batch = tree_items[i:i + BATCH]
        body = {"tree": batch}
        if tree_sha:
            body["base_tree"] = tree_sha
        tree_sha = req("POST", "/repos/%s/%s/git/trees" % (OWNER, REPO), body)["sha"]
        print("       批次 %d-%d → %s" % (i + 1, i + len(batch), tree_sha[:12]))

    # ---- 建 commit ----
    print("[3/3] 提交并入 main ...")
    cbody = {"message": a.message, "tree": tree_sha}
    if parent:
        cbody["parents"] = [parent]
    commit = req("POST", "/repos/%s/%s/git/commits" % (OWNER, REPO), cbody)
    print("       commit: %s" % commit["sha"][:12])

    if parent:
        req("PATCH", "/repos/%s/%s/git/refs/heads/%s" % (OWNER, REPO, BRANCH),
            {"sha": commit["sha"], "force": False})
    else:
        req("POST", "/repos/%s/%s/git/refs" % (OWNER, REPO),
            {"ref": "refs/heads/%s" % BRANCH, "sha": commit["sha"]})

    print("\n✅ 推送完成")
    print("   https://github.com/%s/%s/commit/%s" % (OWNER, REPO, commit["sha"]))

if __name__ == "__main__":
    main()
