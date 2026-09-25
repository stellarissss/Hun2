@echo off
chcp 936 >nul
setlocal enabledelayedexpansion
title 混在日本 - 安装包分卷合并

echo ============================================================
echo         混在日本 PC 单机版 - 安装包分卷合并工具
echo ============================================================
echo.
echo  本工具会把当前目录下的 .partNN 分卷合并为完整的 .exe
echo.
echo  请确保本文件与分卷文件放在同一目录下。
echo.
pause

rem ---- 合并安装版 ----
set "FOUND="
if exist "混在日本-4.1.0-x64.part00" set "FOUND=1"

if defined FOUND (
    echo.
    echo [1/2] 正在合并安装版...
    if exist "混在日本-4.1.0-x64.exe" del /q "混在日本-4.1.0-x64.exe"
    copy /b ^
        混在日本-4.1.0-x64.part00+^
混在日本-4.1.0-x64.part01+^
混在日本-4.1.0-x64.part02+^
混在日本-4.1.0-x64.part03+^
混在日本-4.1.0-x64.part04 ^
        "混在日本-4.1.0-x64.exe" >nul
    if exist "混在日本-4.1.0-x64.exe" (
        echo       完成: 混在日本-4.1.0-x64.exe
    ) else (
        echo       [!] 合并失败，请检查分卷是否齐全
    )
) else (
    echo.
    echo [1/2] 未找到安装版分卷，跳过
)

rem ---- 合并便携版 ----
set "FOUND2="
if exist "混在日本-便携版-4.1.0.part00" set "FOUND2=1"

if defined FOUND2 (
    echo.
    echo [2/2] 正在合并便携版...
    if exist "混在日本-便携版-4.1.0.exe" del /q "混在日本-便携版-4.1.0.exe"
    copy /b ^
        混在日本-便携版-4.1.0.part00+^
混在日本-便携版-4.1.0.part01+^
混在日本-便携版-4.1.0.part02+^
混在日本-便携版-4.1.0.part03+^
混在日本-便携版-4.1.0.part04 ^
        "混在日本-便携版-4.1.0.exe" >nul
    if exist "混在日本-便携版-4.1.0.exe" (
        echo       完成: 混在日本-便携版-4.1.0.exe
    ) else (
        echo       [!] 合并失败，请检查分卷是否齐全
    )
) else (
    echo.
    echo [2/2] 未找到便携版分卷，跳过
)

echo.
echo ============================================================
echo   合并结束。可以直接双击生成的 .exe 开始安装 / 游玩。
echo ============================================================
echo.
echo  如已安装 PowerShell，可用以下命令校验 SHA-256：
echo    Get-FileHash .\混在日本-4.1.0-x64.exe -Algorithm SHA256
echo.
echo  期望值（安装版）:
echo    e14e57170266a19d257f1cd269c9c8a92e76e66be82ce85f6914291033408114
echo  期望值（便携版）:
echo    4e22e68296557497546e43fc5e0d1a9041913ad00f2faa2eb88c5bc486d40658
echo.
pause
