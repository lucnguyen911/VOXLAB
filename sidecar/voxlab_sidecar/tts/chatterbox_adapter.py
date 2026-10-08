"""Chatterbox Turbo adapter (resemble-ai/chatterbox, ResembleAI/chatterbox-turbo). Runtime: `chatterbox`.

Runs in its own venv because chatterbox-tts pins transformers/numpy versions incompatible with
OmniVoice and qwen-tts. Output always carries Resemble's Perth implicit watermark (upstream behaviour).
"""
from __future__ import annotations

import os
from typing import Any

import numpy as np

from ..protocol import SidecarError
from .base import Capabilities, SynthesisRequest, TtsEngineAdapter, cuda_available, release_torch_memory

MIN_REF_SECONDS = 5.0  # upstream asserts the reference clip is longer than 5 s


class ChatterboxAdapter(TtsEngineAdapter):
    capabilities = Capabilities(
        engine="chatterbox",
        display_name="Chatterbox Turbo",
        model_id="chatterbox-turbo",
        supported_languages=("en",),  # Turbo is English-only (model card)
        supports_vietnamese=False,
        supports_voice_clone=True,
        reference_audio_required=False,  # default voice from conds.pt when no reference is given
        reference_text_required=False,
        supports_cuda=True,
        supports_cpu=False,  # upstream code allows CPU; not verified on real hardware yet
        supports_speed=False,  # no speed parameter in the Turbo API
        model_size_mb=2849,
        sample_rate=24000,
        notes=(
            "English only.",
            "Reference audio must be longer than 5 seconds.",
            "Output contains Resemble Perth implicit watermark.",
            "Weights and code MIT.",
        ),
    )
    python_package = "chatterbox"
    required_files = (
        "ve.safetensors", "t3_turbo_v1.safetensors", "s3gen_meanflow.safetensors",
        "vocab.json", "merges.txt", "tokenizer_config.json", "special_tokens_map.json",
        "added_tokens.json", "conds.pt",
    )

    def __init__(self) -> None:
        self._model = None
        self.device: str | None = None

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self, model_dir: str, device: str) -> dict[str, Any]:
        if device != "cuda" or not cuda_available():
            raise SidecarError("DEVICE_UNAVAILABLE", "Chatterbox Turbo requires CUDA (CPU execution not verified)")
        import gc
        import os
        import torch
        if hasattr(torch.backends, "cuda") and hasattr(torch.backends.cuda, "matmul"):
            torch.backends.cuda.matmul.allow_tf32 = True
        if hasattr(torch.backends, "cudnn"):
            torch.backends.cudnn.allow_tf32 = True
            torch.backends.cudnn.benchmark = True
        from chatterbox.tts_turbo import ChatterboxTurboTTS

        self._model = ChatterboxTurboTTS.from_local(model_dir, "cuda")
        self.device = device

        gc.collect()
        if os.name == "nt":
            try:
                import ctypes
                ctypes.windll.psapi.EmptyWorkingSet(ctypes.windll.kernel32.GetCurrentProcess())
            except Exception:
                pass

        vram_mb = int(torch.cuda.memory_allocated(0) // (1024 * 1024)) if torch.cuda.is_available() else 0
        gpu_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "NVIDIA GPU"
        return {"dtype": "float32", "sampleRate": int(self._model.sr), "gpu": gpu_name, "vramMb": vram_mb, "device": "cuda:0"}

    def synthesize(self, req: SynthesisRequest) -> tuple[np.ndarray, int]:
        kwargs: dict[str, Any] = {"text": req.text}
        if req.ref_audio_path:
            _check_ref_duration(req.ref_audio_path)
            kwargs["audio_prompt_path"] = req.ref_audio_path
        extra = req.extra or {}
        temp = extra.get("temperature")
        if temp is not None:
            kwargs["temperature"] = max(0.1, min(2.0, float(temp)))

        top_p = extra.get("top_p", extra.get("topP"))
        if top_p is not None:
            kwargs["top_p"] = max(0.1, min(1.0, float(top_p)))

        top_k = extra.get("top_k", extra.get("topK"))
        if top_k is not None:
            kwargs["top_k"] = max(10, min(2000, int(top_k)))

        rep_pen = extra.get("repetition_penalty", extra.get("repetitionPenalty"))
        if rep_pen is not None:
            kwargs["repetition_penalty"] = max(1.0, min(2.0, float(rep_pen)))
        wav = self._model.generate(**kwargs)
        arr = wav.detach().cpu().numpy() if hasattr(wav, "detach") else np.asarray(wav)
        return np.asarray(arr, dtype=np.float32).reshape(-1), int(self._model.sr)

    def unload(self) -> None:
        self._model = None
        self.device = None
        release_torch_memory()
        import os
        if os.name == "nt":
            try:
                import ctypes
                ctypes.windll.psapi.EmptyWorkingSet(ctypes.windll.kernel32.GetCurrentProcess())
            except Exception:
                pass


def _check_ref_duration(path: str) -> None:
    import soundfile as sf

    if not os.path.isfile(path):
        raise SidecarError("INPUT_NOT_FOUND", "refAudioPath does not exist")
    info = sf.info(path)
    if info.duration <= MIN_REF_SECONDS:
        raise SidecarError("INVALID_REQUEST", f"Chatterbox reference audio must be longer than {MIN_REF_SECONDS:.0f} s")
