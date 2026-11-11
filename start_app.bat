@echo off
setlocal EnableExtensions
chcp 65001 >nul

title VoxLab - Live Dev Mode (Hot Reload)
cd /d "%~dp0"

:: Ensure Rust (cargo) and Node.js are always in PATH when launched by double-click
if exist "%USERPROFILE%\.cargo\bin" set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
if exist "C:\Program Files\nodejs" set "PATH=C:\Program Files\nodejs;%PATH%"

:: Point dev sidecar directly to repo virtual environments (.venv, .venv-chatterbox, .venv-qwen)
set "VOXLAB_SIDECAR_ROOT=%~dp0sidecar"

echo ============================================================
echo   VOXLAB - CHE DO CHAY THU VA FIX LOI TRUC TIEP (DEV MODE)
echo ============================================================
echo   Thu muc ma nguon : %CD%
echo   Sidecar Python   : %VOXLAB_SIDECAR_ROOT%
echo ============================================================
echo.

:: Close any running VoxLab release/dev instance or orphaned sidecars to avoid file/VRAM locks
taskkill /F /IM voxlab.exe >nul 2>&1
taskkill /F /IM voxlab-sidecar-core.exe >nul 2>&1
taskkill /F /IM voxlab-sidecar-chatterbox.exe >nul 2>&1
taskkill /F /IM voxlab-sidecar-qwen.exe >nul 2>&1

:: Free Vite dev port 1420 if an old dev server is still holding it
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":1420 " ^| findstr "LISTENING"') do (
    if not "%%P"=="0" (
        echo [INFO] Dang giai phong cong 1420 ^(PID %%P^)...
        taskkill /F /PID %%P >nul 2>&1
    )
)

:: Ensure Tauri resource placeholder exists even after cargo clean
if not exist "src-tauri\target\release\sidecar" (
    mkdir "src-tauri\target\release\sidecar" >nul 2>&1
)

:: Sanity check required tools
where npm >nul 2>&1
if errorlevel 1 (
    echo [LOI] Khong tim thay Node.js / npm trong PATH.
    pause
    exit /b 1
)
where cargo >nul 2>&1
if errorlevel 1 (
    echo [LOI] Khong tim thay Rust / cargo trong PATH.
    pause
    exit /b 1
)

echo [OK] Dang khoi dong VoxLab Dev Mode...
echo      - Sua giao dien (src/)          : Tu dong cap nhat tuc thi (Hot Reload)
echo      - Sua Rust (src-tauri/src/)     : Tu dong bien dich va mo lai cua so
echo      - Sua Python (sidecar/)         : Co hieu luc ngay lan goi AI tiep theo
echo      - Tat ca 7 model + .venv        : Nhan dien san 100%% (Da cai dat)
echo.

call npm run tauri dev

if errorlevel 1 (
    echo.
    echo [CANH BAO] Tien trinh ket thuc voi ma loi %ERRORLEVEL%.
    pause
)
