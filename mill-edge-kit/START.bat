@echo off
cd /d "%~dp0"
set "NODEEXE=%~dp0runtime\node.exe"
if not exist "%NODEEXE%" set "NODEEXE=node"
if not exist config.json (
  echo Missing config.json — download mill-edge again from Mill IQ for this mill.
  pause
  exit /b 1
)
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '%NODEEXE%' -ArgumentList 'index.js' -WorkingDirectory '%~dp0.' -WindowStyle Hidden"
exit
