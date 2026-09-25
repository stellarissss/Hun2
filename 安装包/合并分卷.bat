@echo off
chcp 936 >nul
setlocal enabledelayedexpansion
title 混在日本 - 安装包分卷合并

echo ============================================================
echo         混在日本 PC 单机版 - 安装包分卷合并工具
echo ============================================================
echo.
echo  本工具会自动扫描当前目录下的所有 .part00 分卷，
echo  把每一组分卷合并为完整的 .exe。
echo.
echo  请确保本文件与所有分卷放在同一目录下。
echo.
pause

set "DONE=0"

rem ---- 自动扫描每一组 .partNN 分卷 ----
for %%P in (*.part00) do (
    rem 从 xxx.part00 得到基名 xxx
    set "BASE=%%~nP"
    if /i "!BASE:~-6!"==".part00" set "BASE=!BASE:~0,-6!"
    set "EXE=!BASE!.exe"

    echo.
    echo   正在合并: !EXE!

    rem 检查分卷是否连续齐全
    set "IDX=0"
    set "PARTS="
    :chkloop
    set "NN=0!IDX!"
    set "NN=!NN:~-2!"
    if not exist "!BASE!.part!NN!" goto :chkdend
    set "PARTS=!PARTS!+!BASE!.part!NN!"
    set /a IDX+=1
    goto :chkloop
    :chkdend

    if !IDX! EQU 0 (
        echo       [!] 未找到可用的分卷，跳过
    ) else (
        set "PARTS=!PARTS:~1!"
        if exist "!EXE!" del /q "!EXE!"
        copy /b !PARTS! "!EXE!" >nul
        if exist "!EXE!" (
            echo       完成: !EXE!  ^(共 !IDX! 个分卷^)
            set /a DONE+=1
        ) else (
            echo       [!] 合并失败，请检查分卷是否齐全
        )
    )
)

echo.
echo ============================================================
if !DONE! GTR 0 (
    echo   合并结束，共生成 !DONE! 个可执行文件。
) else (
    echo   未找到任何 .part00 分卷，请确认本文件与分卷在同一目录。
)
echo ============================================================
echo.
echo   可以直接双击生成的 .exe 开始安装 / 游玩。
echo   若下载的压缩包已给出 SHA-256，可用 PowerShell 校验：
echo     Get-FileHash .\安装包文件名.exe -Algorithm SHA256
echo.
pause
