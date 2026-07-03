@echo off
setlocal

rem Make sure MT5 is open and logged into your broker before running this.
rem First time only: pip install MetaTrader5

set "SCRIPT_DIR=%~dp0"

where python >nul 2>nul
if %errorlevel%==0 (
    set "PYCMD=python"
) else (
    where py >nul 2>nul
    if %errorlevel%==0 (
        set "PYCMD=py"
    ) else (
        echo Could not find Python on this PC.
        echo Install it from python.org and make sure "Add python.exe to PATH"
        echo is checked during setup, then run this again.
        pause
        exit /b 1
    )
)

%PYCMD% -c "import MetaTrader5" >nul 2>nul
if errorlevel 1 (
    echo The MetaTrader5 package isn't installed yet. Installing it now...
    %PYCMD% -m pip install MetaTrader5
)

echo.
echo Fetching from MT5 - make sure the terminal is open and logged in...
echo.
%PYCMD% "%SCRIPT_DIR%mt5_fetch_button.py"

echo.
echo Done. New files (if any) are already in bullion-book\data.
pause
