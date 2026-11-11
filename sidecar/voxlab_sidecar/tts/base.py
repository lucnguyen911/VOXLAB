"""Common TTS engine adapter contract. Each engine declares its real capabilities explicitly."""
from __future__ import annotations

import importlib.util
import os
from dataclasses import asdict, dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
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


def configure_cuda_backends() -> None:
    """Enable TF32 on Ampere/Ada/Blackwell while keeping cudnn.benchmark=False for variable-length TTS."""
    import torch

    if hasattr(torch.backends, "cuda") and hasattr(torch.backends.cuda, "matmul"):
        torch.backends.cuda.matmul.allow_tf32 = True
    if hasattr(torch.backends, "cudnn"):
        torch.backends.cudnn.allow_tf32 = True
        torch.backends.cudnn.benchmark = False


def trim_process_working_set() -> None:
    """Run Python GC and trim Windows working set after heavy model load/unload."""
    import gc

    gc.collect()
    if os.name == "nt":
        try:
            import ctypes

            ctypes.windll.psapi.EmptyWorkingSet(ctypes.windll.kernel32.GetCurrentProcess())
        except Exception:
            pass


def cuda_load_summary(dtype: str, sample_rate: int) -> dict[str, Any]:
    import torch

    vram_mb = int(torch.cuda.memory_allocated(0) // (1024 * 1024)) if torch.cuda.is_available() else 0
    gpu_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "NVIDIA GPU"
    return {
        "dtype": dtype,
        "sampleRate": int(sample_rate),
        "gpu": gpu_name,
        "vramMb": vram_mb,
        "device": "cuda:0",
    }


def apply_clamped_extra(
    kwargs: dict[str, Any],
    extra: dict[str, Any],
    specs: tuple[tuple[str, str | None, type, float | int | None, float | int | None], ...],
) -> None:
    """Copy and clamp supported sampling/inference options from `extra` into `kwargs`."""
    for snake_key, camel_key, cast_type, lo, hi in specs:
        val = extra.get(snake_key, extra.get(camel_key) if camel_key else None)
        if val is None:
            continue
        if cast_type is bool:
            kwargs[snake_key] = bool(val)
        else:
            num = cast_type(val)
            if lo is not None:
                num = max(lo, num)
            if hi is not None:
                num = min(hi, num)
            kwargs[snake_key] = num


def release_torch_memory() -> None:
    import gc

    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except ImportError:
        pass
    trim_process_working_set()
