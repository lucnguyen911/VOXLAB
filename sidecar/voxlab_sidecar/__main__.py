"""Entry point: `python -m voxlab_sidecar --runtime <core|chatterbox|qwen>` (dev) or the
PyInstaller-built `voxlab-sidecar-<runtime>` binary (prod)."""
from __future__ import annotations

import argparse
import os
import platform
import sys
import time

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
    info: dict = {"runtime": runtime, "python": platform.python_version(), "platform": platform.platform()}
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="voxlab_sidecar")
    parser.add_argument("--runtime", default="core", choices=["core", "chatterbox", "qwen"])
    args = parser.parse_args(argv)

    sys.stderr.reconfigure(encoding="utf-8")
    # Protocol pipes are private; process stdin → NUL, stdout → stderr (see stdio.py).
    protocol_in, protocol_out = isolate_protocol_streams()

    trace_after = os.environ.get("VOXLAB_SIDECAR_TRACE_AFTER_SEC")
    if trace_after:
        import faulthandler

        faulthandler.dump_traceback_later(float(trace_after), repeat=True, file=sys.stderr)

    server = Server(Writer(protocol_out))
    tts = TtsService(adapters_for_runtime(args.runtime))
    asr = None
    if args.runtime == "core":
        from .asr_engine import AsrEngine

        asr = AsrEngine()
        server.register_heavy("asr.load", asr.load)
        server.register_heavy("asr.transcribe", asr.transcribe)
        server.register_heavy("asr.unload", asr.unload)
        from . import audio_ops
        from . import audio_quality

        def validate_quality_handler(_m: str, params: dict, ctx: RequestContext) -> dict:
            ctx.progress(10.0, "validating_audio")
            audio_path = params.get("audioPath") or ""
            text = params.get("text") or ""
            language = params.get("language")
            models_dir = params.get("modelsDir")
            res = audio_quality.validate_audio_quality(
                audio_path=audio_path,
                text=text,
                language=language,
                models_dir=models_dir,
            )
            ctx.progress(100.0, "validated")
            return res

        server.register_heavy("audio.assemble", audio_ops.assemble)
        server.register_light("audio.probe", audio_ops.probe)
        server.register_heavy("audio.validate_quality", validate_quality_handler)
    server.register_light("system.info", lambda _p: system_info(args.runtime, asr, tts))
    server.register_light("tts.engines", tts.engines)
    server.register_heavy("tts.load", tts.load)
    server.register_heavy("tts.synthesize", tts.synthesize)
    server.register_heavy("tts.unload", tts.unload)

    def edge_preview_handler(_m: str, params: dict, ctx: RequestContext) -> dict:
        from .edge_tts_engine import synthesize_edge_tts
        ctx.progress(10.0, "connecting")
        res = synthesize_edge_tts(
            text=params.get("text", "Xin chào, đây là giọng đọc thử nghiệm của Edge TTS."),
            voice=params.get("voice", "vi-VN-HoaiMyNeural"),
            output_path=params.get("outputPath"),
            rate=params.get("rate", "+0%"),
            pitch=params.get("pitch", "+0Hz"),
            volume=params.get("volume", "+0%"),
        )
        ctx.progress(100.0, "ready")
        return res

    server.register_heavy("tts.edge_preview", edge_preview_handler)
    server.register_heavy("tts.edge_synthesize", edge_preview_handler)
    server.register_heavy("system.debug_sleep", debug_sleep)
    return server.serve(protocol_in)


if __name__ == "__main__":
    raise SystemExit(main())
