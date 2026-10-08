"""Protocol methods for TTS. Exactly one TTS model is resident in this process at a time."""
from __future__ import annotations

import os
import time
from typing import Any

from ..protocol import Cancelled, SidecarError, log, require
from ..server import RequestContext
from .base import SynthesisRequest, TtsEngineAdapter, cuda_available


class TtsService:
    def __init__(self, adapters: list[TtsEngineAdapter]):
        self._adapters = {a.capabilities.engine: a for a in adapters}
        self._active: TtsEngineAdapter | None = None

    # -- light ----------------------------------------------------------------
    def engines(self, _params: dict[str, Any]) -> dict[str, Any]:
        out = []
        for a in self._adapters.values():
            caps = a.capabilities.to_dict()
            caps["runtimeStatus"] = (
                "loaded" if a.loaded else ("available" if a.is_installed() else "engine_not_installed")
            )
            out.append(caps)
        return {"engines": out, "cudaAvailable": cuda_available()}

    def status(self) -> dict[str, Any]:
        a = self._active
        return {"loaded": bool(a and a.loaded), "engine": a.capabilities.engine if a else None,
                "device": getattr(a, "device", None) if a else None}

    # -- heavy ----------------------------------------------------------------
    def _adapter(self, engine: str) -> TtsEngineAdapter:
        a = self._adapters.get(engine)
        if a is None:
            raise SidecarError("ENGINE_NOT_INSTALLED", f"engine '{engine}' is not available in this runtime")
        if not a.is_installed():
            raise SidecarError("ENGINE_NOT_INSTALLED", f"python package for '{engine}' is not installed")
        return a

    def _resolve_device(self, a: TtsEngineAdapter, requested: str) -> str:
        caps = a.capabilities
        if requested not in ("auto", "cuda", "cpu"):
            raise SidecarError("INVALID_REQUEST", f"unsupported device '{requested}'")
        has_cuda = cuda_available()
        if requested in ("auto", "cuda") and caps.supports_cuda and has_cuda:
            return "cuda"
        if requested == "cuda":
            raise SidecarError("DEVICE_UNAVAILABLE", "CUDA requested but unavailable")
        if caps.supports_cpu:
            return "cpu"
        raise SidecarError("DEVICE_UNAVAILABLE", f"{caps.display_name} does not support CPU execution")

    def load(self, _m: str, params: dict[str, Any], ctx: RequestContext) -> dict[str, Any]:
        engine = require(params, "engine", str)
        model_dir = require(params, "modelDir", str)
        a = self._adapter(engine)
        missing = a.missing_files(model_dir)
        if missing:
            raise SidecarError("MODEL_NOT_FOUND", f"{engine} model files missing: {', '.join(missing)}")
        device = self._resolve_device(a, params.get("device", "auto"))
        ctx.progress(5, "unloading_previous")
        self.unload_quiet()
        ctx.progress(10, "loading_model")
        started = time.perf_counter()
        try:
            info = a.load(model_dir, device)
        except SidecarError:
            raise
        except Exception as e:  # noqa: BLE001
            a.unload()
            raise SidecarError("MODEL_LOAD_FAILED", f"{type(e).__name__}: {e}") from e
        self._active = a
        self._active_model_dir = model_dir
        load_sec = round(time.perf_counter() - started, 3)
        log(f"tts loaded engine={engine} device={device} in {load_sec}s")
        ctx.progress(100, "model_loaded")
        return {"engine": engine, "device": device, "loadSec": load_sec, **info}

    def synthesize(self, _m: str, params: dict[str, Any], ctx: RequestContext) -> dict[str, Any]:
        a = self._active
        if a is None or not a.loaded:
            raise SidecarError("MODEL_NOT_LOADED", "call tts.load first")
        engine = params.get("engine")
        if engine and engine != a.capabilities.engine:
            # Never silently use a different engine than the caller asked for.
            raise SidecarError("MODEL_NOT_LOADED", f"loaded engine is '{a.capabilities.engine}', not '{engine}'")
        caps = a.capabilities
        text = require(params, "text", str)
        output_path = require(params, "outputPath", str)
        if not os.path.isdir(os.path.dirname(os.path.abspath(output_path))):
            raise SidecarError("INPUT_NOT_FOUND", "output directory does not exist")

        language = params.get("language") or None
        if language and "*" not in caps.supported_languages and language not in caps.supported_languages:
            raise SidecarError("INVALID_REQUEST", f"{caps.display_name} does not support language '{language}'")
        ref_audio = params.get("refAudioPath") or None
        ref_text = params.get("refText") or None
        if ref_audio:
            if not caps.supports_voice_clone:
                raise SidecarError("INVALID_REQUEST", f"{caps.display_name} does not support voice cloning")
            if not os.path.isfile(ref_audio):
                raise SidecarError("INPUT_NOT_FOUND", "refAudioPath does not exist")
            from ..audio_ops import prepare_clone_reference
            models_dir = os.path.dirname(getattr(self, "_active_model_dir", "")) if getattr(self, "_active_model_dir", None) else None
            ref_audio, ref_text = prepare_clone_reference(ref_audio, ref_text, language=language, models_dir=models_dir)
            if caps.reference_text_required and not (isinstance(ref_text, str) and ref_text.strip()):
                raise SidecarError("INVALID_REQUEST", f"{caps.display_name} voice cloning requires refText")
        elif caps.reference_audio_required:
            raise SidecarError("INVALID_REQUEST", f"{caps.display_name} requires a reference audio (refAudioPath)")
        speed = params.get("speed")
        if speed is not None and float(speed) != 1.0 and not caps.supports_speed:
            raise SidecarError("INVALID_REQUEST", f"{caps.display_name} does not support speed control")

        extra: dict[str, Any] = {}
        if isinstance(params.get("advancedSettings"), dict):
            extra.update(params["advancedSettings"])
        allowed_direct_keys = (
            "numStep", "num_step", "temperature", "top_p", "topP", "top_k", "topK",
            "repetition_penalty", "repetitionPenalty", "guidance_scale", "guidanceScale",
            "denoise", "position_temperature", "positionTemperature", "class_temperature",
            "classTemperature", "postprocess_output", "postprocessOutput", "do_sample",
            "doSample", "x_vector_only_mode", "xVectorOnlyMode", "instruct"
        )
        for k in allowed_direct_keys:
            if k in params and params[k] is not None:
                extra[k] = params[k]

        req = SynthesisRequest(text=text, language=language, ref_audio_path=ref_audio, ref_text=ref_text,
                               speed=float(speed) if speed is not None else None,
                               extra=extra)
        ctx.check_cancelled()
        ctx.progress(5, "synthesizing")
        started = time.perf_counter()
        audio, sr = a.synthesize(req)  # single engine call; hard cancel = host kills the process
        inference_sec = time.perf_counter() - started
        if ctx.cancelled:
            raise Cancelled()
        if audio is None or audio.size == 0:
            raise SidecarError("INFERENCE_FAILED", f"{caps.display_name} returned empty audio")
        target_sr = int(params.get("sampleRate") or 0)
        if target_sr > 0 and target_sr != sr:
            from ..audio_ops import _resample
            audio = _resample(audio, sr, target_sr)
            sr = target_sr

        # Master WAV Canonical Invariant: strictly MONO (1 channel)
        if audio.ndim > 1:
            audio = audio.mean(axis=1)

        ctx.progress(90, "writing_audio")
        import soundfile as sf

        tmp_path = output_path + ".tmp.wav"
        try:
            sf.write(tmp_path, audio, sr, subtype="PCM_16", format="WAV")
            os.replace(tmp_path, output_path)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        duration = audio.shape[-1] / float(sr)
        peak = float(abs(audio).max())
        return {"engine": caps.engine, "outputPath": output_path, "sampleRate": sr,
                "durationSec": round(duration, 3), "inferenceSec": round(inference_sec, 3),
                "rtf": round(inference_sec / duration, 4) if duration > 0 else None,
                "peakAmplitude": round(peak, 4), "device": getattr(a, "device", None)}

    def unload(self, _m: str, _p: dict[str, Any], _ctx: RequestContext) -> dict[str, Any]:
        self.unload_quiet()
        return {}

    def unload_quiet(self) -> None:
        if self._active is not None:
            engine = self._active.capabilities.engine
            self._active.unload()
            self._active = None
            log(f"tts unloaded engine={engine}")
