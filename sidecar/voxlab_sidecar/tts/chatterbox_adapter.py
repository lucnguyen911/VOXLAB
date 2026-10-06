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
        from chatterbox.tts_turbo import ChatterboxTurboTTS

        self._model = ChatterboxTurboTTS.from_local(model_dir, "cuda")
        self.device = device
        return {"dtype": "float32", "sampleRate": int(self._model.sr)}

    def synthesize(self, req: SynthesisRequest) -> tuple[np.ndarray, int]:
        kwargs: dict[str, Any] = {"text": req.text}
        if req.ref_audio_path:
            _check_ref_duration(req.ref_audio_path)
            kwargs["audio_prompt_path"] = req.ref_audio_path
        for key, name in (("temperature", "temperature"), ("exaggeration", "exaggeration"), ("cfgWeight", "cfg_weight")):
            if req.extra.get(key) is not None:
                kwargs[name] = float(req.extra[key])
        wav = self._model.generate(**kwargs)
        arr = wav.detach().cpu().numpy() if hasattr(wav, "detach") else np.asarray(wav)
        return np.asarray(arr, dtype=np.float32).reshape(-1), int(self._model.sr)

    def unload(self) -> None:
        self._model = None
        self.device = None
        release_torch_memory()


def _check_ref_duration(path: str) -> None:
    import soundfile as sf

    if not os.path.isfile(path):
        raise SidecarError("INPUT_NOT_FOUND", "refAudioPath does not exist")
    info = sf.info(path)
    if info.duration <= MIN_REF_SECONDS:
        raise SidecarError("INVALID_REQUEST", f"Chatterbox reference audio must be longer than {MIN_REF_SECONDS:.0f} s")
