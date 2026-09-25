#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
《混二》(com.hao.hun) APK 抓取脚本 —— 供 GitHub Actions 在正常网络环境运行。

流程（严格版）：
  1. 请求 iefans 分发接口取签名直链（含 e 过期时间戳，约 5 分钟）；
  2. 【立即】用 Range 分块下载，每次请求都校验 HTTP 状态码，
     绝不把 4xx 错误页写进文件；
  3. 若链接过期（410/403），重新取链并从头/Range 续传；
  4. 校验最终大小。

要点：
  * SSL 验证关闭（目标站证书链不完整）；
  * 用 urllib + 自定义 opener，全程可控状态码。
"""
import json
import os
import random
import ssl
import string
import sys
import time
import urllib.parse
import urllib.request

API = "https://tz2.xiaota.com/api/download.php"
REFERER = "https://www.iefans.net/soft/v974051.html"
TT = "1789783089"
SG = "deea8c88bd9c4bb5da5c760c31cf87aa"
PKG_ID, NAME, PACKAGE = "472", "混二", "com.hao.hun"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
OUT = "hun2.apk"
EXPECTED = 27816013

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE
OPENER = urllib.request.build_opener(urllib.request.HTTPSHandler(context=CTX))


def api_url():
    return API + "?" + urllib.parse.urlencode({
        "package_id": PKG_ID, "name": NAME, "package": PACKAGE,
        "uuid": "".join(random.choices(string.ascii_letters + string.digits, k=28)),
        "refer": "0", "h": "", "x": "1", "referurl": "", "nowurl": REFERER,
        "t": TT, "sg": SG, "r": str(random.random()),
    })


def open_req(url, extra=None, timeout=60):
    h = {"User-Agent": UA, "Referer": REFERER}
    if extra:
        h.update(extra)
    return OPENER.open(urllib.request.Request(url, headers=h), timeout=timeout)


def fetch_node_url():
    """轮换取链，返回可用的 (url, total_size)。取链后立刻确认可达。"""
    for i in range(12):
        try:
            with open_req(api_url(), timeout=40) as r:
                node = json.loads(r.read().decode("utf-8", "replace")).get("url")
        except Exception as e:
            print(f"[取链] 第{i+1}次异常: {e}", flush=True)
            time.sleep(1)
            continue
        if not node:
            print(f"[取链] 第{i+1}次无 url")
            continue
        print(f"[取链] 第{i+1}次: {node}", flush=True)
        # 探活：只读一小段确认 200/206
        try:
            with open_req(node, extra={"Range": "bytes=0-1023"}, timeout=25) as r:
                size = int(r.headers.get("Content-Range", "/0").split("/")[-1] or 0)
                r.read()
            print(f"[探活] OK, total={size}", flush=True)
            return node, size
        except Exception as e:
            print(f"[探活] 失败: {e}")
    return None, 0


def download(url, total):
    """分块下载；每块校验状态，遇过期则返回已下载量由外层重取链。"""
    got = os.path.getsize(OUT) if os.path.exists(OUT) else 0
    BLOCK = 2 * 1024 * 1024
    while got < total:
        end = min(got + BLOCK - 1, total - 1)
        try:
            with open_req(url, extra={"Range": f"bytes={got}-{end}"}, timeout=90) as r:
                if r.status not in (200, 206):
                    print(f"[下载] 意外状态 {r.status}")
                    return got, "http"
                chunk = r.read()
            if not chunk:
                return got, "empty"
            with open(OUT, "ab" if got else "wb") as f:
                f.write(chunk)
            got += len(chunk)
            print(f"[下载] {got}/{total} ({100*got//total}%)", flush=True)
        except urllib.error.HTTPError as e:
            if e.code in (403, 410):
                print(f"[下载] 链接过期 ({e.code})，需重新取链")
                return got, "expired"
            print(f"[下载] HTTP {e.code}，重试")
            time.sleep(1)
        except Exception as e:
            print(f"[下载] 异常 {e}，重试")
            time.sleep(1)
    return got, "done"


def main():
    got = 0
    for attempt in range(1, 6):
        url, total = fetch_node_url()
        if not url:
            print(f"[第{attempt}轮] 取链失败")
            continue
        if not total:
            total = EXPECTED
        got, why = download(url, total)
        print(f"[第{attempt}轮] 结束: {got}/{total} ({why})")
        if got >= total:
            print("✅ 下载完成")
            sys.exit(0)
    print(f"❌ 未完成: {got}/{EXPECTED}")
    sys.exit(2)


if __name__ == "__main__":
    main()
