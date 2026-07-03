@echo off
setlocal enabledelayedexpansion

rem Drag-and-drop MT5 export converter.
rem Put this file AND a copy of convert_mt5_export.py in the same folder
rem (your "bat folder"), then drop raw MT5 CSV exports next to them and
rem double-click this file. Converted daily CSVs land in a "saved"
rem subfolder here - copy those into bullion-book\data yourself once
rem you've spot-checked them.

set "SCRIPT_DIR=%~dp0"
set "SAVED_DIR=%SCRIPT_DIR%saved"

if not exist "%SAVED_DIR%" mkdir "%SAVED_DIR%"

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

set FOUND=0
for %%F in ("%SCRIPT_DIR%*.csv") do (
    set FOUND=1
    echo Converting %%~nxF ...
    %PYCMD% "%SCRIPT_DIR%convert_mt5_export.py" "%%F" --out-dir "%SAVED_DIR%"
    if errorlevel 1 (
        echo   FAILED - see the error above.
    ) else (
        echo   Done.
    )
    echo.
)

if %FOUND%==0 (
    echo No CSV files found in %SCRIPT_DIR%
    echo Drop your MT5 export .csv files next to this convert.bat and run it again.
)

echo All finished. Converted files are in:
echo   %SAVED_DIR%
pause
