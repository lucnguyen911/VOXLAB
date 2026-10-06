"""OmniVoice adapter (k2-fsa/OmniVoice). Runtime: `core`."""
from __future__ import annotations

from typing import Any

import numpy as np

from ..protocol import SidecarError
from .base import Capabilities, SynthesisRequest, TtsEngineAdapter, cuda_available, release_torch_memory


class OmniVoiceAdapter(TtsEngineAdapter):
    capabilities = Capabilities(
        engine="omnivoice",
        display_name="OmniVoice",
        model_id="omnivoice",
        supported_languages=("*",),  # 600+ languages, Vietnamese included (docs/languages.md)
        supports_vietnamese=True,
        supports_voice_clone=True,
        reference_audio_required=False,  # "auto" voice mode works without a reference
        # Upstream can auto-transcribe the reference with a Hub Whisper model; that would be an
        # implicit download, so VoxLab requires the transcript explicitly.
        reference_text_required=True,
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
        self._model = OmniVoice.from_pretrained(model_dir, device_map="cuda:0", dtype=torch.float16)
        self.device = device
        return {"dtype": "float16", "sampleRate": int(self._model.sampling_rate)}

    def synthesize(self, req: SynthesisRequest) -> tuple[np.ndarray, int]:
        kwargs: dict[str, Any] = {"text": req.text}
        if req.language:
            kwargs["language"] = req.language
        if req.ref_audio_path:
            kwargs["ref_audio"] = req.ref_audio_path
            kwargs["ref_text"] = req.ref_text
        if req.speed is not None:
            kwargs["speed"] = float(req.speed)
        if req.extra.get("numStep") is not None:
            kwargs["num_step"] = int(req.extra["numStep"])
        audios = self._model.generate(**kwargs)
        return np.asarray(audios[0], dtype=np.float32), int(self._model.sampling_rate)

    def unload(self) -> None:
        self._model = None
        self.device = None
        release_torch_memory()
