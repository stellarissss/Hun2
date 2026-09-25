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
title 混在日本 - 更新包安装程序

rem ============================================================
rem  《混在日本》PC 单机版 - 智能更新脚本
rem ------------------------------------------------------------
rem  功能：
rem    1. 自动在「更新包所在目录、其上级目录、其下级目录、
rem       以及所在磁盘的常见安装位置」中递归搜索游戏目录
rem    2. 找到唯一游戏目录 → 直接更新
rem       找到多个       → 列出让玩家选择
rem       一个没找到     → 引导手动指定
rem    3. 更新前自动备份旧版本，可一键回退
rem    4. 全程不触碰存档
rem
rem  兼容性说明：
rem    · 可在任意目录层级运行（不限一层），仓库内任意位置都能找到游戏
rem    · 同时支持安装版与便携版
rem    · 路径含中文、空格、括号均安全
rem      （块内一律使用 !变量! 延迟展开，避免括号被当作语法）
rem ============================================================

set "PKGDIR=%~dp0"
if "%PKGDIR:~-1%"=="\" set "PKGDIR=%PKGDIR:~0,-1%"
set "OVLSRC=%PKGDIR%\app_overlay"

echo ============================================================
echo          《混在日本》PC 单机版 · 更新程序
echo ============================================================
echo.
echo   本程序会把更新包安装到游戏目录，只替换程序代码，
echo   ** 不会影响你的存档、进度与账号 **
echo.
echo   更新包位置: %PKGDIR%
echo.

rem ---- 前置检查：更新包是否完整 ----
if not exist "%OVLSRC%" (
    echo   [X] 更新包不完整：未找到 app_overlay 文件夹
    echo.
    echo       请确认已完整解压压缩包后再运行本程序。
    echo.
    echo       提示：若你下载的是分卷压缩包，请先把所有分卷
    echo             放在同一目录下解压，得到完整目录后再运行。
    goto :fail
)

rem ============================================================
rem  第一步：搜索游戏目录
rem ============================================================
set "CANDLIST=%TEMP%\hun_update_cands.txt"
if exist "%CANDLIST%" del "%CANDLIST%" >nul 2>&1

echo   正在搜索游戏安装目录，请稍候...
echo.

rem 扫描期间静默（verify 的失败提示只在玩家手动输入/选择时显示）
set "QUIET=1"
call :scan "%PKGDIR%"
call :scan_parents "%PKGDIR%"
call :scan_root "%PKGDIR%"
for %%R in ("%PKGDIR%") do call :scan_drive "%%~dR"
set "QUIET="

rem ---- 统计结果 ----
set "CNT=0"
if exist "%CANDLIST%" (
    for /f "usebackq delims=" %%L in ("%CANDLIST%") do set /a CNT+=1
)

if !CNT! EQU 0 (
    echo   [!] 未能自动找到游戏目录。
    echo.
    echo       可能原因：游戏安装在其它磁盘、或使用了自定义目录名。
    echo.
    echo       备选方案：直接把更新包内的 app_overlay 文件夹
    echo                 整体复制到游戏目录（与「混在日本.exe」同一层）
    echo                 即可，效果与本程序完全相同。
    echo.
    echo   ------------------------------------------------------------
    set "GAMEDIR="
    set /p GAMEDIR= 请手动输入游戏安装目录后回车（直接回车放弃）: 
    if "!GAMEDIR!"=="" goto :fail
    call :verify "!GAMEDIR!"
    if not "!VERIFYOK!"=="1" goto :fail
    goto :install
)

if !CNT! EQU 1 (
    for /f "usebackq delims=" %%L in ("%CANDLIST%") do set "GAMEDIR=%%L"
    echo   [√] 已找到游戏目录：
    echo       !GAMEDIR!
    echo.
    goto :install
)

rem ---- 多个候选：列出并让玩家选择 ----
echo   [i] 找到 !CNT! 个疑似游戏目录，请选择要更新的那一个：
echo.
set "IDX=0"
for /f "usebackq delims=" %%L in ("%CANDLIST%") do (
    set /a IDX+=1
    echo       !IDX!. %%L
)
echo.
echo       0. 以上都不是，手动输入路径
echo.
set "SEL="
set /p SEL= 请输入序号后回车: 

if "!SEL!"=="0" goto :manual
if "!SEL!"=="" goto :fail

set "IDX=0"
set "GAMEDIR="
for /f "usebackq delims=" %%L in ("%CANDLIST%") do (
    set /a IDX+=1
    if "!IDX!"=="!SEL!" set "GAMEDIR=%%L"
)
if "!GAMEDIR!"=="" (
    echo   [X] 序号无效。
    goto :fail
)
echo.
echo   [√] 已选择：!GAMEDIR!
echo.
goto :install

:manual
echo.
set "GAMEDIR="
set /p GAMEDIR= 请输入游戏安装目录后回车: 
if "!GAMEDIR!"=="" goto :fail
call :verify "!GAMEDIR!"
if not "!VERIFYOK!"=="1" goto :fail
goto :install

rem ============================================================
rem  第二步：执行安装
rem ============================================================
:install
call :verify "!GAMEDIR!"
if not "!VERIFYOK!"=="1" goto :fail

echo   ------------------------------------------------------------
echo   游戏目录: !GAMEDIR!
echo   ------------------------------------------------------------
echo.

rem ---- 检测游戏是否在运行 ----
tasklist /FI "IMAGENAME eq 混在日本.exe" 2>nul | find /I "混在日本.exe" >nul
if not errorlevel 1 (
    echo   [!] 检测到游戏正在运行：混在日本.exe
    echo       请先关闭游戏，然后重新运行本程序。
    echo.
    pause
    goto :fail
)

for %%F in ("!GAMEDIR!\*.exe") do (
    set "EXEN=%%~nxF"
    tasklist /FI "IMAGENAME eq !EXEN!" 2>nul | find /I "!EXEN!" >nul
    if not errorlevel 1 (
        echo   [!] 检测到游戏进程正在运行：!EXEN!
        echo       请先关闭游戏，然后重新运行本程序。
        echo.
        pause
        goto :fail
    )
)

rem ---- 读取本次版本号 ----
set "NEWVER="
if exist "%OVLSRC%\version.json" (
    for /f "usebackq tokens=2 delims=:" %%V in (`findstr /i /c:"version" "%OVLSRC%\version.json"`) do (
        if "!NEWVER!"=="" (
            set "T=%%V"
            set "T=!T: =!"
            set "T=!T:,=!"
            set "T=!T:"=!"
            set "NEWVER=!T!"
        )
    )
)

rem ---- 备份旧覆盖层 ----
if exist "!GAMEDIR!\app_overlay" (
    echo   正在备份旧版本 ...
    if exist "!GAMEDIR!\app_overlay.bak" rd /s /q "!GAMEDIR!\app_overlay.bak" >nul 2>&1
    move "!GAMEDIR!\app_overlay" "!GAMEDIR!\app_overlay.bak" >nul 2>&1
    if errorlevel 1 (
        echo   [!] 旧版本备份失败，可能游戏仍在运行或权限不足。
        echo       请关闭游戏后重试，或右键本文件选择「以管理员身份运行」。
        echo.
        pause
        goto :fail
    )
    echo       旧版本已备份为 app_overlay.bak ^(可回退^)
) else (
    echo   未发现旧版本，本次为首次安装更新包。
)

rem ---- 复制新版本 ----
echo   正在安装更新 ...
xcopy "%OVLSRC%" "!GAMEDIR!\app_overlay" /E /I /Y /Q >nul
if errorlevel 1 (
    echo.
    echo   [X] 复制失败，通常是权限不足。
    echo       请右键本文件，选择「以管理员身份运行」后重试。
    echo       若仍失败，请确认游戏没有在运行、且目录未被占用。
    goto :fail
)

rem ---- 校验安装结果 ----
set "CHK=!GAMEDIR!\app_overlay\www\index.html"
if not exist "!CHK!" (
    echo   [!] 安装后校验失败：未找到 app_overlay\www\index.html
    echo       更新可能不完整，请重新运行本程序。
    goto :fail
)

echo.
echo ============================================================
if defined NEWVER (
    echo    更新完成！当前版本 v!NEWVER!
) else (
    echo    更新完成！
)
echo ============================================================
echo.
echo    请直接启动游戏，存档与进度保持不变。
echo.
echo    回退方法：
echo      删除游戏目录下的 app_overlay 文件夹，即可退回
echo      到更新前的版本；若想恢复上一版，把 app_overlay.bak
echo      改名为 app_overlay 即可。
echo.
pause
exit /b 0

rem ============================================================
rem  子过程：verify  —— 校验某目录是否为游戏目录
rem  返回 VERIFYOK=1 表示通过
rem  注意：块内路径一律用 !延迟展开!，避免路径中的括号破坏语法
rem ============================================================
:verify
set "VERIFYOK=0"
set "D=%~1"
if "!D!"=="" exit /b
if not exist "!D!\" exit /b

rem 排除更新包自身及其全部子目录
rem （更新包只含 app_overlay，不含游戏主体；若不排除会自己覆盖自己）
call :startswith "!D!" "!PKGDIR!"
if "!SW!"=="1" exit /b

if exist "!D!\混在日本.exe" set "VERIFYOK=1"
if exist "!D!\混在日本-便携版-*.exe" set "VERIFYOK=1"
if exist "!D!\resources\app.asar" set "VERIFYOK=1"
if exist "!D!\resources\app\package.json" set "VERIFYOK=1"

if "!VERIFYOK!"=="0" (
    if not defined QUIET (
        echo.
        echo   [X] 该目录看起来不是游戏目录：
        echo       !D!
        echo       应为包含「混在日本.exe」或 resources\app.asar 的文件夹。
        echo.
    )
)
exit /b

rem ============================================================
rem  子过程：startswith —— 判断 %~1 是否以 %~2 开头（不区分大小写）
rem  返回 SW=1 表示是；用 xcopy /L 做前缀探测，稳妥且无需逐字符循环
rem ============================================================
:startswith
set "SW=0"
set "HS=%~1"
set "HP=%~2"
if "!HS!"=="" exit /b
if "!HP!"=="" exit /b
rem 先比长度：HS 必须不短于 HP
call :strlen "!HP!"
set "L1=!SL!"
call :strlen "!HS!"
set "L2=!SL!"
if !L2! LSS !L1! exit /b
if /i "!HS:~0,%L1%!"=="!HP!" set "SW=1"
exit /b

rem ============================================================
rem  子过程：strlen —— 求 %~1 的字符长度，返回 SL
rem ============================================================
:strlen
set "SL=0"
set "SS=%~1"
:sl_loop
if "!SS:~%SL%,1!"=="" exit /b
set /a SL+=1
if !SL! LSS 500 goto :sl_loop
exit /b
exit /b

rem ============================================================
rem  子过程：scan —— 递归扫描指定目录（向下 4 层）
rem  用 for /f + dir /b /ad 实现，兼容含空格/中文/括号的路径
rem ============================================================
:scan
set "S=%~1"
if not exist "!S!\" exit /b
rem 更新包自身的 app_overlay 不是游戏，跳过整个更新包目录
if /i "!S!"=="!PKGDIR!" exit /b
call :verify "!S!"
if "!VERIFYOK!"=="1" call :add "!S!"
for /f "delims=" %%D in ('dir /b /ad "!S!" 2^>nul') do (
    set "D1=!S!\%%D"
    call :verify "!D1!"
    if "!VERIFYOK!"=="1" call :add "!D1!"
    for /f "delims=" %%E in ('dir /b /ad "!D1!" 2^>nul') do (
        set "D2=!D1!\%%E"
        call :verify "!D2!"
        if "!VERIFYOK!"=="1" call :add "!D2!"
        for /f "delims=" %%F in ('dir /b /ad "!D2!" 2^>nul') do (
            set "D3=!D2!\%%F"
            call :verify "!D3!"
            if "!VERIFYOK!"=="1" call :add "!D3!"
            for /f "delims=" %%G in ('dir /b /ad "!D3!" 2^>nul') do (
                set "D4=!D3!\%%G"
                call :verify "!D4!"
                if "!VERIFYOK!"=="1" call :add "!D4!"
            )
        )
    )
)
exit /b

rem ============================================================
rem  子过程：up —— 取 %~1 所指向变量的上一级目录
rem  （不用 for 的 .. 技巧，因其在部分环境下不可靠）
rem ============================================================
:up
set "V=!%~1!"
if "!V:~-1!"=="\" set "V=!V:~0,-1!"
if "!V!"=="" exit /b
set "LAST=-1"
set "IDX=0"
:up_charloop
if "!V:~%IDX%,1!"=="" goto :up_chardone
if "!V:~%IDX%,1!"=="\" set "LAST=!IDX!"
set /a IDX+=1
if !IDX! LSS 260 goto :up_charloop
:up_chardone
if !LAST! LEQ 0 (
    set "%~1="
    exit /b
)
set "%~1=!V:~0,%LAST%!"
exit /b

rem ============================================================
rem  子过程：scan_parents —— 向上逐级查找（最多 5 级）
rem  每到达一级祖先，就对该级做一次完整递归扫描：
rem  这样即使更新包与游戏位于仓库的两个不同分支也能找到
rem ============================================================
:scan_parents
set "P=%~1"
for /l %%I in (1,1,5) do (
    call :up P
    if not "!P!"=="" (
        call :scan "!P!"
    )
)
exit /b

rem ============================================================
rem  子过程：scan_root —— 扫描所在磁盘的常见安装位置
rem ============================================================
:scan_root
set "S=%~1"
set "DRV="
for %%R in ("!S!") do set "DRV=%%~dR"
if not defined DRV exit /b

for %%K in (
    "Games" "游戏" "Program Files" "Program Files (x86)"
    "hun" "混在日本" "Apps" "Software"
    "Steam\steamapps\common"
) do (
    set "SUB=!DRV!\%%~K"
    if exist "!SUB!\" call :scan "!SUB!"
)
exit /b

rem ============================================================
rem  子过程：scan_drive —— 扫描指定盘符根 + 2 层下探
rem ============================================================
:scan_drive
set "S=%~1"
if "!S!"=="" exit /b
if not exist "!S!\" exit /b
if /i "!S!"=="!PKGDIR!" exit /b
call :verify "!S!"
if "!VERIFYOK!"=="1" call :add "!S!"
for /f "delims=" %%D in ('dir /b /ad "!S!" 2^>nul') do (
    set "E1=!S!\%%D"
    call :verify "!E1!"
    if "!VERIFYOK!"=="1" call :add "!E1!"
    for /f "delims=" %%E in ('dir /b /ad "!E1!" 2^>nul') do (
        set "E2=!E1!\%%E"
        call :verify "!E2!"
        if "!VERIFYOK!"=="1" call :add "!E2!"
    )
)
exit /b

rem ============================================================
rem  子过程：add —— 去重后追加到候选表
rem ============================================================
:add
set "A=%~1"
if "!A!"=="" exit /b
if not exist "%CANDLIST%" (
    echo !A!>>"%CANDLIST%"
    exit /b
)
rem 用 findstr 逐行精确匹配去重
set "FOUND="
for /f "usebackq delims=" %%X in ("%CANDLIST%") do (
    if /i "%%X"=="!A!" set "FOUND=1"
)
if not defined FOUND echo !A!>>"%CANDLIST%"
exit /b

:fail
echo.
echo   安装未能完成。请根据上方提示处理后重新运行本程序。
echo.
echo   备选方案：直接把更新包内的 app_overlay 文件夹，
echo   整体复制到游戏安装目录（与「混在日本.exe」同一层）即可，
echo   效果与本程序完全相同。
echo.
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
