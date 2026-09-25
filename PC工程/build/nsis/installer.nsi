Var newStartMenuLink
Var oldStartMenuLink
Var newDesktopLink
Var oldDesktopLink
Var oldShortcutName
Var oldMenuDirectory

; ---------------------------------------------------------------------------
; 自定义 NSIS 脚本（PC 单机版）
;
; 目的：在 Linux 上完成 Windows 安装包构建，且不依赖 wine。
;   electron-builder 内置模板会先「预生成卸载器」再由 wine 运行安装器
;   将其提取出来嵌入（见 include/installer.nsh 的 File 指令）。
;   本工程改用虚拟路径策略：
;     · 使用自定义脚本（electron-builder 因此跳过 wine 调用）
;     · build/nsis/include/installer.nsh 为内置模板的副本，
;       其中「预生成嵌入」被替换为 NSIS 原生 WriteUninstaller，
;       产物功能完全等价，构建过程跨平台一致。
;
; 注意：自定义脚本需自行声明模板 include 搜索路径，
;       且 build/nsis/include 必须排在首位以命定制的 installer.nsh。
; ---------------------------------------------------------------------------
!addincludedir "${PROJECT_DIR}/build/nsis/include"
!addincludedir "${PROJECT_DIR}/node_modules/app-builder-lib/templates/nsis/include"
!addincludedir "${PROJECT_DIR}/node_modules/app-builder-lib/templates/nsis"

!include "common.nsh"
!include "MUI2.nsh"
!include "multiUser.nsh"
!include "allowOnlyOneInstallerInstance.nsh"

!ifdef INSTALL_MODE_PER_ALL_USERS
  !ifdef BUILD_UNINSTALLER
    RequestExecutionLevel user
  !else
    RequestExecutionLevel admin
  !endif
!else
  RequestExecutionLevel user
!endif

!ifdef BUILD_UNINSTALLER
  SilentInstall silent
!else
  Var appExe
  Var launchLink
!endif

!ifdef ONE_CLICK
  !include "oneClick.nsh"
!else
  !include "assistedInstaller.nsh"
!endif

!insertmacro addLangs

!ifmacrodef customHeader
  !insertmacro customHeader
!endif

Function .onInit
  Call setInstallSectionSpaceRequired

  SetOutPath $INSTDIR
  ${LogSet} on

  !ifmacrodef preInit
    !insertmacro preInit
  !endif

  !ifdef DISPLAY_LANG_SELECTOR
    !insertmacro MUI_LANGDLL_DISPLAY
  !endif

  !ifdef BUILD_UNINSTALLER
    WriteUninstaller "${UNINSTALLER_OUT_FILE}"
    !insertmacro quitSuccess
  !else
    !insertmacro check64BitAndSetRegView

    !ifdef ONE_CLICK
      !insertmacro ALLOW_ONLY_ONE_INSTALLER_INSTANCE
    !else
      ${IfNot} ${UAC_IsInnerInstance}
        !insertmacro ALLOW_ONLY_ONE_INSTALLER_INSTANCE
      ${EndIf}
    !endif

    !insertmacro initMultiUser

    !ifmacrodef customInit
      !insertmacro customInit
    !endif

    !ifmacrodef addLicenseFiles
      InitPluginsDir
      !insertmacro addLicenseFiles
    !endif
  !endif
FunctionEnd

!ifndef BUILD_UNINSTALLER
  !include "installUtil.nsh"
!endif

Section "install" INSTALL_SECTION_ID
  !ifndef BUILD_UNINSTALLER
    # If we're running a silent upgrade of a per-machine installation, elevate so extracting the new app will succeed.
    # For a non-silent install, the elevation will be triggered when the install mode is selected in the UI,
    # but that won't be executed when silent.
    !ifndef INSTALL_MODE_PER_ALL_USERS
      !ifndef ONE_CLICK
          ${if} $hasPerMachineInstallation == "1" # set in onInit by initMultiUser
          ${andIf} ${Silent}
            ${ifNot} ${UAC_IsAdmin}
              ShowWindow $HWNDPARENT ${SW_HIDE}
              !insertmacro UAC_RunElevated
              ${Switch} $0
                ${Case} 0
                  ${Break}
                ${Case} 1223 ;user aborted
                  ${Break}
                ${Default}
                  MessageBox mb_IconStop|mb_TopMost|mb_SetForeground "Unable to elevate, error $0"
                  ${Break}
              ${EndSwitch}
              Quit
            ${else}
              !insertmacro setInstallModePerAllUsers
            ${endIf}
          ${endIf}
      !endif
    !endif
    !include "installSection.nsh"
  !endif
SectionEnd

Function setInstallSectionSpaceRequired
  !insertmacro setSpaceRequired ${INSTALL_SECTION_ID}
FunctionEnd

; ---------------------------------------------------------------------------
; 【本工程改动】无条件装载卸载 Section
; ---------------------------------------------------------------------------
; 上游流程里卸载器是「预生成 + 嵌入」，正常构建无需卸载 Section。
; 本工程改为安装时用 NSIS 原生 WriteUninstaller 生成卸载器，
; 这要求脚本中存在对应 Section（uninstaller.nsh 中的 un.install）。
; ---------------------------------------------------------------------------
!include "uninstaller.nsh"