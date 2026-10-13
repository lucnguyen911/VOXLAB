"""faster-whisper ASR engine with unified lifecycle management.
Loads only from a local model directory; never downloads implicitly.
Single source of truth: ensures a single shared ASR instance across all tasks (transcription, QC, voice cloning).
"""
from __future__ import annotations

import os
import threading
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


_transcript_cache: dict[str, str] = {}


def canonicalize_whisper_model_id(raw_id: str | None) -> str:
    """Normalizes any model name/path into one of: large-v3-turbo, large-v3, medium, small."""
    if not raw_id:
        return "large-v3-turbo"
    s = raw_id.lower().strip()
    if s.startswith("faster-whisper-"):
        s = s[len("faster-whisper-"):]
    if "turbo" in s:
        return "large-v3-turbo"
    if "v3" in s:
        return "large-v3"
    if "medium" in s:
        return "medium"
    if "small" in s:
        return "small"
    return s


def resolve_whisper_model_dir(model_dir_or_id: str | None = None, models_dir: str | None = None) -> tuple[str | None, str]:
    """Resolves local model directory and canonical model ID.
    Supports both 'faster-whisper-<name>' and '<name>' directory conventions.
    Never silently falls back to 'small' if another model was explicitly requested.
    """
    is_explicit = bool(model_dir_or_id and str(model_dir_or_id).strip())

    # If caller passed an existing directory containing model.bin
    if model_dir_or_id and os.path.isdir(model_dir_or_id) and os.path.isfile(os.path.join(model_dir_or_id, "model.bin")):
        folder_name = os.path.basename(os.path.abspath(model_dir_or_id))
        return model_dir_or_id, canonicalize_whisper_model_id(folder_name)

    canonical_id = canonicalize_whisper_model_id(model_dir_or_id if is_explicit else "large-v3-turbo")

    search_bases: list[str] = []
    if models_dir and os.path.isdir(models_dir):
        search_bases.append(models_dir)
    if model_dir_or_id and os.path.isdir(model_dir_or_id):
        search_bases.append(model_dir_or_id)

    appdata = os.environ.get("APPDATA")
    if appdata:
        search_bases.append(os.path.join(appdata, "com.voxlab.app", "models"))
    localappdata = os.environ.get("LOCALAPPDATA")
    if localappdata:
        search_bases.append(os.path.join(localappdata, "com.voxlab.app", "models"))

    def _find_for_id(cid: str) -> str | None:
        cands = [f"faster-whisper-{cid}", cid]
        for base in search_bases:
            for cand in cands:
                p = os.path.join(base, cand)
                if os.path.isdir(p) and os.path.isfile(os.path.join(p, "model.bin")):
                    return p
        for base in search_bases:
            if os.path.isdir(base):
                try:
                    for name in os.listdir(base):
                        if cid in name.lower():
                            p = os.path.join(base, name)
                            if os.path.isdir(p) and os.path.isfile(os.path.join(p, "model.bin")):
                                return p
                except Exception:
                    pass
        return None

    found = _find_for_id(canonical_id)
    if found:
        return found, canonical_id

    # If the caller did NOT explicitly request a specific model (auto-detect fallback),
    # probe for any other locally installed Whisper model in preference order.
    if not is_explicit:
        for fallback_id in ("large-v3", "medium", "small"):
            f = _find_for_id(fallback_id)
            if f:
                return f, fallback_id

    return None, canonical_id


def find_whisper_model_dir(preferred_parent: str | None = None, model_id: str | None = None) -> str | None:
    """Backward compatibility helper for tests and legacy callers."""
    resolved_dir, _ = resolve_whisper_model_dir(model_id, preferred_parent)
    return resolved_dir


class AsrLifecycleManager:
    """Unified ASR Lifecycle Manager (Singleton).
    Guarantees:
    - Exactly ONE Whisper model instance in VRAM/RAM at any time across the entire process.
    - Full reuse of loaded model with zero reload overhead when model/device match.
    - Explicit memory & VRAM cleanup when switching models (gc.collect + torch.cuda.empty_cache).
    - Thread-safe loading and unloading.
    - Never silently falls back to a different model if the requested model is missing.
    """
    _instance: AsrLifecycleManager | None = None
    _singleton_lock = threading.Lock()
    SUPPORTED_DEVICES = ("cuda", "cpu")

    def __init__(self) -> None:
        self._model: Any = None
        self._model_dir: str | None = None
        self._model_id: str | None = None
        self._device: str | None = None
        self._compute_type: str | None = None
        self._lock = threading.Lock()

    @classmethod
    def get_instance(cls) -> AsrLifecycleManager:
        if cls._instance is None:
            with cls._singleton_lock:
                if cls._instance is None:
                    cls._instance = AsrLifecycleManager()
        return cls._instance

    @property
    def current_model_id(self) -> str | None:
        return self._model_id

    @property
    def current_model(self) -> Any:
        return self._model

    @property
    def current_device(self) -> str | None:
        return self._device

    @property
    def current_compute_type(self) -> str | None:
        return self._compute_type

    @property
    def current_model_dir(self) -> str | None:
        return self._model_dir

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

    def get_or_load(
        self,
        model_dir_or_id: str | None = None,
        models_dir: str | None = None,
        device: str = "auto",
        compute_type: str | None = None,
        ctx: RequestContext | None = None,
    ) -> Any:
        with self._lock:
            target_dir, target_id = resolve_whisper_model_dir(model_dir_or_id, models_dir)
            resolved_device, default_compute = self.resolve_device(device)
            resolved_compute = compute_type or default_compute

            # Reuse if identical model, device and precision are already loaded
            if (
                self._model is not None
                and self._model_dir == target_dir
                and self._device == resolved_device
                and self._compute_type == resolved_compute
            ):
                return self._model

            if not target_dir or not os.path.isfile(os.path.join(target_dir, "model.bin")):
                self._unload_locked()
                raise SidecarError(
                    "MODEL_NOT_FOUND",
                    f"faster-whisper model '{target_id}' not found on disk (searched in '{models_dir or target_dir or 'models'}'). Please install it in Settings."
                )

            _register_cuda_dlls()
            try:
                from faster_whisper import WhisperModel
            except ImportError as e:
                raise SidecarError("ENGINE_NOT_INSTALLED", f"faster-whisper not installed: {e}") from e

            if ctx:
                ctx.progress(10, "loading_model")

            # Cleanly unload old model first to reclaim RAM/VRAM
            self._unload_locked()

            started = time.perf_counter()
            try:
                self._model = WhisperModel(
                    target_dir,
                    device=resolved_device,
                    compute_type=resolved_compute,
                    local_files_only=True,
                )
            except Exception as e:  # noqa: BLE001
                raise SidecarError("MODEL_LOAD_FAILED", f"{type(e).__name__}: {e}") from e

            self._model_dir = target_dir
            self._model_id = target_id
            self._device = resolved_device
            self._compute_type = resolved_compute

            load_sec = round(time.perf_counter() - started, 3)
            log(f"[asr] Loaded unified ASR model='{target_id}' dir='{target_dir}' device={resolved_device} compute={resolved_compute} in {load_sec}s")
            if ctx:
                ctx.progress(100, "model_loaded")
            return self._model

    def _unload_locked(self) -> None:
        if self._model is not None:
            del self._model
            self._model = None
            import gc

            gc.collect()
            try:
                import torch

                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass
            log("[asr] Unified ASR model unloaded, VRAM/RAM freed")
        self._model_dir = None
        self._model_id = None
        self._device = None
        self._compute_type = None

    def unload(self) -> None:
        with self._lock:
            self._unload_locked()

    def status(self) -> dict[str, Any]:
        with self._lock:
            return {
                "loaded": self._model is not None,
                "modelId": self._model_id,
                "modelDir": self._model_dir,
                "device": self._device,
                "computeType": self._compute_type,
            }


def get_shared_whisper_model(models_dir: str | None = None, model_id: str | None = None):
    """Returns or initializes the single shared WhisperModel instance.
    Never creates a second model instance."""
    mgr = AsrLifecycleManager.get_instance()
    try:
        return mgr.get_or_load(model_dir_or_id=model_id, models_dir=models_dir)
    except Exception as e:
        log(f"[asr_engine] get_shared_whisper_model failed: {e}")
        return None


def auto_transcribe_sample(
    audio_path: str,
    language: str | None = None,
    models_dir: str | None = None,
    model_id: str | None = None,
) -> str:
    """Quickly transcribe a reference audio sample using the unified faster-whisper model.
    Cached in-memory so repeated chunks reuse the exact transcript with zero overhead."""
    global _transcript_cache

    if not audio_path or not os.path.isfile(audio_path):
        return ""

    cache_key = f"{os.path.abspath(audio_path)}_{language or 'auto'}"
    if cache_key in _transcript_cache:
        return _transcript_cache[cache_key]

    whisper_instance = get_shared_whisper_model(models_dir=models_dir, model_id=model_id)
    if whisper_instance is None:
        log("[auto_transcribe] Unified whisper model unavailable, skipping auto-transcribe")
        return ""

    try:
        lang_code = None if not language or language == "auto" else language
        segments_iter, info = whisper_instance.transcribe(
            audio_path,
            language=lang_code,
            beam_size=5,
            vad_filter=True,
        )
        text = " ".join(s.text.strip() for s in segments_iter if s.text.strip()).strip()
        if not text:
            segments_iter, _ = whisper_instance.transcribe(
                audio_path,
                language=lang_code,
                beam_size=5,
                vad_filter=False,
            )
            text = " ".join(s.text.strip() for s in segments_iter if s.text.strip()).strip()

        if text:
            _transcript_cache[cache_key] = text
            log(f"[auto_transcribe] Transcribed {os.path.basename(audio_path)} ({info.language}): {text[:60]}...")
        return text
    except Exception as e:
        log(f"[auto_transcribe] Failed to transcribe {audio_path}: {e}")
        return ""


class AsrEngine:
    """ASR Engine interface for the JSON-RPC Server.
    Delegates all model management to the unified AsrLifecycleManager singleton."""
    SUPPORTED_DEVICES = AsrLifecycleManager.SUPPORTED_DEVICES

    def __init__(self) -> None:
        self.mgr = AsrLifecycleManager.get_instance()

    @property
    def _model(self) -> Any:
        return self.mgr.current_model

    @_model.setter
    def _model(self, value: Any) -> None:
        self.mgr._model = value

    @property
    def device(self) -> str | None:
        return self.mgr.current_device

    @device.setter
    def device(self, value: str | None) -> None:
        self.mgr._device = value

    @property
    def compute_type(self) -> str | None:
        return self.mgr.current_compute_type

    @compute_type.setter
    def compute_type(self, value: str | None) -> None:
        self.mgr._compute_type = value

    @property
    def model_dir(self) -> str | None:
        return self.mgr.current_model_dir

    @model_dir.setter
    def model_dir(self, value: str | None) -> None:
        self.mgr._model_dir = value

    def resolve_device(self, requested: str) -> tuple[str, str]:
        return self.mgr.resolve_device(requested)

    def load(self, _m: str, params: dict[str, Any], ctx: RequestContext) -> dict[str, Any]:
        model_dir = require(params, "modelDir", str)
        started = time.perf_counter()
        self.mgr.get_or_load(
            model_dir_or_id=model_dir,
            device=params.get("device", "auto"),
            compute_type=params.get("computeType"),
            ctx=ctx,
        )
        load_sec = round(time.perf_counter() - started, 3)
        return {
            "device": self.mgr.current_device,
            "computeType": self.mgr.current_compute_type,
            "modelId": self.mgr.current_model_id,
            "loadSec": load_sec,
        }

    def transcribe(self, _m: str, params: dict[str, Any], ctx: RequestContext) -> dict[str, Any]:
        model = self.mgr.current_model
        if model is None:
            raise SidecarError("MODEL_NOT_LOADED", "call asr.load first")
        audio_path = require(params, "audioPath", str)
        if not os.path.isfile(audio_path):
            raise SidecarError("INPUT_NOT_FOUND", "audioPath does not exist")
        language = params.get("language") or "auto"
        word_ts = bool(params.get("wordTimestamps", True))

        ctx.progress(1, "decoding_audio")
        started = time.perf_counter()
        segments_iter, info = model.transcribe(
            audio_path,
            language=None if language == "auto" else language,
            word_timestamps=word_ts,
            beam_size=int(params.get("beamSize", 5)),
            vad_filter=bool(params.get("vad", False)),
        )
        duration = float(info.duration or 0.0)
        segments: list[dict[str, Any]] = []
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
                    {
                        "startSec": round(w.start, 3),
                        "endSec": round(w.end, 3),
                        "word": w.word,
                        "probability": round(w.probability, 4),
                    }
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
            "device": self.mgr.current_device,
            "modelId": self.mgr.current_model_id,
            "segments": segments,
        }

    def unload(self, _m: str, _p: dict[str, Any], _ctx: RequestContext) -> dict[str, Any]:
        self.unload_quiet()
        return {}

    def unload_quiet(self) -> None:
        self.mgr.unload()

    def status(self) -> dict[str, Any]:
        return self.mgr.status()
