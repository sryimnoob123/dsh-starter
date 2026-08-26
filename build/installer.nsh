; dsh-starter NSIS custom scripts (auto-included by electron-builder from build/installer.nsh).
;
; NOTE: This file MUST be pure ASCII. NSIS on Windows reads include files as ACP
; (system code page); any non-ASCII (e.g. Chinese comments) triggers
; "Bad text encoding" and the WHOLE file fails to load -> every custom macro
; below is silently skipped. That is why v0.4.3..v0.4.6 custom macros never ran.
;
; Problem 1: dsh (node) service may still be running during uninstall and lock
; files, so "delete tools don't clean up". Kill leftover dsh processes first.
;
; Problem 2 (P0 data loss, 2026-08-24): electron-updater runs the OLD uninstaller
; with --updated. The template uninstaller.nsh's isUpdated branch moves the whole
; $INSTDIR (including user data dsh-home, which holds sessions + API keys +
; user skills at dsh-home/skills) into $PLUGINSDIR\old-install, then RMDir /r
; $INSTDIR, and NSIS cleans $PLUGINSDIR on exit -> user data silently lost.
;
; Fix: define customRemoveFiles (fully takes over the template delete block).
; On update: move $INSTDIR\dsh-home to $TEMP\dsh-home-preserve (fixed name,
; visible across processes), delete everything else, then let the new installer
; (also --updated) move it back in customInstall. On plain uninstall: delete
; dsh-home/dsh as before.
;
; IMPORTANT: only use NSIS core commands (IfFileExists/StrCpy/Goto) here.
; Do NOT rely on LogicLib ${if}/${If} (its macro expansion may not be available
; in every compile unit). Keep it ASCII.

!macro customRemoveFiles
  ; Kill leftover dsh node processes (match narrows to @deepseek-ai\dsh to not
  ; kill unrelated node services; security review P3).
  nsExec::ExecToLog `powershell.exe -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $$_.Name -eq 'node.exe' -and $$_.CommandLine -like '*@deepseek-ai*dsh*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  ; [2026-08-25 卸载残留修复] Kill the shell main process too: it locks exe/dll
  ; files, so RMDir below fails and the whole install dir survives uninstall
  ; (VM-observed: uninstall left the app fully installed). taskkill /F /IM by
  ; image name covers the app running from any path.
  nsExec::ExecToLog `taskkill.exe /F /IM deepseek-harness-starter.exe`
  Sleep 2000

  ; Probe: does the old dsh-home exist at all? If yes we treat as update-safe.
  IfFileExists "$INSTDIR\dsh-home\*.*" 0 do_normal_uninstall
    ; UPDATE: preserve dsh-home (user data + skills) to a fixed temp dir,
    ; delete everything else, recreate $INSTDIR for the new installer.
    IfFileExists "$TEMP\dsh-home-preserve" 0 +2
      RMDir /r "$TEMP\dsh-home-preserve"
    CreateDirectory "$TEMP\dsh-home-preserve"
    Rename "$INSTDIR\dsh-home" "$TEMP\dsh-home-preserve\dsh-home"
    IfFileExists "$INSTDIR\dsh-home\*.*" 0 +2
      CopyFiles /SILENT "$INSTDIR\dsh-home\*.*" "$TEMP\dsh-home-preserve\dsh-home\"
      RMDir /r "$INSTDIR\dsh-home"
    RMDir /r "$INSTDIR"
    CreateDirectory "$INSTDIR"
    Goto cleanup_done
  do_normal_uninstall:
    ; PLAIN UNINSTALL: delete dsh-home + dsh runtime + everything else.
    RMDir /r "$INSTDIR\dsh-home"
    RMDir /r "$INSTDIR\dsh"
    RMDir /r "$INSTDIR"
    CreateDirectory "$INSTDIR"
  cleanup_done:
!macroend

!macro customInstall
  ; NEW installer (--updated): move preserved dsh-home back into the new $INSTDIR.
  IfFileExists "$TEMP\dsh-home-preserve\dsh-home\*.*" 0 install_done
    IfFileExists "$INSTDIR\dsh-home\*.*" 0 +2
      Goto cleanup_preserve
    Rename "$TEMP\dsh-home-preserve\dsh-home" "$INSTDIR\dsh-home"
    IfFileExists "$TEMP\dsh-home-preserve\dsh-home\*.*" 0 +2
      CopyFiles /SILENT "$TEMP\dsh-home-preserve\dsh-home\*.*" "$INSTDIR\dsh-home\"
      RMDir /r "$TEMP\dsh-home-preserve\dsh-home"
  cleanup_preserve:
    RMDir /r "$TEMP\dsh-home-preserve"
  install_done:
!macroend

!macro customUnInstall
  ; NON-UPDATE uninstall cleanup: remove leftover install dir files. Runs AFTER
  ; the template uninstaller already removed what it could; we sweep the rest.
  ; [2026-08-25 卸载残留修复] Old logic skipped everything when the main exe
  ; still existed (left the app fully installed). Now: force-delete whatever
  ; remains; locked files were unlocked by customRemoveFiles' taskkill; any
  ; still-locked leftover is logged by NSIS's default uninstall log.
  SetOutPath "$TEMP"
  RMDir /r "$INSTDIR\dsh-home"
  RMDir /r "$INSTDIR\dsh"
  RMDir /r "$INSTDIR"
!macroend

; ---------------------------------------------------------------------------
; customInit (2026-08-25 P0 数据丢失第三道防线):
; Runs in .onInit, BEFORE uninstallOldVersion (which runs the OLD uninstaller
; that may delete the whole $INSTDIR including dsh-home user data).
; The shell-side backup (backupDshHomeBeforeUpdate) only runs in the NEW shell,
; which is not running yet during an old->new update -- so the installer must
; back up the OLD dsh-home itself, right here, before the old uninstaller runs.
;
; Reads the previous InstallLocation from registry (HKLM then HKCU), and if
; <oldInstallDir>\dsh-home exists, copies it to %TEMP%\dsh-home-backup.
; The new shell restores from that backup on first launch if dsh-home is empty.
;
; IMPORTANT: pure ASCII, NSIS core commands only (ReadRegStr/IfFileExists/
; StrCpy/Goto). No LogicLib ${if} (macro expansion may be unavailable in every
; compile unit). Failure is non-fatal: never block the install.
!macro customInit
  ; Only back up when this is an update (old install exists). Fresh installs
  ; have no old dsh-home to preserve.
  ReadRegStr $R0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCmp "$R0" "" 0 do_backup_old_home
  ReadRegStr $R0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCmp "$R0" "" init_done
  do_backup_old_home:
  ; $R0 = old install dir. Guard: must contain dsh-home.
  IfFileExists "$R0\dsh-home\*.*" 0 init_done
  ; Clear any stale backup, then copy dsh-home -> %TEMP%\dsh-home-backup\dsh-home
  IfFileExists "$TEMP\dsh-home-backup" 0 +2
    RMDir /r "$TEMP\dsh-home-backup"
  CreateDirectory "$TEMP\dsh-home-backup"
  CreateDirectory "$TEMP\dsh-home-backup\dsh-home"
  CopyFiles /SILENT "$R0\dsh-home\*.*" "$TEMP\dsh-home-backup\dsh-home\"
  init_done:
!macroend
