@echo off
cd /d "%~dp0"
set PORT=
call "%~dp0config.bat"
if not defined PORT set PORT=8080
set FOUND=
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do (
  taskkill /PID %%P /F >nul 2>nul && set FOUND=1
)
if defined FOUND (echo 阅读器已停止（端口 %PORT%）) else (echo 阅读器没有在运行（端口 %PORT%）)
timeout /t 2 >nul
