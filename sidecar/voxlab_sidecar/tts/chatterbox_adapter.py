"""Chatterbox Turbo adapter (resemble-ai/chatterbox, ResembleAI/chatterbox-turbo). Runtime: `chatterbox`.

Runs in its own venv because chatterbox-tts pins transformers/numpy versions incompatible with
OmniVoice and qwen-tts. Output always carries Resemble's Perth implicit watermark (upstream behaviour).
"""
from __future__ import annotations

import os
import re
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import numpy as np

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

MIN_REF_SECONDS = 5.0  # upstream asserts the reference clip is longer than 5 s
_CHATTERBOX_EXTRA_SPECS = (
    ("temperature", None, float, 0.1, 2.0),
    ("top_p", "topP", float, 0.1, 1.0),
    ("top_k", "topK", int, 10, 2000),
    ("repetition_penalty", "repetitionPenalty", float, 1.0, 2.0),
    ("norm_loudness", "normLoudness", bool, None, None),
)
# Empirical Phase 11 benchmark: Chatterbox Turbo drops words (MISSING_WORD) on chunks >= 400 chars
# (0.9% flagged at <400 chars vs 50% at 400-499 chars and 87.5% at 500-599 chars).
CHATTERBOX_MAX_CHARS_PER_CALL = 380
CHATTERBOX_SPLIT_PAUSE_SEC = 0.18
_SENT_SPLIT_RE = re.compile(r"(?<=[.!?…])\s+")
_CLAUSE_SPLIT_RE = re.compile(r"(?<=[,;:])\s+")


def _split_chatterbox_text(text: str, max_chars: int = CHATTERBOX_MAX_CHARS_PER_CALL) -> list[str]:
    cleaned = (text or "").strip()
    if len(cleaned) <= max_chars:
        return [cleaned] if cleaned else [""]

    sentences = [s.strip() for s in _SENT_SPLIT_RE.split(cleaned) if s.strip()]
    units: list[str] = []
    for sent in sentences:
        if len(sent) <= max_chars:
            units.append(sent)
            continue
        clauses = [c.strip() for c in _CLAUSE_SPLIT_RE.split(sent) if c.strip()]
        for clause in clauses:
            if len(clause) <= max_chars:
                units.append(clause)
            else:
                words = clause.split()
                cur_w = ""
                for w in words:
                    cand_w = f"{cur_w} {w}".strip() if cur_w else w
                    if cur_w and len(cand_w) > max_chars:
                        units.append(cur_w)
                        cur_w = w
                    else:
                        cur_w = cand_w
                if cur_w:
                    units.append(cur_w)

    groups: list[str] = []
    cur = ""
    for u in units:
        cand = f"{cur} {u}".strip() if cur else u
        if cur and len(cand) > max_chars:
            groups.append(cur)
            cur = u
        else:
            cur = cand
    if cur:
        groups.append(cur)
    return groups or [cleaned]


def _trim_piece_edges(x: np.ndarray, sr: int, thr_db: float = -42.0, keep_ms: int = 30) -> np.ndarray:
    import numpy as np

    hop = max(1, int(0.01 * sr))
    n = len(x) // hop
    if n == 0:
        return x
    rms = np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
    peak = float(rms.max())
    if peak <= 1e-9:
        return x
    db = 20.0 * np.log10(rms / (peak + 1e-12))
    voiced = np.where(db >= thr_db)[0]
    if voiced.size == 0:
        return x
    keep = max(1, int(keep_ms / 10))
    s = max(0, (int(voiced[0]) - keep) * hop)
    e = min(len(x), (int(voiced[-1]) + 1 + keep) * hop)
    return x[s:e]


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
        supports_speed=True,  # pitch-preserving time-stretch postprocessing in TtsService
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
        configure_cuda_backends()
        from ..__main__ import _ensure_pkg_resources_shim

        _ensure_pkg_resources_shim()
        import perth

        if getattr(perth, "PerthImplicitWatermarker", None) is None and hasattr(perth, "DummyWatermarker"):
            perth.PerthImplicitWatermarker = perth.DummyWatermarker
        from chatterbox.tts_turbo import ChatterboxTurboTTS

        self._model = ChatterboxTurboTTS.from_local(model_dir, "cuda")
        self.device = device
        trim_process_working_set()
        return cuda_load_summary("float32", int(self._model.sr))

    def synthesize(self, req: SynthesisRequest) -> tuple[np.ndarray, int]:
        import numpy as np

        kwargs: dict[str, Any] = {"text": req.text}
        if req.ref_audio_path:
            _check_ref_duration(req.ref_audio_path)
            kwargs["audio_prompt_path"] = req.ref_audio_path
        apply_clamped_extra(kwargs, req.extra or {}, _CHATTERBOX_EXTRA_SPECS)

        sr = int(self._model.sr)
        parts = _split_chatterbox_text(req.text, CHATTERBOX_MAX_CHARS_PER_CALL)
        if len(parts) <= 1:
            wav = self._model.generate(**kwargs)
            arr = wav.detach().cpu().numpy() if hasattr(wav, "detach") else np.asarray(wav)
            return np.asarray(arr, dtype=np.float32).reshape(-1), sr

        pieces: list[np.ndarray] = []
        gap = np.zeros(int(CHATTERBOX_SPLIT_PAUSE_SEC * sr), dtype=np.float32)
        for idx, part in enumerate(parts):
            part_kwargs = dict(kwargs)
            part_kwargs["text"] = part
            wav = self._model.generate(**part_kwargs)
            arr = wav.detach().cpu().numpy() if hasattr(wav, "detach") else np.asarray(wav)
            piece = np.asarray(arr, dtype=np.float32).reshape(-1)
            piece = _trim_piece_edges(piece, sr)
            pieces.append(piece)
            if idx < len(parts) - 1:
                pieces.append(gap)
        return np.concatenate(pieces), sr

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
