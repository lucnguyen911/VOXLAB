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
    "pronunciation.py",
    "number_normalizer.py",
    "subtitle_optimizer.py",
    "audio_quality.py",
    "tts\__init__.py",
    "tts\base.py",
    "tts\service.py",
    "tts\omnivoice_adapter.py",
    "tts\kokoro_adapter.py",
    "tts\chatterbox_adapter.py",
    "tts\qwen_adapter.py"
)

$VaultedLargeModules = @(
    "pronunciation.py",
    "number_normalizer.py",
    "subtitle_optimizer.py",
    "audio_quality.py"
)

function Invoke-StageVaultSeal([string]$PythonExe, [string]$SourcePkgDir, [string]$StageDir, [string]$VaultOutDir, [string[]]$RelFiles) {
    New-Item -ItemType Directory -Force -Path $VaultOutDir | Out-Null
    $sealScript = @'
import hashlib, hmac, marshal, os, sys, zlib

src_pkg = sys.argv[1]
stage_pkg = sys.argv[2]
vault_dir = sys.argv[3]
rel_files = sys.argv[4:]

os.makedirs(vault_dir, exist_ok=True)

for rel in rel_files:
    src_path = os.path.join(src_pkg, rel)
    dst_path = os.path.join(stage_pkg, rel)
    with open(src_path, "r", encoding="utf-8") as f:
        src_text = f.read()

    mod_tag = "<voxlab:" + rel.replace("\\", "/").removesuffix(".py") + ">"
    code_obj = compile(src_text, mod_tag, "exec", optimize=2)
    compressed = zlib.compress(marshal.dumps(code_obj), 9)

    key = os.urandom(32)
    mask_a = os.urandom(32)
    mask_b = bytes(k ^ a for k, a in zip(key, mask_a))
    nonce = os.urandom(16)
    vault_id = hashlib.sha256(os.urandom(16) + rel.encode("utf-8")).hexdigest()[:20]

    chunks = []
    for idx in range(0, len(compressed), 64):
        blk = compressed[idx:idx + 64]
        ks = hashlib.blake2b(
            nonce + (idx >> 6).to_bytes(8, "little"),
            key=key,
            digest_size=len(blk),
        ).digest()
        enc_blk = (
            int.from_bytes(blk, "little") ^ int.from_bytes(ks, "little")
        ).to_bytes(len(blk), "little")
        chunks.append(enc_blk)
    cipher = b"".join(chunks)
    tag = hmac.new(key, nonce + cipher, hashlib.sha256).digest()

    vault_file = os.path.join(vault_dir, vault_id + ".bin")
    with open(vault_file, "wb") as vf:
        vf.write(nonce + tag + cipher)

    stub = (
        "from __future__ import annotations\n"
        "import hashlib, hmac, marshal, os, sys, zlib\n"
        "def _vxl_boot() -> bytes:\n"
        f"    _a = bytes.fromhex('{mask_a.hex()}')\n"
        f"    _b = bytes.fromhex('{mask_b.hex()}')\n"
        "    _k = bytes(x ^ y for x, y in zip(_a, _b))\n"
        "    _base = getattr(sys, '_MEIPASS', '') or os.path.join(os.path.dirname(os.path.abspath(sys.executable)), '_internal')\n"
        f"    with open(os.path.join(_base, '_vxl_vault', '{vault_id}.bin'), 'rb') as _f:\n"
        "        _d = _f.read()\n"
        "    _n, _t, _c = _d[:16], _d[16:48], _d[48:]\n"
        "    if not hmac.compare_digest(hmac.new(_k, _n + _c, hashlib.sha256).digest(), _t):\n"
        "        raise RuntimeError('VXL_VAULT_TAMPERED')\n"
        "    _p = []\n"
        "    for _i in range(0, len(_c), 64):\n"
        "        _s = _c[_i:_i + 64]\n"
        "        _ks = hashlib.blake2b(_n + (_i >> 6).to_bytes(8, 'little'), key=_k, digest_size=len(_s)).digest()\n"
        "        _p.append((int.from_bytes(_s, 'little') ^ int.from_bytes(_ks, 'little')).to_bytes(len(_s), 'little'))\n"
        "    return zlib.decompress(b''.join(_p))\n"
        "exec(marshal.loads(_vxl_boot()), globals())\n"
        "del _vxl_boot\n"
    )
    with open(dst_path, "w", encoding="utf-8") as sf:
        sf.write(stub)
'@
    $sealPyPath = Join-Path $StageDir "_vxl_seal_tmp.py"
    $stagePkgDir = Join-Path $StageDir "voxlab_sidecar"
    try {
        Set-Content -Path $sealPyPath -Value $sealScript -Encoding UTF8
        & $PythonExe $sealPyPath $SourcePkgDir $stagePkgDir $VaultOutDir @RelFiles
        if ($LASTEXITCODE -ne 0) {
            throw "CRITICAL SECURITY ERROR: Vault encryption pre-stage failed!"
        }
    } finally {
        Remove-Item -Force $sealPyPath -ErrorAction SilentlyContinue
    }
}

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
        $srcFile = Join-Path (Join-Path $StageDir "voxlab_sidecar") $rel
        if (-not (Test-Path $srcFile)) {
            $srcFile = Join-Path $SourcePkgDir $rel
        }
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

    $stageVaultDir = Join-Path $stageDir "_vxl_vault"
    if ($SkipObfuscationForDev) {
        Write-Warning "[DEV ONLY] Skipping PyArmor obfuscation for '$rt' (-SkipObfuscationForDev)."
    } else {
        Write-Host "==> Sealing 4 large algorithm modules into 256-bit BLAKE2b+HMAC encrypted vault..." -ForegroundColor Cyan
        Invoke-StageVaultSeal -PythonExe $pythonExe -SourcePkgDir $PkgDir -StageDir $stageDir -VaultOutDir $stageVaultDir -RelFiles $VaultedLargeModules

        $pyarmorExe = Resolve-PyArmorCli -VenvScriptsDir $venvScripts -PythonExe $pythonExe
        Write-Host "==> Obfuscating ALL $($MandatoryProtectedModules.Count) voxlab_sidecar modules (100% Fail-Closed) with PyArmor ($pyarmorExe)..." -ForegroundColor Cyan
        Invoke-TargetedPyArmor -PyArmorExe $pyarmorExe -SourcePkgDir $PkgDir -StageDir $stageDir -RelFiles $MandatoryProtectedModules -FailClosed $true

        # Verify 100% of .py files in staged voxlab_sidecar carry __pyarmor__ signature
        $allStagedPy = Get-ChildItem -Path (Join-Path $stageDir "voxlab_sidecar") -Filter "*.py" -Recurse
        foreach ($stFile in $allStagedPy) {
            $rawContent = Get-Content -Path $stFile.FullName -Raw
            if ($rawContent -notmatch "__pyarmor__") {
                throw "CRITICAL SECURITY ERROR: Unarmored Python file detected in stage: $($stFile.FullName)"
            }
        }

        $runtimeDirs = Get-ChildItem -Path $stageDir -Directory -Filter "pyarmor_runtime*"
        if (-not $runtimeDirs -or $runtimeDirs.Count -eq 0) {
            throw "CRITICAL SECURITY ERROR: PyArmor did not emit pyarmor_runtime_* in $stageDir."
        }
        foreach ($rtDir in $runtimeDirs) {
            $extraPyInstallerArgs += @("--hidden-import", $rtDir.Name, "--collect-all", $rtDir.Name)
        }
        Write-Host "[SECURITY OK] 100% of all $($allStagedPy.Count) voxlab_sidecar modules verified with __pyarmor__ native armor." -ForegroundColor Green
    }

    # Minimal entry bootstrapper ensures stdlib modules required by PyArmor & encrypted vaults are bundled
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
        "import inspect, io, json, logging, marshal, math, msvcrt, os, pathlib, platform, re, shutil"
        "import ssl, stat, struct, subprocess, sys, tempfile, threading, time, typing"
        "import unicodedata, urllib.error, urllib.parse, urllib.request, uuid, wave, winreg, zlib"
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

    if (-not $SkipObfuscationForDev -and (Test-Path $stageVaultDir)) {
        $dstVaultDir = Join-Path $ResolvedOutput "$distName\_internal\_vxl_vault"
        if (Test-Path $dstVaultDir) {
            Remove-Item -Recurse -Force $dstVaultDir
        }
        Copy-Item -Recurse -Force $stageVaultDir $dstVaultDir
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
