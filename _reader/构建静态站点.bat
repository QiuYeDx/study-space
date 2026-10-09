@echo off
rem 生成可部署到 OSS 等静态服务器的 _dist 目录（在仓库根目录下）
cd /d "%~dp0"
where python >nul 2>nul || (echo 没有找到 python，请先安装 Python 3 & pause & exit /b 1)
python build.py %*
if errorlevel 1 (pause & exit /b 1)
if not defined NO_PAUSE pause
