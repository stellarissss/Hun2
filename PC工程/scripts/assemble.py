#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把镜像资源装配进 PC 工程 www/ 目录，并按裁剪规则过滤。
"""
import os, shutil, sys, json, re

MIRROR = "/root/.codebuddy/artifact/mirror/www"
PC = "/root/.codebuddy/artifact/pc"
WWW = os.path.join(PC, "www")

# 需要从镜像拷入的目录/文件
COPY = [
    "js/hun_min.js", "js/hun_japan/word/cn.js",
    "js/lib/jquery.min.js", "js/lib/crypto-js.js", "js/lib/LAB.min.js",
    "js/lib/howler.core.min.js", "js/lib/pako.min.js",
    "js/lib/pathfinding/pathfinding-browser.min.js",
    "js/sh/MessageDOM.js", "css/MessageDOM.css",
    "json/gamedata.json", "json/version.json",
    "json/audio_effect_min.json", "json/audio_unity.json",
    "json/check_connect.json", "json/daily_news_epv_usa_app_china.json",
]
COPY_DIRS = ["pics", "audio"]


def cp(rel):
    src = os.path.join(MIRROR, rel)
    dst = os.path.join(WWW, rel)
    if not os.path.exists(src):
        print(f"  ⚠ 缺失: {rel}")
        return False
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)
    return True


def main():
    ok = fail = 0
    print("=== 拷贝核心文件 ===")
    for r in COPY:
        if cp(r):
            ok += 1
        else:
            fail += 1

    print("=== 拷贝资源目录 ===")
    for d in COPY_DIRS:
        s = os.path.join(MIRROR, d)
        if not os.path.isdir(s):
            print(f"  ⚠ 目录缺失: {d}")
            continue
        for root, dirs, files in os.walk(s):
            rel = os.path.relpath(root, MIRROR)
            for f in files:
                if f.endswith(".part"):
                    continue
                if cp(os.path.join(rel, f)):
                    ok += 1
                else:
                    fail += 1

    print(f"\n装配完成: 成功 {ok}，缺失 {fail}")

    # 统计
    total = 0
    for root, dirs, files in os.walk(WWW):
        for f in files:
            total += os.path.getsize(os.path.join(root, f))
    print(f"www/ 总体积: {total/1048576:.2f} MB")


if __name__ == "__main__":
    main()
