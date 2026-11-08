"""OmniVoice adapter (k2-fsa/OmniVoice). Runtime: `core`."""
from __future__ import annotations

from typing import Any

import numpy as np

import os
from ..protocol import SidecarError
from .base import (
    Capabilities,
    SynthesisRequest,
    TtsEngineAdapter,
    apply_clamped_extra,
    configure_cuda_backends,
    cuda_available,
    cuda_load_summary,
    release_torch_memory,
    trim_process_working_set,
)

_OMNIVOICE_EXTRA_SPECS = (
    ("num_step", "numStep", int, 4, 128),
    ("guidance_scale", "guidanceScale", float, 1.0, 10.0),
    ("denoise", None, bool, None, None),
    ("position_temperature", "positionTemperature", float, 0.0, 20.0),
    ("class_temperature", "classTemperature", float, 0.0, 5.0),
    ("postprocess_output", "postprocessOutput", bool, None, None),
    ("t_shift", "tShift", float, 0.01, 5.0),
    ("layer_penalty_factor", "layerPenaltyFactor", float, 0.0, 20.0),
    ("preprocess_prompt", "preprocessPrompt", bool, None, None),
    ("pad_duration", "padDuration", float, 0.0, 2.0),
    ("fade_duration", "fadeDuration", float, 0.0, 2.0),
    ("audio_chunk_duration", "audioChunkDuration", float, 5.0, 60.0),
    ("audio_chunk_threshold", "audioChunkThreshold", float, 10.0, 120.0),
)


def _find_default_sample() -> str | None:
    appdata = os.environ.get("APPDATA")
    if appdata:
        p = os.path.join(appdata, "com.voxlab.app", "voices", "samples", "default_local.mp3")
        if os.path.isfile(p):
            return p
    base = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "public", "audio", "samples", "default_local.mp3")
    )
    if os.path.isfile(base):
        return base
    return None


class OmniVoiceAdapter(TtsEngineAdapter):
    capabilities = Capabilities(
        engine="omnivoice",
        display_name="OmniVoice",
        model_id="omnivoice",
        supported_languages=("*",),  # 600+ languages, Vietnamese included (docs/languages.md)
        supports_vietnamese=True,
        supports_voice_clone=True,
        reference_audio_required=False,  # "auto" voice mode works without a reference
        # Auto-transcribed locally with faster-whisper if omitted by caller
        reference_text_required=False,
        supports_cuda=True,
        supports_cpu=False,  # not verified on CPU yet
        supports_speed=True,
        model_size_mb=3116,
        sample_rate=24000,
        notes=("Weights CC-BY-NC-4.0; audio tokenizer under Boson Higgs Audio 2 Community License.",),
    )
    python_package = "omnivoice"
    required_files = ("config.json", "model.safetensors", "audio_tokenizer/model.safetensors")

    def __init__(self) -> None:
        self._model = None
        self.device: str | None = None

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self, model_dir: str, device: str) -> dict[str, Any]:
        import torch
        from omnivoice import OmniVoice

        if device != "cuda" or not cuda_available():
            raise SidecarError("DEVICE_UNAVAILABLE", "OmniVoice requires CUDA (CPU execution not verified)")

        configure_cuda_backends()

        self._model = OmniVoice.from_pretrained(model_dir, device_map="cuda:0", dtype=torch.float16)
        self.device = device

        # Warm up CUDA kernels so the user's first synthesis is instantaneous (~0.9s)
        try:
            self._model.generate(text="Khởi động", num_step=2)
        except Exception:
            pass

        trim_process_working_set()
        return cuda_load_summary("float16", int(self._model.sampling_rate))

    def synthesize(self, req: SynthesisRequest) -> tuple[np.ndarray, int]:
        import torch

        kwargs: dict[str, Any] = {"text": req.text}
        if req.language:
            kwargs["language"] = req.language
        if req.ref_audio_path and os.path.isfile(req.ref_audio_path):
            ref_audio = req.ref_audio_path
            ref_txt = (req.ref_text or "").strip()
            if not ref_txt:
                from ..audio_ops import prepare_clone_reference
                ref_audio, ref_txt = prepare_clone_reference(req.ref_audio_path, req.ref_text, language=req.language)
            kwargs["ref_audio"] = ref_audio
            kwargs["ref_text"] = ref_txt
        else:
            # Fallback to local default sample to guarantee speaker consistency across document chunks
            default_sample = _find_default_sample()
            if default_sample and os.path.isfile(default_sample):
                kwargs["ref_audio"] = default_sample
                kwargs["ref_text"] = "Xin chào, đây là bản nghe thử giọng đọc mẫu trên VoxLab."
            else:
                # Deterministic seed fallback if no reference audio exists at all
                torch.manual_seed(42)
                if torch.cuda.is_available():
                    torch.cuda.manual_seed_all(42)

        if req.speed is not None:
            kwargs["speed"] = float(req.speed)

        extra = req.extra or {}
        apply_clamped_extra(kwargs, extra, _OMNIVOICE_EXTRA_SPECS)

        dur = extra.get("duration")
        if dur is not None and str(dur).strip() != "" and str(dur).lower() != "auto":
            try:
                dur_val = float(dur)
                if dur_val > 0:
                    kwargs["duration"] = max(0.1, min(300.0, dur_val))
            except (ValueError, TypeError):
                pass

        audios = self._model.generate(**kwargs)
        return np.asarray(audios[0], dtype=np.float32), int(self._model.sampling_rate)

    def unload(self) -> None:
        self._model = None
        self.device = None
        release_torch_memory()
