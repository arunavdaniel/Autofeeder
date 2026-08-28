!define APP_NAME "RSS Text Reader"
!define EXE_NAME "RSS Text Reader.exe"

Name "${APP_NAME}"
OutFile "RSS-Text-Reader-Windows-Installer.exe"
InstallDir "$PROGRAMFILES64\RSS Text Reader"
RequestExecutionLevel admin

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "Install"
  SetOutPath "$INSTDIR"
  File "dist\RSS Text Reader.exe"
  CreateDirectory "$SMPROGRAMS\RSS Text Reader"
  CreateShortcut "$DESKTOP\RSS Text Reader.lnk" "$INSTDIR\${EXE_NAME}"
  CreateShortcut "$SMPROGRAMS\RSS Text Reader\RSS Text Reader.lnk" "$INSTDIR\${EXE_NAME}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\RSS Text Reader.lnk"
  Delete "$SMPROGRAMS\RSS Text Reader\RSS Text Reader.lnk"
  RMDir "$SMPROGRAMS\RSS Text Reader"
  RMDir /r "$INSTDIR"
SectionEnd
