@echo off
cd /d "%~dp0"
uv run python configure.py
if errorlevel 1 pause
