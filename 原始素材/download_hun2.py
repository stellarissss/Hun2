#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
混二 (包名 com.hao.hun) APK 下载脚本
============================================
说明：
  本脚本逆向自 iefans 下载站的分发接口，用于在【你自己的电脑】上
  一键下载《混二》安卓安装包。沙盒/受限网络环境下无法直连其外部
  CDN，故请在具备正常外网访问的机器上运行。

原理（已逆向验证）：
  1. iefans 页面上的「立即下载」调用 openPackage() -> 请求
     https://tz2.xiaota.com/api/download.php  （带固定签名参数 sg / t）
  2. 接口返回 JSON：{"url": "https://apkXX.<cdn>:8010/apk/.../com.hao.hun.apk?md5=...&e=..."}
     其中 e 为过期时间戳（约 5 分钟有效），必须在过期前立即下载。
  3. 直接拉取该 url 即得 APK。

用法：
  python3 download_hun2.py              # 默认保存为 混二.apk
  python3 download_hun2.py -o game.apk  # 指定输出名

注意（安全）：
  - 来源为第三方下载站，APK 可能不是官方原版，安装前请务必用杀毒/
    安全软件扫描，并核对包名为 com.hao.hun。
  - 该游戏为免费游戏，若条件允许，建议优先通过官方渠道获取：
    Google Play 搜索「混在日本」(包名 com.hao.hun.japan) 或 TapTap。
"""

import argparse
import json
import os
import random
import string
import sys
import time
import urllib.parse
import urllib.request

API = "https://tz2.xiaota.com/api/download.php"
REFERER = "https://www.iefans.net/soft/v974051.html"

# 从 iefans 混淆 JS 中提取的【固定】签名常量（tt / sg）
TT = "1789783089"
SG = "deea8c88bd9c4bb5da5c760c31cf87aa"

PKG_ID = "472"
NAME = "混二"
PACKAGE = "com.hao.hun"


def build_api_url():
    uuid = "".join(random.choices(string.ascii_letters + string.digits, k=28))
    params = {
        "package_id": PKG_ID,
        "name": NAME,
        "package": PACKAGE,
        "uuid": uuid,
        "refer": "0",
        "h": "",
        "x": "1",
        "referurl": "",
        "nowurl": REFERER,
        "t": TT,
        "sg": SG,
        "r": str(random.random()),
    }
    return API + "?" + urllib.parse.urlencode(params)


def http_get(url, timeout=30):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Referer": REFERER,
        },
    )
    return urllib.request.urlopen(req, timeout=timeout)


def fetch_apk_url():
    print("[1/3] 请求下载接口获取真实地址 ...")
    with http_get(build_api_url(), timeout=30) as r:
        data = json.loads(r.read().decode("utf-8"))
    apk_url = data.get("url")
    if not apk_url:
        raise RuntimeError("接口未返回 url 字段，响应: " + json.dumps(data, ensure_ascii=False))
    print("      真实下载地址:", apk_url)
    return apk_url


def download(apk_url, out_path):
    print("[2/3] 下载 APK（需在网络正常的环境下，且须在签名过期前完成）...")
    tmp = out_path + ".part"
    req = urllib.request.Request(
        apk_url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Referer": REFERER,
        },
    )
    start = time.time()
    downloaded = 0
    with http_get(apk_url, timeout=300) as r, open(tmp, "wb") as f:
        total = r.headers.get("Content-Length")
        total = int(total) if total else None
        while True:
            chunk = r.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
            downloaded += len(chunk)
            if total:
                pct = downloaded / total * 100
                sys.stdout.write(f"\r      进度: {downloaded/1024/1024:.1f}/{total/1024/1024:.1f} MB ({pct:.1f}%)")
            else:
                sys.stdout.write(f"\r      已下载: {downloaded/1024/1024:.1f} MB")
            sys.stdout.flush()
    sys.stdout.write("\n")
    os.replace(tmp, out_path)
    cost = time.time() - start
    size = os.path.getsize(out_path)
    print(f"[3/3] 完成：{out_path}  ({size/1024/1024:.2f} MB, 用时 {cost:.1f}s)")


def verify(out_path):
    """基础校验：是否为以 PK 开头的 ZIP/APK。"""
    with open(out_path, "rb") as f:
        head = f.read(4)
    ok = head[:4] == b"PK\x03\x04"
    print("      文件头校验:", "通过 (PK/ZIP, 疑似有效 APK)" if ok else "异常 (非 APK, 请检查)")
    return ok


def main():
    ap = argparse.ArgumentParser(description="下载《混二》安卓 APK")
    ap.add_argument("-o", "--output", default="混二.apk", help="输出文件名")
    args = ap.parse_args()

    try:
        apk_url = fetch_apk_url()
        download(apk_url, args.output)
        verify(args.output)
        print("\n提示：第三方站点 APK 安装前请用安全软件扫描，并确认包名为 com.hao.hun。")
    except Exception as e:
        print("\n下载失败:", e)
        print("排查：请确认本机可正常访问外网；若提示过期，请重试（签名约 5 分钟有效）。")
        sys.exit(1)


if __name__ == "__main__":
    main()
