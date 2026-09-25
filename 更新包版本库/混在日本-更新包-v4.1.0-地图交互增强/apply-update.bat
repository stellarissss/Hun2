@echo off
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
