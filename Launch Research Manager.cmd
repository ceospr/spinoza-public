@echo off
setlocal
set "researchScript=%~dp0tools\research-manager\manager.py"
set "atlasPython=%USERPROFILE%\OneDrive\Desktop\AtlasAI\apps\api\.venv\Scripts\python.exe"
if exist "%atlasPython%" (
  "%atlasPython%" -B "%researchScript%" %*
  goto finished
)
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -B "%researchScript%" %*
  goto finished
)
where python >nul 2>nul
if not errorlevel 1 (
  python -B "%researchScript%" %*
  goto finished
)
echo Python 3.10 or newer is required. The manager uses only Python's standard library.
echo Install Python from python.org or run this launcher on the computer with AtlasAI installed.
:finished
if errorlevel 1 pause
endlocal
