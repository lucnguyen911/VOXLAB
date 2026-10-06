"""faster-whisper ASR engine. Loads only from a local model directory; never downloads."""
from __future__ import annotations

import os
import time
from typing import Any

from .protocol import SidecarError, log, require
from .server import RequestContext


_cuda_dlls_registered = False


def _register_cuda_dlls() -> None:
    """CTranslate2 lazily LoadLibrary()s cublas64_12/cuDNN 9, which ship only inside torch/lib in this
    runtime. Without this, ASR on CUDA only worked if something had imported torch earlier."""
    global _cuda_dlls_registered
    if _cuda_dlls_registered or os.name != "nt":
        return
    _cuda_dlls_registered = True
    import importlib.util

    spec = importlib.util.find_spec("torch")
    if spec is None or not spec.origin:
        return
    lib_dir = os.path.join(os.path.dirname(spec.origin), "lib")
    if os.path.isfile(os.path.join(lib_dir, "cublas64_12.dll")):
        os.add_dll_directory(lib_dir)
        os.environ["PATH"] = lib_dir + os.pathsep + os.environ.get("PATH", "")


def _cuda_device_count() -> int:
    _register_cuda_dlls()
    try:
        import ctranslate2

        return int(ctranslate2.get_cuda_device_count())
    except Exception:  # noqa: BLE001
        return 0


class AsrEngine:
    # faster-whisper (CTranslate2) is verified to run on both CUDA and CPU.
    SUPPORTED_DEVICES = ("cuda", "cpu")

    def __init__(self) -> None:
        self._model = None
        self.device: str | None = None
        self.compute_type: str | None = None
        self.model_dir: str | None = None

    # -- device policy ------------------------------------------------------
    def resolve_device(self, requested: str) -> tuple[str, str]:
        has_cuda = _cuda_device_count() > 0
        if requested == "auto":
            device = "cuda" if has_cuda else "cpu"
        elif requested in self.SUPPORTED_DEVICES:
            device = requested
        else:
            raise SidecarError("INVALID_REQUEST", f"unsupported device '{requested}'")
        if device == "cuda" and not has_cuda:
            raise SidecarError("DEVICE_UNAVAILABLE", "CUDA requested but no CUDA device is usable by CTranslate2")
        return device, ("float16" if device == "cuda" else "int8")

    # -- methods --------------------------------------------------------------
    def load(self, _m: str, params: dict[str, Any], ctx: RequestContext) -> dict[str, Any]:
        model_dir = require(params, "modelDir", str)
        if not os.path.isfile(os.path.join(model_dir, "model.bin")):
            raise SidecarError("MODEL_NOT_FOUND", "faster-whisper model.bin not found in modelDir")
        try:
            from faster_whisper import WhisperModel
        except ImportError as e:
            raise SidecarError("ENGINE_NOT_INSTALLED", f"faster-whisper not installed: {e}") from e

        device, compute_type = self.resolve_device(params.get("device", "auto"))
        compute_type = params.get("computeType") or compute_type
        ctx.progress(10, "loading_model")
        started = time.perf_counter()
        self.unload_quiet()
        try:
            self._model = WhisperModel(model_dir, device=device, compute_type=compute_type, local_files_only=True)
        except Exception as e:  # noqa: BLE001
            raise SidecarError("MODEL_LOAD_FAILED", f"{type(e).__name__}: {e}") from e
        self.device, self.compute_type, self.model_dir = device, compute_type, model_dir
        load_sec = round(time.perf_counter() - started, 3)
        log(f"asr loaded device={device} compute={compute_type} in {load_sec}s")
        ctx.progress(100, "model_loaded")
        return {"device": device, "computeType": compute_type, "loadSec": load_sec}

    def transcribe(self, _m: str, params: dict[str, Any], ctx: RequestContext) -> dict[str, Any]:
        if self._model is None:
            raise SidecarError("MODEL_NOT_LOADED", "call asr.load first")
        audio_path = require(params, "audioPath", str)
        if not os.path.isfile(audio_path):
            raise SidecarError("INPUT_NOT_FOUND", "audioPath does not exist")
        language = params.get("language") or "auto"
        word_ts = bool(params.get("wordTimestamps", True))

        ctx.progress(1, "decoding_audio")
        started = time.perf_counter()
        segments_iter, info = self._model.transcribe(
            audio_path,
            language=None if language == "auto" else language,
            word_timestamps=word_ts,
            beam_size=int(params.get("beamSize", 5)),
            vad_filter=bool(params.get("vad", False)),
        )
        duration = float(info.duration or 0.0)
        segments: list[dict[str, Any]] = []
        # faster-whisper decodes lazily: each iteration is real inference, so cancellation
        # is honoured between segments without killing the process.
        for seg in segments_iter:
            ctx.check_cancelled()
            item: dict[str, Any] = {
                "id": len(segments) + 1,
                "startSec": round(seg.start, 3),
                "endSec": round(seg.end, 3),
                "text": seg.text.strip(),
            }
            if word_ts and seg.words:
                item["words"] = [
                    {"startSec": round(w.start, 3), "endSec": round(w.end, 3), "word": w.word,
                     "probability": round(w.probability, 4)}
                    for w in seg.words
                ]
            segments.append(item)
            if duration > 0:
                ctx.progress(min(99.0, seg.end / duration * 100.0), "transcribing")
        ctx.check_cancelled()
        return {
            "language": info.language,
            "languageProbability": round(float(info.language_probability), 4),
            "durationSec": round(duration, 3),
            "inferenceSec": round(time.perf_counter() - started, 3),
            "device": self.device,
            "segments": segments,
        }

    def unload(self, _m: str, _p: dict[str, Any], _ctx: RequestContext) -> dict[str, Any]:
        self.unload_quiet()
        return {}

    def unload_quiet(self) -> None:
        if self._model is not None:
            self._model = None
            import gc

            gc.collect()
            log("asr unloaded")
        self.device = self.compute_type = self.model_dir = None

    def status(self) -> dict[str, Any]:
        return {"loaded": self._model is not None, "device": self.device, "computeType": self.compute_type}
