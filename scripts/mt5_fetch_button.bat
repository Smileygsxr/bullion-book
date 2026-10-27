@echo off
setlocal

rem Make sure MT5 is open and logged into your broker before running this.

set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%.."
set "VENV_PY=%PROJECT_DIR%\.venv\Scripts\python.exe"

rem The MT5 package lives in a local .venv, not the system Python: uv-managed
rem Python installs refuse a plain "pip install MetaTrader5" (PEP 668). This
rem creates that venv the first time you run the button, then reuses it.
if not exist "%VENV_PY%" (
    echo Setting up the MT5 fetcher environment for the first time...
    where uv >nul 2>nul
    if errorlevel 1 (
        echo Could not find "uv" on this PC.
        echo Install it from https://docs.astral.sh/uv/ then run this again.
        pause
        exit /b 1
    )
    uv venv --python 3.14 "%PROJECT_DIR%\.venv"
    uv pip install --python "%PROJECT_DIR%\.venv" MetaTrader5
)

echo.
echo Fetching from MT5 - make sure the terminal is open and logged in...
echo.
"%VENV_PY%" "%SCRIPT_DIR%mt5_fetch_button.py"

echo.
echo Done. New files (if any) are already in bullion-book\data.
pause
