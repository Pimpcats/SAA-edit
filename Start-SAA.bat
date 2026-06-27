@echo off
title Wai Character Select (SAA-edit)
cd /d "%~dp0"

rem --- Check Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [SAA] Node.js is not installed or not on your PATH.
  echo       Install the LTS version from https://nodejs.org then run this again.
  echo.
  pause
  exit /b 1
)

rem --- First run: install dependencies ---
if not exist "node_modules\" (
  echo.
  echo [SAA] First launch - installing dependencies. This can take a few minutes...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [SAA] npm install failed. See the messages above.
    pause
    exit /b 1
  )
)

rem --- Create a Desktop shortcut on first run ---
set "SHORTCUT=%USERPROFILE%\Desktop\SAA-edit.lnk"
if not exist "%SHORTCUT%" (
  echo [SAA] Creating Desktop shortcut "SAA-edit"...
  set "ICON=%~dp0node_modules\electron\dist\electron.exe"
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%SHORTCUT%');" ^
    "$s.TargetPath='%~f0';" ^
    "$s.WorkingDirectory='%~dp0';" ^
    "if (Test-Path '%ICON%') { $s.IconLocation='%ICON%,0' };" ^
    "$s.Save()" 2>nul
)

echo.
echo [SAA] Launching the app...
echo.
call npm start
