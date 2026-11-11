<#
.SYNOPSIS
    Builds hardened commercial Windows sidecar runtimes (`core`, `chatterbox`, `qwen`) for VoxLab.
.DESCRIPTION
    1. Fail-closed PyArmor AST/bytecode obfuscation of all mandatory security, protocol, IPC, ASR,
       and TTS modules into `sidecar/build/stage-<rt>` (unless -SkipObfuscationForDev), plus
       opportunistic PyArmor obfuscation of >32KB helper modules when PyArmor Pro is licensed.
    2. Packages each installed Python virtual environment into a self-contained PyInstaller `--onedir`
       distribution under `<OutputDir>/voxlab-sidecar-<rt>/voxlab-sidecar-<rt>.exe` (`--noupx`).
    3. Audits `_internal` to ensure zero raw `voxlab_sidecar/*.py` source files leaked.
    4. Verifies standalone execution rejects unauthorized callers with `UNAUTHORIZED_HOST`.
    5. Optionally signs binaries with `signtool.exe` when `-SignCertSha1` or `$env:VOXLAB_SIGN_CERT_SHA1` is provided.
#>
param(
    [string[]]$Runtimes = @("core", "chatterbox", "qwen"),
    [string]$OutputDir = "$PSScriptRoot\..\src-tauri\target\release\sidecar",
    [switch]$SkipObfuscationForDev = $false,
    [string]$SignCertSha1 = $env:VOXLAB_SIGN_CERT_SHA1
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

$PkgDir = Join-Path $SidecarRoot "voxlab_sidecar"
if (-not (Test-Path (Join-Path $PkgDir "__main__.py"))) {
    throw "Cannot find voxlab_sidecar package at $PkgDir"
}

$MandatoryProtectedModules = @(
    "__init__.py",
    "__main__.py",
    "ipc_auth.py",
    "server.py",
    "protocol.py",
    "stdio.py",
    "asr_engine.py",
    "audio_ops.py",
    "edge_tts_engine.py",
    "tts\__init__.py",
    "tts\base.py",
    "tts\service.py",
    "tts\omnivoice_adapter.py",
    "tts\kokoro_adapter.py",
    "tts\chatterbox_adapter.py",
    "tts\qwen_adapter.py"
)

$LargeExtendedModules = @(
    "pronunciation.py",
    "number_normalizer.py",
    "subtitle_optimizer.py",
    "audio_quality.py"
)

function Resolve-PyArmorCli([string]$VenvScriptsDir, [string]$PythonExe) {
    if ($env:PYARMOR_CLI -and (Test-Path $env:PYARMOR_CLI)) {
        return $env:PYARMOR_CLI
    }
    $localPyArmor = Join-Path $VenvScriptsDir "pyarmor.exe"
    if (Test-Path $localPyArmor) {
        return $localPyArmor
    }
    $globalCmd = Get-Command pyarmor -ErrorAction SilentlyContinue
    if ($globalCmd -and $globalCmd.Source) {
        return $globalCmd.Source
    }
    Write-Host "Installing PyArmor (<10) into venv ($VenvScriptsDir)..." -ForegroundColor Yellow
    & $PythonExe -m pip install "pyarmor>=8,<10" | Out-Null
    if (Test-Path $localPyArmor) {
        return $localPyArmor
    }
    throw "CRITICAL SECURITY ERROR: PyArmor CLI could not be found or installed. Commercial builds are fail-closed."
}

function Invoke-TargetedPyArmor([string]$PyArmorExe, [string]$SourcePkgDir, [string]$StageDir, [string[]]$RelFiles, [bool]$FailClosed) {
    $tmpOut = Join-Path $StageDir "_pyarmor_tmp"
    foreach ($rel in $RelFiles) {
        $srcFile = Join-Path $SourcePkgDir $rel
        if (-not (Test-Path $srcFile)) {
            if ($FailClosed) {
                throw "CRITICAL SECURITY ERROR: Mandatory module missing at $srcFile"
            }
            continue
        }
        if (Test-Path $tmpOut) {
            Remove-Item -Recurse -Force $tmpOut
        }
        New-Item -ItemType Directory -Force -Path $tmpOut | Out-Null

        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        & $PyArmorExe gen -O $tmpOut $srcFile | Out-Null
        $pyArmorExit = $LASTEXITCODE
        $ErrorActionPreference = $prevEap
        if ($pyArmorExit -ne 0) {
            if ($FailClosed) {
                throw "CRITICAL SECURITY ERROR: PyArmor failed to obfuscate mandatory module '$rel'. Aborting fail-closed build."
            } else {
                Write-Host "[INFO] Extended >32KB module '$rel' skipped by PyArmor Trial license limit (frozen via PyInstaller PYZ)." -ForegroundColor DarkYellow
                continue
            }
        }

        # Copy pyarmor_runtime_* into root of $StageDir if not already copied
        $rtDirs = Get-ChildItem -Path $tmpOut -Directory -Filter "pyarmor_runtime*"
        foreach ($rtDir in $rtDirs) {
            $dstRt = Join-Path $StageDir $rtDir.Name
            if (-not (Test-Path $dstRt)) {
                Copy-Item -Recurse -Force $rtDir.FullName $dstRt
            }
        }

        $leafName = [System.IO.Path]::GetFileName($rel)
        $obfGenerated = Join-Path $tmpOut $leafName
        $dstTarget = Join-Path (Join-Path $StageDir "voxlab_sidecar") $rel
        if (-not (Test-Path $obfGenerated)) {
            if ($FailClosed) {
                throw "CRITICAL SECURITY ERROR: Expected obfuscated output missing for '$rel'"
            }
            continue
        }
        $content = Get-Content -Path $obfGenerated -Raw
        if ($content -notmatch "__pyarmor__") {
            if ($FailClosed) {
                throw "CRITICAL SECURITY ERROR: Output for '$rel' lacks __pyarmor__ armor signature!"
            }
            continue
        }
        Copy-Item -Force $obfGenerated $dstTarget
    }
    if (Test-Path $tmpOut) {
        Remove-Item -Recurse -Force $tmpOut
    }
}

function Find-SignTool {
    $cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) {
        return $cmd.Source
    }
    $kitsRoot = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
    if (Test-Path $kitsRoot) {
        $found = Get-ChildItem -Path $kitsRoot -Filter "signtool.exe" -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match "\\x64\\" } |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if ($found) {
            return $found.FullName
        }
    }
    return $null
}

function Ensure-BundledUv([string]$ToolsSrcDir, [string]$OutputRootDir, [string]$ScratchBuildDir) {
    New-Item -ItemType Directory -Force -Path $ToolsSrcDir | Out-Null
    $cachedUv = Join-Path $ToolsSrcDir "uv.exe"
    if (-not (Test-Path $cachedUv)) {
        Write-Host "==> Downloading standalone uv.exe (x86_64-pc-windows-msvc) for zero-Python client runtime installer..." -ForegroundColor Cyan
        New-Item -ItemType Directory -Force -Path $ScratchBuildDir | Out-Null
        $zipPath = Join-Path $ScratchBuildDir "uv-win-x64.zip"
        $extractDir = Join-Path $ScratchBuildDir "uv-extract"
        if (Test-Path $extractDir) {
            Remove-Item -Recurse -Force $extractDir
        }
        $uvUrl = "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip"
        Invoke-WebRequest -Uri $uvUrl -OutFile $zipPath -UseBasicParsing
        Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
        $foundUv = Get-ChildItem -Path $extractDir -Filter "uv.exe" -Recurse | Select-Object -First 1
        if (-not $foundUv) {
            throw "Failed to locate uv.exe inside downloaded archive from $uvUrl"
        }
        Copy-Item -Force $foundUv.FullName $cachedUv
        Remove-Item -Force $zipPath -ErrorAction SilentlyContinue
        Remove-Item -Recurse -Force $extractDir -ErrorAction SilentlyContinue
    }
    $outToolsDir = Join-Path $OutputRootDir "tools"
    New-Item -ItemType Directory -Force -Path $outToolsDir | Out-Null
    $dstUv = Join-Path $outToolsDir "uv.exe"
    Copy-Item -Force $cachedUv $dstUv
    & $dstUv --version | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Bundled uv.exe smoke check failed at $dstUv"
    }
    Write-Host "[OK] Bundled standalone uv.exe ready at $dstUv" -ForegroundColor Green
}

Ensure-BundledUv -ToolsSrcDir (Join-Path $SidecarRoot "tools") -OutputRootDir $ResolvedOutput -ScratchBuildDir (Join-Path $SidecarRoot "build")

foreach ($rt in $Runtimes) {
    if (-not $RuntimeMap.ContainsKey($rt)) {
        throw "Unknown runtime '$rt'. Valid runtimes: core, chatterbox, qwen"
    }
    $venvName = $RuntimeMap[$rt]
    $venvScripts = Join-Path $SidecarRoot "$venvName\Scripts"
    $pythonExe = Join-Path $venvScripts "python.exe"

    if (-not (Test-Path $pythonExe)) {
        Write-Warning "[SKIP] Runtime '$rt' venv not found at $pythonExe"
        continue
    }

    Write-Host "==> Checking PyInstaller in $venvName ($rt)..." -ForegroundColor Cyan
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & $pythonExe -c "import PyInstaller" >$null 2>$null
    $pyiCheckExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    if ($pyiCheckExit -ne 0) {
        Write-Host "Installing PyInstaller into $venvName..." -ForegroundColor Yellow
        & $pythonExe -m pip install pyinstaller
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to install PyInstaller into $venvName"
        }
    }

    $stageDir = Join-Path $SidecarRoot "build\stage-$rt"
    if (Test-Path $stageDir) {
        Remove-Item -Recurse -Force $stageDir
    }
    New-Item -ItemType Directory -Force -Path $stageDir | Out-Null
    Copy-Item -Recurse -Force $PkgDir (Join-Path $stageDir "voxlab_sidecar")

    $extraPyInstallerArgs = @()

    if ($SkipObfuscationForDev) {
        Write-Warning "[DEV ONLY] Skipping PyArmor obfuscation for '$rt' (-SkipObfuscationForDev)."
    } else {
        $pyarmorExe = Resolve-PyArmorCli -VenvScriptsDir $venvScripts -PythonExe $pythonExe
        Write-Host "==> Obfuscating 15 mandatory security/IPC/engine modules with PyArmor ($pyarmorExe)..." -ForegroundColor Cyan
        Invoke-TargetedPyArmor -PyArmorExe $pyarmorExe -SourcePkgDir $PkgDir -StageDir $stageDir -RelFiles $MandatoryProtectedModules -FailClosed $true
        Invoke-TargetedPyArmor -PyArmorExe $pyarmorExe -SourcePkgDir $PkgDir -StageDir $stageDir -RelFiles $LargeExtendedModules -FailClosed $false

        $runtimeDirs = Get-ChildItem -Path $stageDir -Directory -Filter "pyarmor_runtime*"
        if (-not $runtimeDirs -or $runtimeDirs.Count -eq 0) {
            throw "CRITICAL SECURITY ERROR: PyArmor did not emit pyarmor_runtime_* in $stageDir."
        }
        foreach ($rtDir in $runtimeDirs) {
            $extraPyInstallerArgs += @("--hidden-import", $rtDir.Name, "--collect-all", $rtDir.Name)
        }
        Write-Host "[SECURITY OK] All 15 mandatory security/engine modules verified with __pyarmor__ armor." -ForegroundColor Green
    }

    # Bootstrapper ensures package-qualified execution so relative imports, stdlib modules
    # required by PyArmor-obfuscated bytecode, and runtime site-packages load cleanly.
    $coreStaticImports = if ($rt -eq "core") {
        @(
            "    import numpy"
            "    import soundfile"
            "    import onnxruntime"
            "    import kokoro_onnx"
            "    import espeakng_loader"
            "    import phonemizer"
            "    import lameenc"
            "    import edge_tts"
            "    import certifi"
            "    import huggingface_hub"
            "    import tqdm"
        )
    } else {
        @()
    }
    $launcherPath = Join-Path $stageDir "run_voxlab_sidecar.py"
    Set-Content -Path $launcherPath -Encoding UTF8 -Value (@(
        "from __future__ import annotations"
        "import argparse, asyncio, ctypes, ctypes.wintypes, dataclasses, datetime, difflib"
        "import email.utils, faulthandler, functools, gc, hashlib, hmac, importlib, importlib.util"
        "import inspect, io, json, logging, math, msvcrt, os, pathlib, platform, re, shutil"
        "import ssl, stat, struct, subprocess, sys, tempfile, threading, time, typing"
        "import unicodedata, urllib.error, urllib.parse, urllib.request, uuid, wave, winreg"
        ""
        "if False:"
        "    import voxlab_sidecar"
        "    import voxlab_sidecar.__main__"
        "    import voxlab_sidecar.ipc_auth"
        "    import voxlab_sidecar.protocol"
        "    import voxlab_sidecar.server"
        "    import voxlab_sidecar.stdio"
        "    import voxlab_sidecar.asr_engine"
        "    import voxlab_sidecar.audio_ops"
        "    import voxlab_sidecar.edge_tts_engine"
        "    import voxlab_sidecar.pronunciation"
        "    import voxlab_sidecar.number_normalizer"
        "    import voxlab_sidecar.subtitle_optimizer"
        "    import voxlab_sidecar.audio_quality"
        "    import voxlab_sidecar.tts"
        "    import voxlab_sidecar.tts.base"
        "    import voxlab_sidecar.tts.service"
        "    import voxlab_sidecar.tts.omnivoice_adapter"
        "    import voxlab_sidecar.tts.kokoro_adapter"
        "    import voxlab_sidecar.tts.chatterbox_adapter"
        "    import voxlab_sidecar.tts.qwen_adapter"
    ) + $coreStaticImports + @(
        ""
        "def _register_sp_dlls(sp: str) -> None:"
        "    dll_rels = ("
        "        'torch\\lib', 'ctranslate2', '_soundfile_data',"
        "        'nvidia\\cublas\\bin', 'nvidia\\cudnn\\bin', 'nvidia\\cuda_runtime\\bin',"
        "        'nvidia\\cufft\\bin', 'nvidia\\curand\\bin', 'nvidia\\cusolver\\bin',"
        "        'nvidia\\cusparse\\bin', 'nvidia\\nvjitlink\\bin',"
        "    )"
        "    for dll_rel in dll_rels:"
        "        dll_dir = os.path.join(sp, dll_rel)"
        "        if os.path.isdir(dll_dir):"
        "            if hasattr(os, 'add_dll_directory'):"
        "                try:"
        "                    os.add_dll_directory(dll_dir)"
        "                except Exception:"
        "                    pass"
        "            cur_path = os.environ.get('PATH', '')"
        "            if dll_dir.lower() not in cur_path.lower():"
        "                os.environ['PATH'] = dll_dir + os.pathsep + cur_path"
        ""
        "def _attach_runtime_site_packages() -> None:"
        "    if os.environ.get('VOXLAB_ISOLATED_SMOKE_TEST') == '1':"
        "        return"
        "    appdata = os.environ.get('APPDATA', '')"
        "    user_rt_sp = os.path.join(appdata, 'com.voxlab.app', 'runtimes', '$rt', 'Lib', 'site-packages') if appdata else ''"
        "    if user_rt_sp and os.path.isdir(user_rt_sp):"
        "        if user_rt_sp not in sys.path:"
        "            sys.path.append(user_rt_sp)"
        "        _register_sp_dlls(user_rt_sp)"
        "        return"
        "    exe_dir = os.path.dirname(os.path.abspath(sys.executable))"
        "    candidates = ["
        "        os.path.join(exe_dir, 'site-packages'),"
        "        os.path.join(exe_dir, '_internal', 'site-packages'),"
        "        os.path.abspath(os.path.join(exe_dir, '..', '$venvName', 'Lib', 'site-packages')),"
        "    ]"
        "    for sp in candidates:"
        "        if sp and os.path.isdir(sp) and sp not in sys.path:"
        "            sys.path.append(sp)"
        "            _register_sp_dlls(sp)"
        ""
        "_attach_runtime_site_packages()"
        "from voxlab_sidecar.__main__ import main"
        "if __name__ == '__main__':"
        "    raise SystemExit(main())"
    ))

    $distName = "voxlab-sidecar-$rt"
    Get-Process -Name $distName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    $workPath = Join-Path $SidecarRoot "build\pyinstaller-$rt"
    if (Test-Path $workPath) {
        Remove-Item -Recurse -Force $workPath
    }

    # Sanitized PATH during packaging to avoid Conda/global DLL pollution
    $savedPath = $env:PATH
    try {
        $sysRoot = $env:SystemRoot
        $env:PATH = "$venvScripts;$sysRoot\System32;$sysRoot;$sysRoot\System32\Wbem;$sysRoot\System32\WindowsPowerShell\v1.0"

        Write-Host "==> Building $distName (--onedir, UPX disabled) into $ResolvedOutput..." -ForegroundColor Cyan
        $runtimeSpecificArgs = if ($rt -eq "core") {
            @(
                "--collect-all", "soundfile",
                "--collect-all", "kokoro_onnx",
                "--collect-all", "espeakng_loader",
                "--collect-all", "phonemizer",
                "--collect-all", "certifi",
                "--hidden-import", "lameenc",
                "--hidden-import", "edge_tts",
                "--hidden-import", "huggingface_hub",
                "--hidden-import", "tqdm"
            )
        } else {
            @(
                "--exclude-module", "numpy",
                "--exclude-module", "soundfile",
                "--exclude-module", "onnxruntime",
                "--exclude-module", "kokoro_onnx",
                "--exclude-module", "espeakng_loader",
                "--exclude-module", "phonemizer",
                "--exclude-module", "lameenc",
                "--exclude-module", "edge_tts",
                "--exclude-module", "huggingface_hub"
            )
        }
        $pyiArgs = @(
            "-m", "PyInstaller",
            "--noconfirm",
            "--clean",
            "--onedir",
            "--noupx",
            "--name", $distName,
            "--distpath", $ResolvedOutput,
            "--workpath", $workPath,
            "--specpath", $workPath,
            "--paths", $stageDir,
            "--collect-submodules", "voxlab_sidecar",
            "--exclude-module", "torch",
            "--exclude-module", "torchaudio",
            "--exclude-module", "torchvision",
            "--exclude-module", "scipy",
            "--exclude-module", "sklearn",
            "--exclude-module", "librosa",
            "--exclude-module", "numba",
            "--exclude-module", "llvmlite",
            "--exclude-module", "pandas",
            "--exclude-module", "gradio",
            "--exclude-module", "fastapi",
            "--exclude-module", "uvicorn",
            "--exclude-module", "av",
            "--exclude-module", "ctranslate2",
            "--exclude-module", "faster_whisper",
            "--exclude-module", "transformers",
            "--exclude-module", "diffusers",
            "--exclude-module", "accelerate",
            "--exclude-module", "omnivoice",
            "--exclude-module", "chatterbox",
            "--exclude-module", "qwen_tts",
            "--exclude-module", "matplotlib",
            "--exclude-module", "IPython",
            "--exclude-module", "pytest"
        ) + $runtimeSpecificArgs + $extraPyInstallerArgs + @($launcherPath)

        & $pythonExe @pyiArgs
        if ($LASTEXITCODE -ne 0) {
            throw "PyInstaller failed for runtime '$rt'"
        }
    } finally {
        $env:PATH = $savedPath
    }

    $builtExe = Join-Path $ResolvedOutput "$distName\$distName.exe"
    if (-not (Test-Path $builtExe)) {
        throw "Failed to produce expected sidecar executable at $builtExe"
    }

    if ($rt -eq "core") {
        $kokoroSrcDir = Join-Path $SidecarRoot "models\kokoro-82m"
        $kokoroModelFile = Join-Path $kokoroSrcDir "kokoro-v1.0.int8.onnx"
        $kokoroVoicesFile = Join-Path $kokoroSrcDir "voices-v1.0.bin"
        if (-not ((Test-Path $kokoroModelFile) -and (Test-Path $kokoroVoicesFile))) {
            Write-Host "==> Downloading pre-bundled Apache-2.0 Kokoro-82M model files into $kokoroSrcDir..." -ForegroundColor Cyan
            New-Item -ItemType Directory -Force -Path $kokoroSrcDir | Out-Null
            if (-not (Test-Path $kokoroModelFile)) {
                Invoke-WebRequest -Uri "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx" -OutFile $kokoroModelFile -UseBasicParsing
            }
            if (-not (Test-Path $kokoroVoicesFile)) {
                Invoke-WebRequest -Uri "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin" -OutFile $kokoroVoicesFile -UseBasicParsing
            }
        }
        $kokoroDstDir = Join-Path $ResolvedOutput "$distName\models\kokoro-82m"
        Write-Host "==> Bundling pre-installed Kokoro-82M model into $kokoroDstDir..." -ForegroundColor Cyan
        New-Item -ItemType Directory -Force -Path $kokoroDstDir | Out-Null
        Copy-Item -Force $kokoroModelFile (Join-Path $kokoroDstDir "kokoro-v1.0.int8.onnx")
        Copy-Item -Force $kokoroVoicesFile (Join-Path $kokoroDstDir "voices-v1.0.bin")
        $defaultSampleSrc = Join-Path $SidecarRoot "..\public\audio\samples\default_local.mp3"
        if (Test-Path $defaultSampleSrc) {
            Copy-Item -Force $defaultSampleSrc (Join-Path $ResolvedOutput "$distName\models\default_local.mp3")
        }
    }

    # Audit `_internal` for leaked raw `.py` files under voxlab_sidecar
    $internalPkg = Join-Path $ResolvedOutput "$distName\_internal\voxlab_sidecar"
    if (Test-Path $internalPkg) {
        $leakedPy = Get-ChildItem -Path $internalPkg -Filter "*.py" -Recurse -ErrorAction SilentlyContinue
        if ($leakedPy -and $leakedPy.Count -gt 0) {
            throw "CRITICAL SECURITY ERROR: Raw .py source files leaked into $internalPkg ($($leakedPy[0].FullName))"
        }
    }

    Write-Host "==> Verifying CLI help on $builtExe --runtime $rt --help" -ForegroundColor Green
    & $builtExe --runtime $rt --help | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "CLI help smoke check failed for $builtExe"
    }

    Write-Host "==> Verifying standalone UNAUTHORIZED_HOST lockout on $builtExe..." -ForegroundColor Cyan
    $probePayload = "{`"id`":`"audit-1`",`"method`":`"system.ping`",`"params`":{}}`n{`"id`":`"audit-sd`",`"method`":`"system.shutdown`",`"params`":{}}`n"
    $probeOut = $probePayload | & $builtExe --runtime $rt
    $joinedOut = ($probeOut -join "`n")
    if ($joinedOut -notmatch "UNAUTHORIZED_HOST") {
        throw "CRITICAL SECURITY ERROR: Frozen sidecar did not reject standalone unauthenticated caller! Output: $joinedOut"
    }
    Write-Host "[SECURITY OK] Standalone execution blocked with UNAUTHORIZED_HOST." -ForegroundColor Green

    if ($SignCertSha1 -and $SignCertSha1.Trim().Length -gt 0) {
        $signTool = Find-SignTool
        if (-not $signTool) {
            throw "SignCertSha1 was specified, but signtool.exe was not found in PATH or Windows Kits."
        }
        Write-Host "==> Signing $builtExe with Authenticode SHA-256..." -ForegroundColor Cyan
        & $signTool sign /fd SHA256 /tr "http://timestamp.digicert.com" /td SHA256 /sha1 $SignCertSha1.Trim() $builtExe
        if ($LASTEXITCODE -ne 0) {
            throw "Authenticode signing failed for $builtExe"
        }
    }

    Write-Host "[OK] $builtExe hardened and ready." -ForegroundColor Green
}

Remove-Item -Force (Join-Path $SidecarRoot "pyarmor.bug.log"), "pyarmor.bug.log" -ErrorAction SilentlyContinue
Write-Host "`nAll available sidecar runtimes built in: $ResolvedOutput" -ForegroundColor Green
