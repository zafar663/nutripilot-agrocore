@echo off
setlocal
cd /d "%~dp0"

if not exist config.json (
  echo Missing config.json — download mill-edge again from Mill IQ for this mill.
  pause
  exit /b 1
)

set "INSTALLDIR=C:\NutriPilot\mill-edge"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "NODEEXE=%INSTALLDIR%\runtime\node.exe"
if not exist "%INSTALLDIR%" mkdir "%INSTALLDIR%"
if not exist "%INSTALLDIR%\runtime" mkdir "%INSTALLDIR%\runtime"
xcopy /y /q "%~dp0index.js" "%INSTALLDIR%\" >nul
xcopy /y /q "%~dp0START.bat" "%INSTALLDIR%\" >nul
xcopy /y /q "%~dp0README.txt" "%INSTALLDIR%\" >nul
copy /y "%~dp0config.json" "%INSTALLDIR%\config.json" >nul
if exist "%~dp0runtime\node.exe" copy /y "%~dp0runtime\node.exe" "%NODEEXE%" >nul

if not exist "C:\Batching\Export" mkdir "C:\Batching\Export" 2>nul
if not exist "%INSTALLDIR%\watch\sent" mkdir "%INSTALLDIR%\watch\sent" 2>nul
if not exist "%INSTALLDIR%\watch\failed" mkdir "%INSTALLDIR%\watch\failed" 2>nul

del /q "%INSTALLDIR%\run-hidden.vbs" 2>nul
del /q "%STARTUP%\NutriPilot mill-edge.vbs" 2>nul

if not exist "%NODEEXE%" (
  echo Preparing mill-edge. Please wait...
  powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $o='%NODEEXE%'; try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 600 -Uri 'https://agrocoreprime.com/mill-edge/node.exe' -OutFile $o } catch { Invoke-WebRequest -UseBasicParsing -TimeoutSec 600 -Uri 'https://nodejs.org/dist/v20.20.2/win-x64/node.exe' -OutFile $o }"
)

set "NODESIZE=0"
for %%A in ("%NODEEXE%") do set "NODESIZE=%%~zA"
if %NODESIZE% LSS 1000000 (
  del /q "%NODEEXE%" 2>nul
  echo Could not prepare mill-edge. Check internet on this PC and run INSTALL again.
  pause
  exit /b 1
)

> "%STARTUP%\NutriPilot mill-edge.cmd" echo @echo off
>> "%STARTUP%\NutriPilot mill-edge.cmd" echo powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '%NODEEXE%' -ArgumentList 'index.js' -WorkingDirectory '%INSTALLDIR%' -WindowStyle Hidden"

powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '%NODEEXE%' -ArgumentList 'index.js' -WorkingDirectory '%INSTALLDIR%' -WindowStyle Hidden"
exit
