<#
.SYNOPSIS
    Builds packaged Windows sidecar runtimes (`core`, `chatterbox`, `qwen`) for VoxLab.
.DESCRIPTION
    Packages each installed Python virtual environment in `sidecar/` into a self-contained
    PyInstaller `--onedir` distribution under `<OutputDir>/voxlab-sidecar-<id>/voxlab-sidecar-<id>.exe`.
    Matches `resolve_packaged_runtime_from_dir` in `src-tauri/src/ai/sidecar.rs`.
#>
param(
    [string[]]$Runtimes = @("core", "chatterbox", "qwen"),
    [string]$OutputDir = "$PSScriptRoot\..\src-tauri\target\release\sidecar"
)

$ErrorActionPreference = "Stop"
$SidecarRoot = $PSScriptRoot
$ResolvedOutput = [System.IO.Path]::GetFullPath($OutputDir)

New-Item -ItemType Directory -Force -Path $ResolvedOutput | Out-Null

$RuntimeMap = @{
    "core"       = ".venv"
    "chatterbox" = ".venv-chatterbox"
    "qwen"       = ".venv-qwen"
}

$EntryScript = Join-Path $SidecarRoot "voxlab_sidecar\__main__.py"
if (-not (Test-Path $EntryScript)) {
    throw "Cannot find sidecar entry point at $EntryScript"
}

foreach ($rt in $Runtimes) {
    if (-not $RuntimeMap.ContainsKey($rt)) {
        throw "Unknown runtime '$rt'. Valid runtimes: core, chatterbox, qwen"
    }
    $venvName = $RuntimeMap[$rt]
    $pythonExe = Join-Path $SidecarRoot "$venvName\Scripts\python.exe"

    if (-not (Test-Path $pythonExe)) {
        Write-Warning "[SKIP] Runtime '$rt' venv not found at $pythonExe"
        continue
    }

    Write-Host "==> Checking PyInstaller in $venvName ($rt)..." -ForegroundColor Cyan
    & $pythonExe -c "import PyInstaller" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Installing PyInstaller into $venvName..." -ForegroundColor Yellow
        & $pythonExe -m pip install pyinstaller
    }

    $distName = "voxlab-sidecar-$rt"
    $workPath = Join-Path $SidecarRoot "build\pyinstaller-$rt"

    Write-Host "==> Building $distName (--onedir) into $ResolvedOutput..." -ForegroundColor Cyan
    & $pythonExe -m PyInstaller `
        --noconfirm `
        --clean `
        --onedir `
        --name $distName `
        --distpath $ResolvedOutput `
        --workpath $workPath `
        --specpath $workPath `
        --paths $SidecarRoot `
        $EntryScript

    $builtExe = Join-Path $ResolvedOutput "$distName\$distName.exe"
    if (-not (Test-Path $builtExe)) {
        throw "Failed to produce expected sidecar executable at $builtExe"
    }

    Write-Host "==> Verifying CLI help on $builtExe --runtime $rt --help" -ForegroundColor Green
    & $builtExe --runtime $rt --help | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Smoke check failed for $builtExe"
    }
    Write-Host "[OK] $builtExe ready." -ForegroundColor Green
}

Write-Host "`nAll available sidecar runtimes built in: $ResolvedOutput" -ForegroundColor Green
