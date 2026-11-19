@echo off
setlocal
pushd "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\package-extension.ps1"
set "package_exit_code=%ERRORLEVEL%"
popd
exit /b %package_exit_code%
