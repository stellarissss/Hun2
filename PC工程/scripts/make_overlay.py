#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
更新包（Overlay Patch）生成工具 —— 《混在日本》PC 单机版

用途
----
把当前工程的「代码部分」（www/ 与 electron/）打包为一个可叠加的更新包，
玩家只需把更新包解压到游戏目录（或双击随包附带的 apply-update.bat），
即可无缝升级到新版本，且**不触碰存档**。

设计要点
--------
1. 更新包落在 <游戏目录>/app_overlay/，程序启动时优先加载覆盖层；
2. 存档始终位于用户数据目录（%APPDATA%/hun-japan-pc/saves），与代码完全分离，
   因此任何更新都不会影响存档；
3. 更新包可叠加安装在**任意历史版本**之上（增量语义 = 全量替换代码文件，
   不含存档、不含 Electron 运行时）；
4. 删除 app_overlay/ 即可一键回退到内置版本。

产物结构
--------
    更新包/
      app_overlay/
        version.json          ← 版本元信息（程序据此显示当前生效版本）
        www/                  ← 网页层（游戏本体逻辑与资源）
        electron/preload.js   ← 预加载层（如无变化可省略）
      apply-update.bat        ← 一键应用脚本（复制 app_overlay 到游戏目录）
      更新说明.md             ← 本次更新内容

用法
----
    python3 scripts/make_overlay.py \
        --version 4.1.0 \
        --out "更新包版本库/v4.1.0-地图交互增强" \
        --notes notes.md
"""

import argparse
import hashlib
import json
import os
import shutil
import sys
import time
import zipfile
from pathlib import Path

# ---------------------------------------------------------------- 常量

PROJ = Path(__file__).resolve().parent.parent      # <project>/
WWW = PROJ / "www"
ELECTRON = PROJ / "electron"

# 不进入更新包的内容（开发用 / 构建产物 / 测试）
WWW_EXCLUDE_DIRS = {"node_modules", ".git", "__pycache__", ".vscode"}
WWW_EXCLUDE_FILES = {".DS_Store", "Thumbs.db"}
# 注：www/js/hun_min.js 必须包含（游戏本体逻辑），不做排除


def sha256_file(p: Path, buf: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        while True:
            b = f.read(buf)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def iter_files(root: Path):
    """遍历目录下所有文件（跳过排除项），返回相对路径列表。"""
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in WWW_EXCLUDE_DIRS]
        for fn in filenames:
            if fn in WWW_EXCLUDE_FILES:
                continue
            full = Path(dirpath) / fn
            yield full, full.relative_to(root)


def human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} B"
        n /= 1024


# ---------------------------------------------------------------- 打包

def build_overlay(version: str, out_dir: Path, notes: str,
                  base_version: str = None, prev_overlay: Path = None):
    """生成更新包目录结构，返回统计信息。"""
    if out_dir.exists():
        shutil.rmtree(out_dir)
    overlay = out_dir / "app_overlay"
    overlay.mkdir(parents=True)

    files_meta = []
    total_bytes = 0

    # ---- 1) www/ ----
    dst_www = overlay / "www"
    for src, rel in iter_files(WWW):
        dst = dst_www / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        sz = dst.stat().st_size
        total_bytes += sz
        files_meta.append({
            "path": "www/" + str(rel).replace("\\", "/"),
            "size": sz,
            "sha256": sha256_file(dst),
        })

    # ---- 2) electron/preload.js（若有变化才带，减小体积）----
    ov_elec = overlay / "electron"
    ov_elec.mkdir(parents=True, exist_ok=True)
    pre = ELECTRON / "preload.js"
    if pre.exists():
        dst = ov_elec / "preload.js"
        shutil.copy2(pre, dst)
        sz = dst.stat().st_size
        total_bytes += sz
        files_meta.append({
            "path": "electron/preload.js",
            "size": sz,
            "sha256": sha256_file(dst),
        })

    # ---- 3) version.json ----
    meta = {
        "name": "混在日本 · PC 单机版 更新包",
        "version": version,
        "baseVersion": base_version or "any",   # any = 可叠加任意历史版本
        "builtAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "fileCount": len(files_meta),
        "totalBytes": total_bytes,
        "notesFile": "更新说明.md",
        "applyHint": "将 app_overlay 文件夹复制到游戏安装目录（与 混在日本.exe 同级），"
                     "或直接双击 apply-update.bat。存档不受影响。",
        "files": files_meta,
    }
    (overlay / "version.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    # ---- 4) apply-update.bat ----
    (out_dir / "apply-update.bat").write_text(BAT_TEMPLATE, encoding="gbk", errors="replace")

    # ---- 5) 更新说明.md ----
    (out_dir / "更新说明.md").write_text(notes, encoding="utf-8")

    return meta


BAT_TEMPLATE = r"""@echo off
chcp 936 >nul
setlocal enabledelayedexpansion
title 混在日本 - 更新包安装

echo ============================================================
echo            混在日本 PC 单机版 - 更新包安装程序
echo ============================================================
echo.
echo  本程序会把更新包内容安装到游戏目录的 app_overlay 文件夹中。
echo  更新只替换程序代码，**不会影响你的存档**。
echo.

rem ---- 定位游戏目录 ----
set "GAMEDIR=%~dp0"
set "GAMEDIR=%GAMEDIR:~0,-1%"

rem 若更新包与游戏不在同一目录，尝试向上查找 exe
if not exist "%GAMEDIR%\混在日本.exe" (
    for %%D in ("%GAMEDIR%\..") do (
        if exist "%%~fD\混在日本.exe" set "GAMEDIR=%%~fD"
    )
)

rem 仍未找到则让用户手动输入
if not exist "%GAMEDIR%\混在日本.exe" (
    echo  [!] 未能自动找到游戏目录。
    echo.
    set /p GAMEDIR= 请输入游戏安装目录（例如 D:\Games\混在日本）: 
    if "!GAMEDIR!"=="" goto :fail
)

if not exist "!GAMEDIR!\混在日本.exe" (
    echo  [!] 目录中未找到 混在日本.exe，请确认路径正确。
    goto :fail
)

echo  游戏目录: !GAMEDIR!
echo.

if not exist "%~dp0app_overlay" (
    echo  [!] 未找到 app_overlay 文件夹，请确认更新包完整。
    goto :fail
)

rem ---- 提示关闭游戏 ----
tasklist /FI "IMAGENAME eq 混在日本.exe" 2>nul | find /I "混在日本.exe" >nul
if not errorlevel 1 (
    echo  [!] 检测到游戏正在运行，请先关闭游戏后再执行更新。
    pause
    goto :fail
)

rem ---- 备份旧覆盖层（便于回退） ----
if exist "!GAMEDIR!\app_overlay" (
    echo  正在备份旧版本...
    if exist "!GAMEDIR!\app_overlay.bak" rd /s /q "!GAMEDIR!\app_overlay.bak"
    move "!GAMEDIR!\app_overlay" "!GAMEDIR!\app_overlay.bak" >nul
)

echo  正在安装更新...
xcopy "%~dp0app_overlay" "!GAMEDIR!\app_overlay" /E /I /Y /Q >nul
if errorlevel 1 (
    echo  [!] 复制失败，可能是权限不足。请右键本文件选择“以管理员身份运行”。
    goto :fail
)

echo.
echo ============================================================
echo   更新完成！直接启动游戏即可，存档保持不变。
echo ============================================================
echo.
echo  如需回退到更新前的版本，删除游戏目录下的 app_overlay 文件夹即可。
echo.
pause
exit /b 0

:fail
echo.
echo  安装未能完成，请根据上方提示处理后重试。
pause
exit /b 1
"""


def main():
    ap = argparse.ArgumentParser(description="生成《混在日本》PC 版更新包")
    ap.add_argument("--version", required=True, help="本次更新版本号，例如 4.1.0")
    ap.add_argument("--out", required=True, help="输出目录（更新包根）")
    ap.add_argument("--notes", help="更新说明 Markdown 文件路径")
    ap.add_argument("--base", default="any", help="基线版本（默认 any = 可叠加任意版本）")
    ap.add_argument("--zip", action="store_true", help="额外生成 zip 压缩包")
    args = ap.parse_args()

    out_dir = Path(args.out).resolve()
    notes = ""
    if args.notes and Path(args.notes).exists():
        notes = Path(args.notes).read_text(encoding="utf-8")
    if not notes:
        notes = f"# 更新说明 v{args.version}\n\n（未提供说明文档）\n"

    print(f"正在生成更新包 v{args.version} ...")
    meta = build_overlay(args.version, out_dir, notes, args.base)

    print(f"  文件数 : {meta['fileCount']}")
    print(f"  总大小 : {human(meta['totalBytes'])}")
    print(f"  输出至 : {out_dir}")

    if args.zip:
        zp = out_dir.with_suffix(".zip")
        with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            for dirpath, _, filenames in os.walk(out_dir):
                for fn in filenames:
                    full = Path(dirpath) / fn
                    z.write(full, full.relative_to(out_dir))
        print(f"  压缩包 : {zp}  ({human(zp.stat().st_size)})")

    return 0


if __name__ == "__main__":
    sys.exit(main())
