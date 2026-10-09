@echo off
cd /d "%~dp0"
set PORT=
call "%~dp0config.bat"
if not defined PORT set PORT=8080

netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul
if not errorlevel 1 (
  echo 阅读器已经在运行：http://localhost:%PORT%/_reader/
) else (
  where python >nul 2>nul || (echo 没有找到 python，请先安装 Python 3 & pause & exit /b 1)
  start "学习空间阅读器 - 端口 %PORT%（关闭此窗口即停止）" /min python -m http.server %PORT% --bind 0.0.0.0 --directory ..
  timeout /t 1 /nobreak >nul
  echo 阅读器已启动：http://localhost:%PORT%/_reader/
)
if not defined NO_BROWSER start "" "http://localhost:%PORT%/_reader/"
timeout /t 2 >nul
