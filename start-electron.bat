@echo off
setlocal EnableExtensions
title CS2 Cam

set "ROOT=%~dp0"
cd /d "%ROOT%"
set "SERVER=%ROOT%server"
set "WEB=%ROOT%web"
set "ELECTRON=%ROOT%electron"

rem Load local configuration without committing the .env file.
if exist "%ROOT%.env" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%ROOT%.env") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

if not defined CS2_DATABASE set "CS2_DATABASE=%ROOT%data\csdemo.sqlite3"
if not defined BACKEND_PORT set "BACKEND_PORT=8091"

echo ========================================
echo        CS2 Cam - Electron
echo ========================================

if not exist "%ELECTRON%\package.json" goto :missing_project
if not exist "%SERVER%\pom.xml" goto :missing_project
if not exist "%WEB%\package.json" goto :missing_project

where java >nul 2>nul
if errorlevel 1 goto :missing_java
where mvn >nul 2>nul
if errorlevel 1 goto :missing_maven
where npm >nul 2>nul
if errorlevel 1 goto :missing_node
where py >nul 2>nul
if errorlevel 1 goto :missing_python

if not exist "%ROOT%.venv312\Scripts\python.exe" (
  echo [ERROR] .venv312 not found. Create it using the Python setup commands in README.md.
  goto :failed
)

echo [1/5] Initializing SQLite schema...
"%ROOT%.venv312\Scripts\python.exe" -c "from db_schema import bootstrap_database; bootstrap_database()"
if errorlevel 1 (
  echo [ERROR] SQLite initialization failed. Check the SQLite file path and directory write permissions.
  goto :failed
)

echo [2/5] Building Spring Boot backend...
rem Build into a unique directory: Windows locks the JAR used by a live backend.
node "%ELECTRON%\backend-build.cjs"
set "BUILD_CODE=%errorlevel%"
if not "%BUILD_CODE%"=="0" goto :backend_failed

echo [3/5] Building Vue frontend...
pushd "%WEB%"
if not exist "node_modules" call npm install --no-audit --no-fund
if errorlevel 1 (
  popd
  goto :frontend_failed
)
call npm run build
set "BUILD_CODE=%errorlevel%"
popd
if not "%BUILD_CODE%"=="0" goto :frontend_failed

echo [4/5] Checking Electron dependencies...
pushd "%ELECTRON%"
if not exist "node_modules\electron\dist\electron.exe" call npm install --force --include=optional --foreground-scripts --no-audit --no-fund
if errorlevel 1 (
  popd
  goto :electron_failed
)
rem Some npm mirrors leave the Electron package installed but do not extract
rem the platform binary. Reuse the downloaded cache archive when available.
if not exist "node_modules\electron\dist\electron.exe" (
  set "ELECTRON_ZIP="
  for /f "usebackq delims=" %%Z in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$z=Get-ChildItem -Path $env:LOCALAPPDATA\electron\Cache -Recurse -Filter 'electron-*-win32-x64.zip' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName; if($z){$z}"`) do set "ELECTRON_ZIP=%%Z"
  if defined ELECTRON_ZIP (
    echo [INFO] Repairing Electron binary from npm cache...
    tar -xf "%ELECTRON_ZIP%" -C "node_modules\electron\dist"
    >"node_modules\electron\path.txt" echo electron.exe
  )
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo [ERROR] Electron binary is missing. npm install did not download it.
  popd
  goto :electron_failed
)

echo [5/5] Starting desktop application...
call npm start
set "APP_CODE=%errorlevel%"
popd
echo Electron exited with code %APP_CODE%.
exit /b %APP_CODE%

:missing_project
echo [ERROR] CS2 Demo Show files are incomplete.
goto :failed
:missing_java
echo [ERROR] Java is not installed or not in PATH.
goto :failed
:missing_maven
echo [ERROR] Maven is not installed or not in PATH.
goto :failed
:missing_node
echo [ERROR] Node.js/npm is not installed or not in PATH.
goto :failed
:missing_python
echo [ERROR] Python launcher is not installed or not in PATH.
goto :failed
:backend_failed
echo [ERROR] Backend build failed.
goto :failed
:frontend_failed
echo [ERROR] Frontend build failed.
goto :failed
:electron_failed
echo [ERROR] Electron dependency installation failed.
goto :failed
:failed
pause
exit /b 1
