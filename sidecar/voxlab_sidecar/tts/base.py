"""Common TTS engine adapter contract. Each engine declares its real capabilities explicitly."""
from __future__ import annotations

import importlib.util
import os
from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np


@dataclass(frozen=True)
class Capabilities:
    engine: str
    display_name: str
    model_id: str                  # id in the VoxLab model registry (folder name in Models dir)
    supported_languages: tuple[str, ...]  # ISO codes; ("*",) means language-agnostic multilingual
    supports_vietnamese: bool
    supports_voice_clone: bool
    reference_audio_required: bool  # True if the engine cannot synthesise without a reference voice
    reference_text_required: bool   # True if cloning needs a transcript of the reference audio
    supports_cuda: bool
    supports_cpu: bool              # only True once CPU execution was verified on real hardware
    supports_speed: bool
    model_size_mb: int
    sample_rate: int
    required_vram_mb: int | None = None  # filled from real benchmark, never guessed
    notes: tuple[str, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["supported_languages"] = list(self.supported_languages)
        d["notes"] = list(self.notes)
        return {_camel(k): v for k, v in d.items()}


def _camel(s: str) -> str:
    head, *rest = s.split("_")
    return head + "".join(p.capitalize() for p in rest)


@dataclass
class SynthesisRequest:
    text: str
    language: str | None = None
    ref_audio_path: str | None = None
    ref_text: str | None = None
    speed: float | None = None
    extra: dict[str, Any] = field(default_factory=dict)


class TtsEngineAdapter:
    """Lifecycle: load(model_dir, device) → synthesize(...)* → unload()."""

    capabilities: Capabilities
    python_package: str  # import name used to detect whether the engine is installed in this runtime
    required_files: tuple[str, ...] = ()

    def is_installed(self) -> bool:
        return importlib.util.find_spec(self.python_package) is not None

    def missing_files(self, model_dir: str) -> list[str]:
        return [f for f in self.required_files if not os.path.isfile(os.path.join(model_dir, f))]

    # -- to implement -----------------------------------------------------------
    def load(self, model_dir: str, device: str) -> dict[str, Any]:
        raise NotImplementedError

    def synthesize(self, req: SynthesisRequest) -> tuple[np.ndarray, int]:
        """Return mono float waveform and its sample rate. Single blocking engine call."""
        raise NotImplementedError

    def unload(self) -> None:
        raise NotImplementedError

    @property
    def loaded(self) -> bool:
        raise NotImplementedError


def cuda_available() -> bool:
    try:
        import torch

        return bool(torch.cuda.is_available())
    except ImportError:
        return False


def release_torch_memory() -> None:
    import gc

    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except ImportError:
        pass
