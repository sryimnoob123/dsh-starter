; 卸载时的兜底清理（electron-builder 会自动包含 build/installer.nsh）。
; 问题：DSH 服务是 node 进程，卸载时若仍残留会锁住文件，导致「删除工具删不干净」。
; 处理：卸载时先杀掉残留的 dsh 服务，再删运行时生成的 dsh-home / dsh 目录。
; 重要：用 ${ifNot} ${isUpdated} 保护——自动更新（--updated）时跳过，绝不能删掉用户数据 dsh-home。
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; 1) 杀掉残留的 dsh 服务（node.exe 且命令行含 dsh），解锁被占用的文件
    nsExec::ExecToLog `powershell.exe -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $$_.Name -eq 'node.exe' -and $$_.CommandLine -like '*dsh*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
    ; 2) 双保险删掉运行时生成的 dsh-home / dsh（默认 RMDir /r $INSTDIR 之外）
    RMDir /r "$INSTDIR\dsh-home"
    RMDir /r "$INSTDIR\dsh"
    ; 3) 删掉空的安装目录本身（默认 RMDir /r 会残留一个空壳目录）
    SetOutPath "$TEMP"
    RMDir "$INSTDIR"
  ${endIf}
!macroend
