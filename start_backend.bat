@echo off
echo Starting Arena Tracker Backend...
cd /d "%~dp0"

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo Python not found. Please install Python 3.11+ from python.org
    pause
    exit /b 1
)

pip show flask >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing dependencies...
    pip install -r requirements.txt
)

python backend/main.py
pause
