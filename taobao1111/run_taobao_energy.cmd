@echo off
cd /d "%~dp0"
uv run python -u tools/taobao_energy.py run --repeat 30 %*
if errorlevel 1 pause
