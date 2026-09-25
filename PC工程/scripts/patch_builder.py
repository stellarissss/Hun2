#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
patch_builder.py —— 为 electron-builder 打「免 wine / 免 Windows 宿主机」补丁
=========================================================================

背景
----
本项目在 Linux 上交叉构建 Windows NSIS 安装包。electron-builder 的原生流程会
两次调用 makensis：

    ① 先只编「卸载器」产物（BUILD_UNINSTALLER 定义）
    ② 再编「安装器」产物，并把 ① 的卸载器用 `File` 嵌进去

第 ② 步之前，electron-builder 需要在宿主机**运行**安装器才能把卸载器「提取」
出来（见 app-builder-lib/out/targets/nsis/NsisTarget.js 中的 execWine 调用）。
Linux 上没有 wine 就会直接失败：`wine is required`。

而 Debian/Ubuntu 当前源里只有 libwine，没有可用的 wine 命令，所以这条路走不通。

补丁思路
--------
上游之所以要「预生成 + 嵌入」，只是为了让卸载器本身也带图标/版本信息。
NSIS 从 2.x 起就原生提供 `WriteUninstaller`，它在**安装时**由安装器自己吐
出卸载器，功能等价，代价仅仅是卸载器 exe 少了自定义图标（不影响卸载功能）。

因此本脚本做三件事：

  1. `include/installer.nsh`
     `File "/oname=${UNINSTALL_FILENAME}" "${UNINSTALLER_OUT_FILE}"`
       ↓
     `WriteUninstaller "$INSTDIR\${UNINSTALL_FILENAME}"`

  2. `include/getProcessInfo.nsh`
     上游的 `GetProcessInfo` 宏按 `BUILD_UNINSTALLER` 二选一 `Call _GetProcessInfo`
     或 `Call un._GetProcessInfo`。一旦我们让同一个脚本里同时存在安装/卸载两个
     Section，这个二选一就会撞上 NSIS 的硬性约束 —— **卸载 Section 里只能 Call
     以 `un.` 开头的函数**。
     规避办法：把进程查询函数体**内联展开**（`!insertmacro FUNC_GETPROCESSINFO`），
     彻底不 Call，前缀约束自然失效。同时把两个包装函数都定义出来，兼容其它外部引用。

  3. 运行时不再需要卸载器的「预生成阶段」，`build/nsis/installer.nsi` 里改成
     无条件 `!include "uninstaller.nsh"`（见该文件尾部注释）。
     NSIS 要求：只要用了 `WriteUninstaller`，脚本中就必须真的存在 Uninstall Section。

用法
----
    python3 scripts/patch_builder.py          # 应用补丁（幂等，可重复执行）
    python3 scripts/patch_builder.py --check  # 只检查，不改动
    python3 scripts/patch_builder.py --revert # 从上游模板还原

注意
----
补丁作用于 `node_modules/`，**不在版本控制范围内**。
每次 `npm install` / 重装依赖后都需要重新执行本脚本。
这正是 `package.json` 里加 `"postinstall": "python3 scripts/patch_builder.py"` 的原因。
=========================================================================
"""

import argparse
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)

TPL = os.path.join(
    PROJ, "node_modules", "app-builder-lib", "templates", "nsis", "include"
)

TARGETS = {
    "installer.nsh": os.path.join(TPL, "installer.nsh"),
    "getProcessInfo.nsh": os.path.join(TPL, "getProcessInfo.nsh"),
}

# ---------------------------------------------------------------------------
# 补丁 ①  installer.nsh
# ---------------------------------------------------------------------------
INSTALLER_OLD = 'File "/oname=${UNINSTALL_FILENAME}" "${UNINSTALLER_OUT_FILE}"'

INSTALLER_NEW = r"""  # [HUN-PC PATCH] 预生成嵌入 -> 安装时内联生成
  # 上游需在宿主机运行安装器以提取卸载器（Linux 下即 wine）。
  # 改为 NSIS 原生 WriteUninstaller，产物功能等价，构建不再依赖 wine。
  WriteUninstaller "$INSTDIR\${UNINSTALL_FILENAME}\""""

# ---------------------------------------------------------------------------
# 补丁 ②  getProcessInfo.nsh —— GetProcessInfo 宏体
# ---------------------------------------------------------------------------
GETPROC_OLD = r"""!macro GetProcessInfo pid_in pid_out ppid priority name fullname
    Push ${pid_in}
!ifdef BUILD_UNINSTALLER
    Call un._GetProcessInfo
!else
    Call _GetProcessInfo
!endif
    ;name;pri;ppid;fname;pid;
    Pop ${name}
    Pop ${priority}
    Pop ${ppid}
    Pop ${fullname}
    Pop ${pid_out}
!macroend"""

GETPROC_NEW = r"""!macro GetProcessInfo pid_in pid_out ppid priority name fullname
    Push ${pid_in}
    ; [HUN-PC PATCH] 上游按 BUILD_UNINSTALLER 选择 _GetProcessInfo / un._GetProcessInfo。
    ; 单次构建下该宏可能同时被安装与卸载上下文展开，Call 的目标必须是
    ; 以 un. 开头的函数（卸载 Section 的硬性约束），二选一无法两全。
    ; 因此改为：把进程查询函数体直接内联展开，规避 Call 的前缀限制。
    ; 内联后不再需要 _GetProcessInfo / un._GetProcessInfo 两个包装函数。
    !insertmacro FUNC_GETPROCESSINFO
    ;name;pri;ppid;fname;pid;
    Pop ${name}
    Pop ${priority}
    Pop ${ppid}
    Pop ${fullname}
    Pop ${pid_out}
!macroend"""

# ---------------------------------------------------------------------------
# 补丁 ③  getProcessInfo.nsh —— 两个包装函数改为「都定义」
# ---------------------------------------------------------------------------
WRAPPERS_OLD = r"""!ifndef BUILD_UNINSTALLER
Function _GetProcessInfo
    !insertmacro FUNC_GETPROCESSINFO
FunctionEnd
!endif

!ifdef BUILD_UNINSTALLER
Function un._GetProcessInfo
    !insertmacro FUNC_GETPROCESSINFO
FunctionEnd
!endif"""

WRAPPERS_NEW = r"""; [HUN-PC PATCH] 保留上游两个包装函数以兼容外部引用；
; 本工程的 GetProcessInfo 宏已改为内联展开，不再 Call 它们。
; 使同一次 makensis 构建可同时满足安装与卸载两个上下文
; （卸载上下文要求函数名以 un. 前缀，见 NSIS 官方约束）。
; include 守卫 GETPROCESSINFO_INCLUDED 已确保本文件只处理一次，不会重复定义。
Function _GetProcessInfo
    !insertmacro FUNC_GETPROCESSINFO
FunctionEnd

Function un._GetProcessInfo
    !insertmacro FUNC_GETPROCESSINFO
FunctionEnd"""


def _read(path):
    with open(path, "r", encoding="utf-8", errors="surrogateescape") as f:
        return f.read()


def _write(path, text):
    with open(path, "w", encoding="utf-8", errors="surrogateescape") as f:
        f.write(text)


def _backup(path):
    bak = path + ".orig"
    if not os.path.exists(bak):
        shutil.copy2(path, bak)
        print("    备份 -> %s" % os.path.relpath(bak, PROJ))


def apply_one(name, old, new, label):
    path = TARGETS[name]
    if not os.path.exists(path):
        print("  [跳过] %s 不存在（依赖未安装？）" % name)
        return None
    src = _read(path)

    if new.split("\n")[0] and new.strip()[:40] in src:
        print("  [已打] %s :: %s" % (name, label))
        return True

    if old not in src:
        print("  [警告] %s :: %s —— 未找到上游原文，可能版本已变，跳过" % (name, label))
        return False

    _backup(path)
    _write(path, src.replace(old, new, 1))
    print("  [成功] %s :: %s" % (name, label))
    return True


def cmd_apply():
    print("应用 electron-builder 免 wine 补丁 ...")
    print("模板目录: %s\n" % os.path.relpath(TPL, PROJ))

    if not os.path.isdir(TPL):
        print("错误：未找到 app-builder-lib 模板目录，请先执行 npm install。")
        return 1

    ok = []

    ok.append(
        apply_one(
            "installer.nsh",
            INSTALLER_OLD,
            INSTALLER_NEW,
            "File 嵌入卸载器 -> WriteUninstaller 内联生成",
        )
    )
    ok.append(
        apply_one("getProcessInfo.nsh", GETPROC_OLD, GETPROC_NEW, "GetProcessInfo 宏内联展开")
    )
    ok.append(
        apply_one(
            "getProcessInfo.nsh", WRAPPERS_OLD, WRAPPERS_NEW, "两套包装函数皆定义"
        )
    )

    print()
    if all(x is not False for x in ok):
        print("补丁完成。")
        return 0
    print("部分补丁未应用，请检查 electron-builder 版本是否与补丁预期一致。")
    return 1


def cmd_check():
    print("检查补丁状态 ...\n")
    bad = 0
    for name in ("installer.nsh", "getProcessInfo.nsh"):
        path = TARGETS[name]
        if not os.path.exists(path):
            print("  [缺失] %s" % name)
            bad += 1
            continue
        src = _read(path)
        n = src.count("[HUN-PC PATCH]")
        state = "已打补丁 (%d 处标记)" % n if n else "未打补丁"
        print("  [%s] %s" % (state, name))
        if not n:
            bad += 1
    print()
    print("结论：%s" % ("全部就绪。" if not bad else "存在未打补丁的文件，请运行本脚本。"))
    return 0 if not bad else 1


def cmd_revert():
    print("还原上游模板 ...\n")
    for name in ("installer.nsh", "getProcessInfo.nsh"):
        bak = TARGETS[name] + ".orig"
        if os.path.exists(bak):
            shutil.copy2(bak, TARGETS[name])
            print("  [还原] %s" % name)
        else:
            print("  [无备份] %s —— 无法还原" % name)
    print("\n完成。")
    return 0


def main():
    ap = argparse.ArgumentParser(
        description="为 electron-builder 打免 wine 补丁（Windows 安装包可在 Linux 上构建）"
    )
    ap.add_argument("--check", action="store_true", help="只检查补丁状态")
    ap.add_argument("--revert", action="store_true", help="还原上游模板")
    args = ap.parse_args()

    if args.check:
        return cmd_check()
    if args.revert:
        return cmd_revert()
    return cmd_apply()


if __name__ == "__main__":
    sys.exit(main())
