@echo off
setlocal
cd /d "%~dp0"
set "TAOBAO_VISION_BACKEND=workbuddy"
uv run python app.py
if errorlevel 1 pause
