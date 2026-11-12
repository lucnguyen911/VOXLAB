"""Entry point: `python -m voxlab_sidecar --runtime <core|chatterbox|qwen>` (dev) or the
PyInstaller-built `voxlab-sidecar-<runtime>` binary (prod)."""
from __future__ import annotations

import argparse
import importlib.abc
import importlib.machinery
import importlib.util
import os
import platform
import sys
import time
import types
from typing import Any

# Hard guarantee: the sidecar never downloads anything implicitly (Gate E §3).
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

from .protocol import Writer  # noqa: E402
from .server import RequestContext, Server  # noqa: E402
from .stdio import isolate_protocol_streams  # noqa: E402
from .tts import adapters_for_runtime  # noqa: E402
from .tts.service import TtsService  # noqa: E402


def system_info(runtime: str, asr, tts: TtsService) -> dict:
    info: dict = {
        "runtime": runtime,
        "python": platform.python_version(),
        "platform": platform.platform(),
        "cpuCores": os.cpu_count() or 1,
    }
    # Detect CPU name
    try:
        if os.name == "nt":
            import winreg

            key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
            cpu_name, _ = winreg.QueryValueEx(key, "ProcessorNameString")
            info["cpu"] = str(cpu_name).strip()
        else:
            info["cpu"] = platform.processor() or "CPU"
    except Exception:
        info["cpu"] = platform.processor() or "CPU"

    # Detect RAM (Total & Free)
    try:
        if os.name == "nt":
            import ctypes
            from ctypes import wintypes

            class _MEM(ctypes.Structure):
                _fields_ = [
                    ("dwLength", wintypes.DWORD),
                    ("dwMemoryLoad", wintypes.DWORD),
                    ("ullTotalPhys", ctypes.c_uint64),
                    ("ullAvailPhys", ctypes.c_uint64),
                    ("ullTotalPageFile", ctypes.c_uint64),
                    ("ullAvailPageFile", ctypes.c_uint64),
                    ("ullTotalVirtual", ctypes.c_uint64),
                    ("ullAvailVirtual", ctypes.c_uint64),
                    ("sullAvailExtendedVirtual", ctypes.c_uint64),
                ]

            m = _MEM()
            m.dwLength = ctypes.sizeof(_MEM)
            usable_mb = 0
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m)):
                usable_mb = int(m.ullTotalPhys // (1024 * 1024))
                info["ramUsableMb"] = usable_mb
                info["ramTotalMb"] = usable_mb
                info["ramFreeMb"] = int(m.ullAvailPhys // (1024 * 1024))

            installed_kb = ctypes.c_ulonglong(0)
            if ctypes.windll.kernel32.GetPhysicallyInstalledSystemMemory(
                ctypes.byref(installed_kb)
            ):
                installed_mb = int(installed_kb.value // 1024)
                if installed_mb >= usable_mb and installed_mb > 0:
                    info["ramInstalledMb"] = installed_mb
                    info["ramTotalMb"] = installed_mb
    except Exception:
        pass

    try:
        import torch

        info["torch"] = torch.__version__
        info["torchCuda"] = torch.version.cuda
        info["cudaAvailable"] = bool(torch.cuda.is_available())
        if torch.cuda.is_available():
            props = torch.cuda.get_device_properties(0)
            info["gpu"] = props.name
            info["computeCapability"] = f"{props.major}.{props.minor}"
            info["vramTotalMb"] = props.total_memory // (1024 * 1024)
            free, _total = torch.cuda.mem_get_info()
            info["vramFreeMb"] = free // (1024 * 1024)
    except ImportError:
        info["torch"] = None
        info["cudaAvailable"] = False

    if not info.get("cudaAvailable"):
        # Lean first-launch bootstrap installs CTranslate2 + CUDA libs before heavy PyTorch engines;
        # query nvidia-smi / CTranslate2 so GPU name, VRAM, and CUDA readiness report accurately.
        try:
            import subprocess

            creationflags = 0x08000000 if os.name == "nt" else 0
            proc = subprocess.run(
                [
                    "nvidia-smi",
                    "--query-gpu=name,memory.total,memory.free",
                    "--format=csv,noheader,nounits",
                ],
                capture_output=True,
                text=True,
                timeout=3.0,
                creationflags=creationflags,
            )
            if proc.returncode == 0 and proc.stdout:
                first_line = next(
                    (ln.strip() for ln in proc.stdout.splitlines() if ln.strip()), ""
                )
                parts = [p.strip() for p in first_line.split(",")]
                if parts and parts[0]:
                    info["gpu"] = parts[0]
                    info["cudaAvailable"] = True
                    if len(parts) >= 2 and parts[1].isdigit():
                        info["vramTotalMb"] = int(parts[1])
                    if len(parts) >= 3 and parts[2].isdigit():
                        info["vramFreeMb"] = int(parts[2])
        except Exception:
            pass
        if not info.get("cudaAvailable"):
            try:
                from .asr_engine import _cuda_device_count

                if _cuda_device_count() > 0:
                    info["cudaAvailable"] = True
            except Exception:
                pass
    info["asr"] = asr.status() if asr else None
    info["tts"] = tts.status()
    return info


def debug_sleep(_m: str, params: dict, ctx: RequestContext) -> dict:
    """Diagnostic used by host tests to exercise progress, soft/hard cancel and crash handling."""
    result: dict = {}
    if params.get("probeStdHandles"):
        # Regression probe: querying the process std handles from the worker thread while the main
        # thread is blocked reading requests used to deadlock on Windows (see stdio.py).
        result["stdHandles"] = _probe_std_handles()
    seconds = float(params.get("seconds", 1.0))
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        ctx.check_cancelled()
        ctx.progress(100.0 * (1 - (end - time.monotonic()) / seconds), "sleeping")
        time.sleep(0.1)
    result["slept"] = seconds
    return result


def _probe_std_handles() -> dict:
    if os.name != "nt":
        import stat

        return {"stdinIsPipe": stat.S_ISFIFO(os.fstat(0).st_mode)}
    import ctypes

    k32 = ctypes.windll.kernel32
    k32.GetStdHandle.restype = ctypes.c_void_p
    k32.GetFileType.argtypes = [ctypes.c_void_p]
    names = {0: "unknown", 1: "disk", 2: "char", 3: "pipe"}
    return {"stdin": names.get(k32.GetFileType(k32.GetStdHandle(-10)), "?"),
            "stdout": names.get(k32.GetFileType(k32.GetStdHandle(-11)), "?")}


_DLL_HANDLES: list[object] = []


class _RuntimeSitePackagesFinder(importlib.abc.MetaPathFinder):
    """Prioritizes external runtime `site-packages` over PyInstaller's frozen PYZ archive
    for third-party libraries so partially bundled packages (e.g. `jinja2`, `huggingface_hub`,
    `safetensors`, `pydantic`) never shadow or version-mix with the installed AI runtime.
    Never intercepts `voxlab_sidecar`, `pyarmor_runtime*`, `_vxl_vault`, or Python stdlib modules.
    """

    _STDLIB_NAMES: frozenset[str] = frozenset(getattr(sys, "stdlib_module_names", ()))

    def __init__(self, sp_dirs: list[str]) -> None:
        self.sp_dirs = [os.path.abspath(d) for d in sp_dirs if d and os.path.isdir(d)]
        self._norm_exact = frozenset(os.path.normcase(d).rstrip("\\/") for d in self.sp_dirs)
        self._norm_prefixes = tuple(
            os.path.normcase(d).rstrip("\\/") + os.sep for d in self.sp_dirs
        )

    def _is_protected(self, fullname: str) -> bool:
        top = fullname.partition(".")[0]
        return (
            top == "voxlab_sidecar"
            or top == "_vxl_vault"
            or top.startswith("pyarmor_runtime")
            or top in self._STDLIB_NAMES
        )

    def find_spec(self, fullname: str, path: Any = None, target: Any = None) -> Any:
        if not self.sp_dirs or self._is_protected(fullname):
            return None
        if path is None:
            return importlib.machinery.PathFinder.find_spec(fullname, self.sp_dirs, target)
        sp_subpaths = [
            p
            for p in path
            if isinstance(p, str)
            and (
                os.path.normcase(os.path.abspath(p)).rstrip("\\/") in self._norm_exact
                or os.path.normcase(os.path.abspath(p)).startswith(self._norm_prefixes)
            )
        ]
        if not sp_subpaths:
            return None
        return importlib.machinery.PathFinder.find_spec(fullname, sp_subpaths, target)


def _install_runtime_sp_finder(sp: str) -> None:
    abs_sp = os.path.abspath(sp)
    for existing in sys.meta_path:
        if isinstance(existing, _RuntimeSitePackagesFinder):
            if abs_sp not in existing.sp_dirs:
                existing.__init__(existing.sp_dirs + [abs_sp])
            return
    finder = _RuntimeSitePackagesFinder([abs_sp])
    insert_idx = len(sys.meta_path)
    for idx, meta in enumerate(sys.meta_path):
        cls_name = type(meta).__name__
        if "PyiFrozen" in cls_name or meta is importlib.machinery.PathFinder:
            insert_idx = idx
            break
    sys.meta_path.insert(insert_idx, finder)


def _register_sp_dlls(sp: str) -> None:
    dll_rels: list[str] = [
        "torch\\lib",
        "ctranslate2",
        "_soundfile_data",
        "onnxruntime\\capi",
        "nvidia\\cublas\\bin",
        "nvidia\\cudnn\\bin",
        "nvidia\\cuda_runtime\\bin",
        "nvidia\\cufft\\bin",
        "nvidia\\curand\\bin",
        "nvidia\\cusolver\\bin",
        "nvidia\\cusparse\\bin",
        "nvidia\\nvjitlink\\bin",
    ]
    try:
        for entry in os.listdir(sp):
            if entry.lower().endswith(".libs"):
                dll_rels.append(entry)
    except OSError:
        pass
    for dll_rel in dll_rels:
        dll_dir = os.path.join(sp, dll_rel)
        if os.path.isdir(dll_dir):
            if hasattr(os, "add_dll_directory"):
                try:
                    _DLL_HANDLES.append(os.add_dll_directory(dll_dir))
                except Exception:
                    pass
            cur_path = os.environ.get("PATH", "")
            if dll_dir.lower() not in cur_path.lower():
                os.environ["PATH"] = dll_dir + os.pathsep + cur_path


def _resolve_python_stdlib_dirs(site_packages_dir: str) -> list[str]:
    """Locate portable CPython stdlib (`Lib` and `DLLs`) adjacent to a runtime venv.

    Reads `<runtime_dir>/pyvenv.cfg` (`home = ...`) and probes `<runtimes_root>/_python/*`
    so external packages (`torch`, `transformers`, `librosa`, `omnivoice`, `chatterbox`, `qwen_tts`)
    never fail when importing stdlib modules or `.pyd` extensions excluded during PyInstaller analysis.
    """
    lib_dir = os.path.dirname(os.path.abspath(site_packages_dir))  # .../Lib
    runtime_dir = os.path.dirname(lib_dir)  # .../<runtime>
    runtimes_root = os.path.dirname(runtime_dir)  # .../runtimes

    python_roots: list[str] = []
    pyvenv_cfg = os.path.join(runtime_dir, "pyvenv.cfg")
    if os.path.isfile(pyvenv_cfg):
        try:
            with open(pyvenv_cfg, "r", encoding="utf-8", errors="ignore") as f:
                for raw_line in f:
                    if "=" not in raw_line:
                        continue
                    k, v = raw_line.split("=", 1)
                    if k.strip().lower() == "home":
                        home_dir = v.strip()
                        if home_dir:
                            python_roots.append(home_dir)
                            python_roots.append(os.path.dirname(home_dir))
                        break
        except OSError:
            pass

    portable_py_root = os.path.join(runtimes_root, "_python")
    if os.path.isdir(portable_py_root):
        try:
            for entry in sorted(os.listdir(portable_py_root)):
                cand = os.path.join(portable_py_root, entry)
                if os.path.isdir(cand):
                    python_roots.append(cand)
        except OSError:
            pass

    resolved: list[str] = []
    seen: set[str] = set()
    for root in python_roots:
        for sub in ("Lib", "DLLs"):
            target = os.path.abspath(os.path.join(root, sub))
            norm = os.path.normcase(target)
            if norm not in seen and os.path.isdir(target):
                # Never append a venv's own minimal `Lib` folder; require real stdlib markers
                if sub == "Lib" and not os.path.isfile(os.path.join(target, "pickletools.py")):
                    continue
                seen.add(norm)
                resolved.append(target)
    return resolved


def _attach_stdlib_dirs(stdlib_dirs: list[str]) -> None:
    for d in stdlib_dirs:
        if d not in sys.path:
            sys.path.append(d)
        if os.path.basename(d).lower() == "dlls":
            dll_targets = [d]
            py_home = os.path.dirname(d)
            if os.path.isfile(os.path.join(py_home, "python3.dll")):
                dll_targets.append(py_home)
            for dt in dll_targets:
                if hasattr(os, "add_dll_directory"):
                    try:
                        _DLL_HANDLES.append(os.add_dll_directory(dt))
                    except OSError:
                        pass
                cur_path = os.environ.get("PATH", "")
                if dt.lower() not in cur_path.lower():
                    os.environ["PATH"] = dt + os.pathsep + cur_path
        elif os.path.basename(d).lower() == "lib":
            # Extend __path__ of any stdlib package already imported from frozen PYZ (e.g. unittest -> unittest.mock)
            for pkg_name in (
                "unittest",
                "xml",
                "xml.etree",
                "xml.dom",
                "xml.sax",
                "email",
                "http",
                "urllib",
                "html",
                "collections",
                "importlib",
                "logging",
                "multiprocessing",
                "concurrent",
            ):
                mod = sys.modules.get(pkg_name)
                pkg_path = getattr(mod, "__path__", None) if mod is not None else None
                if pkg_path is not None:
                    disk_sub = os.path.join(d, *pkg_name.split("."))
                    if os.path.isdir(disk_sub) and disk_sub not in pkg_path:
                        try:
                            pkg_path.append(disk_sub)
                        except Exception:
                            pass


def _ensure_pkg_resources_shim() -> None:
    """Provide a lightweight `pkg_resources` shim when running inside `uv` venvs that omit
    `setuptools` (required by upstream packages such as `resemble-perth`)."""
    if "pkg_resources" in sys.modules:
        return
    try:
        if importlib.util.find_spec("pkg_resources") is not None:
            return
    except Exception:
        pass

    mod = types.ModuleType("pkg_resources")

    class DistributionNotFound(Exception):
        pass

    def _resolve_resource_path(pkg_or_req: Any, resource_name: str) -> str:
        name = (
            pkg_or_req
            if isinstance(pkg_or_req, str)
            else getattr(pkg_or_req, "__name__", str(pkg_or_req))
        )
        spec = importlib.util.find_spec(name)
        if spec and spec.submodule_search_locations:
            base = list(spec.submodule_search_locations)[0]
        elif spec and spec.origin:
            base = os.path.dirname(spec.origin)
        else:
            raise ModuleNotFoundError(name)
        parts = [p for p in resource_name.replace("\\", "/").split("/") if p]
        return os.path.join(base, *parts)

    def resource_filename(pkg_or_req: Any, resource_name: str) -> str:
        return _resolve_resource_path(pkg_or_req, resource_name)

    def resource_exists(pkg_or_req: Any, resource_name: str) -> bool:
        try:
            return os.path.exists(_resolve_resource_path(pkg_or_req, resource_name))
        except Exception:
            return False

    def resource_stream(pkg_or_req: Any, resource_name: str) -> Any:
        return open(_resolve_resource_path(pkg_or_req, resource_name), "rb")

    def resource_string(pkg_or_req: Any, resource_name: str) -> bytes:
        with open(_resolve_resource_path(pkg_or_req, resource_name), "rb") as f:
            return f.read()

    mod.DistributionNotFound = DistributionNotFound  # type: ignore[attr-defined]
    mod.resource_filename = resource_filename  # type: ignore[attr-defined]
    mod.resource_exists = resource_exists  # type: ignore[attr-defined]
    mod.resource_stream = resource_stream  # type: ignore[attr-defined]
    mod.resource_string = resource_string  # type: ignore[attr-defined]
    sys.modules["pkg_resources"] = mod


def _attach_runtime_site_packages(runtime: str) -> None:
    if not getattr(sys, "frozen", False):
        _ensure_pkg_resources_shim()
        return
    if os.environ.get("VOXLAB_ISOLATED_SMOKE_TEST") == "1":
        return
    venv_map = {
        "core": ".venv",
        "chatterbox": ".venv-chatterbox",
        "qwen": ".venv-qwen",
    }
    venv_name = venv_map.get(runtime, ".venv")
    exe_dir = os.path.dirname(os.path.abspath(sys.executable))

    rt_candidates: list[str] = []
    data_dir = os.environ.get("VOXLAB_DATA_DIR", "").strip()
    if data_dir:
        rt_candidates.append(os.path.join(data_dir, "runtimes", runtime, "Lib", "site-packages"))
    rt_candidates.append(
        os.path.abspath(os.path.join(exe_dir, "..", "..", "data", "runtimes", runtime, "Lib", "site-packages"))
    )
    appdata = os.environ.get("APPDATA", "")
    if appdata:
        rt_candidates.append(os.path.join(appdata, "com.voxlab.app", "runtimes", runtime, "Lib", "site-packages"))

    for user_rt_sp in rt_candidates:
        if user_rt_sp and os.path.isdir(user_rt_sp):
            if user_rt_sp not in sys.path:
                sys.path.insert(0, user_rt_sp)
            _install_runtime_sp_finder(user_rt_sp)
            _register_sp_dlls(user_rt_sp)
            _attach_stdlib_dirs(_resolve_python_stdlib_dirs(user_rt_sp))
            _ensure_pkg_resources_shim()
            return

    candidates = [
        os.path.join(exe_dir, "site-packages"),
        os.path.join(exe_dir, "_internal", "site-packages"),
        os.path.abspath(os.path.join(exe_dir, "..", venv_name, "Lib", "site-packages")),
    ]
    for sp in candidates:
        if sp and os.path.isdir(sp) and sp not in sys.path:
            sys.path.insert(0, sp)
            _install_runtime_sp_finder(sp)
            _register_sp_dlls(sp)
            _attach_stdlib_dirs(_resolve_python_stdlib_dirs(sp))
    _ensure_pkg_resources_shim()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="voxlab_sidecar")
    parser.add_argument("--runtime", default="core", choices=["core", "chatterbox", "qwen"])
    args = parser.parse_args(argv)
    _attach_runtime_site_packages(args.runtime)

    sys.stderr.reconfigure(encoding="utf-8")
    # Protocol pipes are private; process stdin → NUL, stdout → stderr (see stdio.py).
    protocol_in, protocol_out = isolate_protocol_streams()

    trace_after = os.environ.get("VOXLAB_SIDECAR_TRACE_AFTER_SEC")
    if trace_after:
        import faulthandler

        faulthandler.dump_traceback_later(float(trace_after), repeat=True, file=sys.stderr)

    server = Server(Writer(protocol_out), runtime=args.runtime)
    tts = TtsService(adapters_for_runtime(args.runtime))
    asr = None
    if args.runtime == "core":
        from .asr_engine import AsrEngine

        asr = AsrEngine()
        server.register_heavy("asr.load", asr.load)
        server.register_heavy("asr.transcribe", asr.transcribe)
        server.register_heavy("asr.unload", asr.unload)
        import importlib
        from . import audio_ops
        from . import number_normalizer
        from . import pronunciation
        from . import audio_quality
        from . import subtitle_optimizer

        _mod_mtimes: dict[str, float] = {}
        for _m_obj in (audio_ops, number_normalizer, pronunciation, audio_quality, subtitle_optimizer):
            _f = getattr(_m_obj, "__file__", None)
            if _f and os.path.exists(_f):
                _mod_mtimes[_m_obj.__name__] = os.path.getmtime(_f)

        def _ensure_fresh_qc_modules() -> None:
            if getattr(sys, "frozen", False):
                return
            for _m_obj in (audio_ops, number_normalizer, pronunciation, audio_quality, subtitle_optimizer):
                _f = getattr(_m_obj, "__file__", None)
                if _f and os.path.exists(_f):
                    _cur_mtime = os.path.getmtime(_f)
                    if _cur_mtime > _mod_mtimes.get(_m_obj.__name__, 0.0):
                        try:
                            importlib.reload(_m_obj)
                            _mod_mtimes[_m_obj.__name__] = _cur_mtime
                        except Exception:
                            pass

        def validate_quality_handler(_m: str, params: dict, ctx: RequestContext) -> dict:
            _ensure_fresh_qc_modules()
            ctx.progress(10.0, "validating_audio")
            audio_path = params.get("audioPath") or ""
            text = params.get("text") or ""
            language = params.get("language")
            models_dir = params.get("modelsDir")
            model_id = params.get("modelId") or params.get("asrModelId")
            speed = float(params.get("speed") or 1.0)
            pron_rules = params.get("pronunciationRules") if isinstance(params.get("pronunciationRules"), list) else None
            pron_mapping = params.get("pronunciationMapping") if isinstance(params.get("pronunciationMapping"), list) else None
            res = audio_quality.validate_audio_quality(
                audio_path=audio_path,
                text=text,
                language=language,
                models_dir=models_dir,
                model_id=model_id,
                speed=speed,
                pronunciation_mapping=pron_mapping,
                pronunciation_rules=pron_rules,
            )
            ctx.progress(100.0, "validated")
            return res

        def probe_handler(params: dict) -> dict:
            _ensure_fresh_qc_modules()
            return audio_ops.probe(params)

        server.register_heavy("audio.assemble", audio_ops.assemble)
        server.register_light("audio.probe", probe_handler)
        server.register_heavy("audio.validate_quality", validate_quality_handler)

        def generate_srt_handler(_m: str, params: dict, ctx: RequestContext) -> dict:
            _ensure_fresh_qc_modules()
            ctx.progress(5.0, "preparing_master_subtitle")
            return subtitle_optimizer.generate_srt_from_master_audio(
                audio_path=str(params.get("audioPath") or ""),
                script_text=params.get("scriptText"),
                language=str(params.get("language") or "auto"),
                aspect_ratio=str(params.get("aspectRatio") or "16:9"),
                max_lines=int(params.get("maxLines") or 2),
                models_dir=params.get("modelsDir"),
                model_id=params.get("modelId") or params.get("asrModelId"),
                chunk_count=int(params.get("chunkCount") or 0),
                speech_speed=float(params.get("speechSpeed") or 1.0),
                ctx=ctx,
            )

        def optimize_subtitle_handler(params: dict) -> dict:
            _ensure_fresh_qc_modules()
            from pathlib import Path

            segments = params.get("segments") or []
            aspect_ratio = str(params.get("aspectRatio") or "16:9")
            max_lines = int(params.get("maxLines") or 2)
            audio_path = params.get("audioPath")
            script_text = params.get("scriptText")
            language = str(params.get("language") or "en")
            chunk_count = int(params.get("chunkCount") or 0)
            validation_report: dict = {}
            cues = subtitle_optimizer.optimize_subtitles_v2(
                segments=segments,
                video_format=aspect_ratio,
                max_lines=max_lines,
                wav_path=Path(audio_path) if audio_path else None,
                script_text=script_text,
                language=language,
                chunk_count=chunk_count,
                debug_validation_report=validation_report,
            )
            srt_content = subtitle_optimizer.export_cues_to_srt(cues)
            return {
                "srt": srt_content,
                "cues": [
                    {
                        "index": c["index"],
                        "startSec": c["startSec"],
                        "endSec": c["endSec"],
                        "text": c["text"],
                    }
                    for c in cues
                ],
                "totalCues": len(cues),
                "validationReport": validation_report,
            }

        server.register_heavy("subtitle.generate_srt", generate_srt_handler)
        server.register_light("subtitle.optimize", optimize_subtitle_handler)
    server.register_light("system.info", lambda _p: system_info(args.runtime, asr, tts))
    server.register_light("tts.engines", tts.engines)
    server.register_heavy("tts.load", tts.load)
    server.register_heavy("tts.synthesize", tts.synthesize)
    server.register_heavy("tts.unload", tts.unload)

    def edge_preview_handler(_m: str, params: dict, ctx: RequestContext) -> dict:
        from .edge_tts_engine import synthesize_edge_tts
        from .tts.service import prepare_spoken_text_for_tts
        ctx.progress(10.0, "connecting")
        raw_text = params.get("text", "Xin chào, đây là giọng đọc thử nghiệm của Edge TTS.")
        raw_rules = params.get("pronunciationRules")
        custom_rules = raw_rules if isinstance(raw_rules, list) else None
        prep = prepare_spoken_text_for_tts(
            raw_text,
            language=params.get("language"),
            engine="edge",
            custom_rules=custom_rules,
        )
        res = synthesize_edge_tts(
            text=prep["spokenText"],
            voice=params.get("voice", "vi-VN-HoaiMyNeural"),
            output_path=params.get("outputPath"),
            rate=params.get("rate", "+0%"),
            pitch=params.get("pitch", "+0Hz"),
            volume=params.get("volume", "+0%"),
        )
        res["sourceText"] = raw_text
        res["spokenText"] = prep["spokenText"]
        res["pronunciationMapping"] = prep["pronunciationMapping"]
        ctx.progress(100.0, "ready")
        return res

    server.register_io("tts.edge_preview", edge_preview_handler)
    server.register_io("tts.edge_synthesize", edge_preview_handler)
    if not getattr(sys, "frozen", False):
        server.register_heavy("system.debug_sleep", debug_sleep)
    return server.serve(protocol_in)


if __name__ == "__main__":
    raise SystemExit(main())
