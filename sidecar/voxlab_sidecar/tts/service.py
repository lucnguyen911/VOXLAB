"""Protocol methods for TTS. Exactly one TTS model is resident in this process at a time."""
from __future__ import annotations

import os
import re
import time
from typing import Any

from ..protocol import Cancelled, SidecarError, log, require
from ..server import RequestContext
from .base import Capabilities, SynthesisRequest, TtsEngineAdapter, cuda_available

_BRACKET_CONTROL_RE = re.compile(r"\[[^\[\]]*\]")
_VI_DIACRITIC_RE = re.compile(
    r"[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ"
    r"ÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]"
)

_EN_ONES = (
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
    "seventeen", "eighteen", "nineteen",
)
_EN_TENS = ("", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety")

_VI_DIGITS = ("không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín")

_VERSION_HEAD_WORDS: set[str] = {
    "powerwall", "model", "iphone", "ipad", "macbook", "airpods", "imac",
    "galaxy", "pixel", "surface", "windows", "android", "ios", "macos",
    "playstation", "xbox", "switch", "ryzen", "geforce", "radeon", "rtx",
    "gtx", "gpt", "claude", "gemini", "llama", "qwen", "deepseek",
    "starship", "falcon", "optimus", "cybercab", "megapack", "supercharger",
    "nem", "iso", "ieee", "usb", "hdmi", "pcie", "wifi", "wi-fi", "bluetooth",
    "web", "docsis", "wpa", "tls", "http", "version", "ver", "gen",
    "generation", "mark", "mk", "type", "tier", "phase", "stage", "level",
    "part", "chapter",
}

_NON_ENTITY_CAPITALIZED_HEADS: set[str] = {
    "a", "an", "the", "in", "on", "at", "to", "for", "of", "with", "by", "from",
    "into", "onto", "upon", "about", "above", "below", "under", "over", "after",
    "before", "between", "among", "through", "during", "without", "within",
    "around", "near", "nearly", "almost", "only", "just", "even", "than", "as",
    "and", "or", "but", "nor", "so", "yet", "if", "when", "while", "where",
    "because", "although", "though", "unless", "until", "since", "whether",
    "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
    "do", "does", "did", "can", "could", "will", "would", "shall", "should",
    "may", "might", "must", "january", "february", "march", "april", "june",
    "july", "august", "september", "october", "november", "december",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "trong", "trên", "dưới", "tại", "với", "từ", "đến", "cho", "của", "và",
    "hoặc", "nhưng", "khi", "nếu", "vì", "do", "bởi", "khoảng", "hơn", "gần",
}

_MEASUREMENT_OR_QUANTITY_FOLLOWERS: set[str] = {
    "kw", "kwh", "mw", "mwh", "gw", "gwh", "wh", "kv", "mv",
    "ah", "mah", "hz", "khz", "mhz", "ghz", "kb", "mb", "gb", "tb",
    "pb", "bps", "kbps", "mbps", "gbps", "km", "cm", "mm", "nm",
    "mi", "mph", "kph", "km/h", "ft", "yd", "kg", "mg", "lb", "lbs",
    "oz", "ton", "tons", "tonne", "tonnes", "ml", "liter", "liters",
    "litre", "litres", "gal", "gallon", "gallons", "sec", "secs",
    "second", "seconds", "ms", "min", "mins", "minute", "minutes",
    "hr", "hrs", "hour", "hours", "day", "days", "week", "weeks",
    "month", "months", "year", "years", "decade", "decades",
    "dollar", "dollars", "cent", "cents", "euro", "euros", "pound", "pounds",
    "yen", "dong", "vnd", "usd", "eur", "gbp", "percent", "percentage",
    "million", "millions", "billion", "billions", "trillion", "trillions",
    "thousand", "thousands", "hundred", "hundreds", "miles", "feet", "foot",
    "inch", "inches", "meters", "metres", "degrees", "times", "fold",
    "people", "users", "homes", "households", "cars", "vehicles", "trucks",
    "units", "items", "pieces", "packs", "cells", "batteries", "panels",
    "giây", "phút", "giờ", "ngày", "tuần", "tháng", "năm", "thập",
    "đô", "đồng", "triệu", "tỷ", "nghìn", "ngàn", "trăm", "phần", "lần",
    "người", "nhà", "xe", "viên", "tấm", "chiếc", "cái",
}

_VERSION_PATTERN = re.compile(
    r"(?<![$\u20ac\u00a3\u00a5\u20ab\w])"
    r"(?P<head>[A-Za-z\u00C0-\u1EF9][A-Za-z0-9\u00C0-\u1EF9-]*)"
    r"(?P<sep>\s+)"
    r"(?P<ver>\d{1,2}(?:\.\d{1,2}){1,2}|[1-9]\d?)"
    r"(?![.,]?\d|[%a-zA-Z\u00C0-\u1EF9])"
)


def _int_to_spoken_en(n: int) -> str:
    if 0 <= n < 20:
        return _EN_ONES[n]
    if 20 <= n < 100:
        tens, rem = divmod(n, 10)
        return _EN_TENS[tens] if rem == 0 else f"{_EN_TENS[tens]} {_EN_ONES[rem]}"
    return str(n)


def _int_to_spoken_vi(n: int) -> str:
    if 0 <= n < 10:
        return _VI_DIGITS[n]
    if n == 10:
        return "mười"
    if 10 < n < 20:
        rem = n % 10
        if rem == 5:
            return "mười lăm"
        return f"mười {_VI_DIGITS[rem]}"
    if 20 <= n < 100:
        tens, rem = divmod(n, 10)
        if rem == 0:
            return f"{_VI_DIGITS[tens]} mươi"
        if rem == 1:
            return f"{_VI_DIGITS[tens]} mươi mốt"
        if rem == 5:
            return f"{_VI_DIGITS[tens]} mươi lăm"
        return f"{_VI_DIGITS[tens]} mươi {_VI_DIGITS[rem]}"
    return str(n)


def _version_to_spoken(ver: str, lang_code: str) -> str:
    if "." in ver:
        parts = ver.split(".")
        if lang_code == "vi":
            spoken_parts = [_int_to_spoken_vi(int(p)) if p.isdigit() else p for p in parts]
            return " chấm ".join(spoken_parts)
        spoken_parts = [_int_to_spoken_en(int(p)) if p.isdigit() else p for p in parts]
        return " point ".join(spoken_parts)
    n = int(ver)
    return _int_to_spoken_vi(n) if lang_code == "vi" else _int_to_spoken_en(n)


def _is_version_entity_head(head: str) -> bool:
    h_lower = head.lower()
    if h_lower in _VERSION_HEAD_WORDS:
        return True
    if h_lower in _NON_ENTITY_CAPITALIZED_HEADS:
        return False
    # All-caps acronym (e.g. NEM, ISO, USB, GPT) or MixedCase / Capitalized brand (Powerwall, iPhone)
    if len(head) >= 2 and (head[0].isupper() or any(c.isupper() for c in head[1:])):
        if not any(c.isdigit() for c in head):
            return True
    return False


def _find_version_spans(text: str, lang_code: str) -> list[tuple[int, int, str]]:
    """Finds `(start, end, spoken_version)` spans for valid product/policy version numbers."""
    out: list[tuple[int, int, str]] = []
    for m in _VERSION_PATTERN.finditer(text):
        head = m.group("head")
        ver = m.group("ver")
        if not _is_version_entity_head(head):
            continue

        tail_text = text[m.end() :]
        if not re.match(r"^\s*[,.;:!?—–\-)\]\"]", tail_text):
            next_word_match = re.match(r"^\s+([A-Za-z\u00C0-\u1EF9/%]+)", tail_text)
            if next_word_match:
                next_word_raw = next_word_match.group(1)
                next_word = next_word_raw.lower().strip("/%")
                if next_word in _MEASUREMENT_OR_QUANTITY_FOLLOWERS:
                    continue
                if (
                    head.lower() not in _VERSION_HEAD_WORDS
                    and "." not in ver
                    and not (head.isupper() or any(c.isupper() for c in head[1:]))
                ):
                    continue
        else:
            if (
                head.lower() not in _VERSION_HEAD_WORDS
                and "." not in ver
                and not (head.isupper() or any(c.isupper() for c in head[1:]))
            ):
                continue

        spoken_ver = _version_to_spoken(ver, lang_code)
        out.append((m.start("ver"), m.end("ver"), spoken_ver))
    return out


def prepare_spoken_text_for_tts(
    text: str,
    language: str | None = None,
    engine: str | None = None,
    custom_rules: list[dict[str, Any]] | None = None,
    pronunciation_rules: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Returns `{ sourceText, spokenText, pronunciationMapping }` for TTS synthesis and QC."""
    from ..pronunciation import prepare_spoken_text_and_mapping

    eff_rules = custom_rules if custom_rules is not None else pronunciation_rules
    return prepare_spoken_text_and_mapping(
        text,
        language=language,
        engine=engine,
        custom_rules=eff_rules,
        version_span_finder=_find_version_spans,
    )


def normalize_spoken_text_for_tts(
    text: str,
    language: str | None = None,
    engine: str | None = None,
    custom_rules: list[dict[str, Any]] | None = None,
    pronunciation_rules: list[dict[str, Any]] | None = None,
) -> str:
    """Context-aware internal spoken-text normalization for TTS synthesis.

    Applies the 5-tier pronunciation hierarchy (Project User Rules -> Global User Rules ->
    Verified Standard Pronunciation Dictionary -> High-Confidence Contextual Auto-Detection ->
    Keep Original Text) plus product/policy version numbers ('Powerwall 3' -> 'Powerwall three',
    'NEM 3.0' -> 'NEM three point zero').

    Preserves:
    - Original script, UI text, and subtitle text (caller's `text` is unchanged)
    - Pronounceable acronyms (NASA, NATO, OPEC), multi-convention acronyms (FERC, ISO, NEM),
      and ordinary uppercase words (NOW, POWER, HUMAN, TESLA)
    - Context-dependent homographs in ordinary-word contexts ('Who are you?', 'help us', 'It works')
    - Quantities, years (2026), currencies ($10,000), and technical specs with units (13.5 kWh)
    - Bracketed inline control tags (e.g. `[laughter]`, `[B EY1 S]`)
    """
    if not text or not text.strip():
        return text
    eff_rules = custom_rules if custom_rules is not None else pronunciation_rules
    res = prepare_spoken_text_for_tts(
        text, language=language, engine=engine, custom_rules=eff_rules
    )
    return res["spokenText"]


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
    def _adapter(self, a_engine: str) -> TtsEngineAdapter:
        a = self._adapters.get(a_engine)
        if a is None:
            raise SidecarError("ENGINE_NOT_INSTALLED", f"engine '{a_engine}' is not available in this runtime")
        if not a.is_installed():
            raise SidecarError("ENGINE_NOT_INSTALLED", f"python package for '{a_engine}' is not installed")
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
            "doSample", "x_vector_only_mode", "xVectorOnlyMode", "instruct",
            "t_shift", "tShift", "layer_penalty_factor", "layerPenaltyFactor",
            "duration", "preprocess_prompt", "preprocessPrompt",
            "pad_duration", "padDuration", "fade_duration", "fadeDuration",
            "audio_chunk_duration", "audioChunkDuration",
            "audio_chunk_threshold", "audioChunkThreshold",
            "norm_loudness", "normLoudness",
            "subtalker_dosample", "subtalkerDosample",
            "subtalker_top_k", "subtalkerTopK",
            "subtalker_top_p", "subtalkerTopP",
            "subtalker_temperature", "subtalkerTemperature",
            "max_new_tokens", "maxNewTokens",
            "non_streaming_mode", "nonStreamingMode",
        )
        for k in allowed_direct_keys:
            if k in params and params[k] is not None:
                extra[k] = params[k]

        x_vec_mode = bool(extra.get("x_vector_only_mode") or extra.get("xVectorOnlyMode"))

        ref_audio = params.get("refAudioPath") or None
        ref_text = params.get("refText") or None
        if ref_audio:
            if not caps.supports_voice_clone:
                raise SidecarError("INVALID_REQUEST", f"{caps.display_name} does not support voice cloning")
            if not os.path.isfile(ref_audio):
                raise SidecarError("INPUT_NOT_FOUND", "refAudioPath does not exist")
            from ..audio_ops import prepare_clone_reference
            models_dir = os.path.dirname(getattr(self, "_active_model_dir", "")) if getattr(self, "_active_model_dir", None) else None
            # Skip Whisper transcription when model doesn't need transcript:
            # - Chatterbox Turbo does not use ref_text at all
            # - Qwen in x_vector_only_mode does not use ref_text
            skip_transcribe = (caps.engine == "chatterbox") or (caps.engine == "qwen" and x_vec_mode)
            ref_audio, ref_text = prepare_clone_reference(
                ref_audio,
                ref_text,
                language=language,
                models_dir=models_dir,
                skip_transcribe=skip_transcribe,
            )
            # In clone modes that require transcript (e.g. Qwen clone without x-vector, or OmniVoice clone):
            clone_needs_transcript = (caps.reference_text_required and not (caps.engine == "qwen" and x_vec_mode)) or (caps.engine == "omnivoice")
            if clone_needs_transcript and not (isinstance(ref_text, str) and ref_text.strip()):
                raise SidecarError(
                    "INVALID_REQUEST",
                    f"{caps.display_name} voice cloning requires a valid reference transcript matching the audio. Automatic transcription failed or Faster-Whisper model is not available."
                )
        elif caps.reference_audio_required:
            raise SidecarError("INVALID_REQUEST", f"{caps.display_name} requires a reference audio (refAudioPath)")

        # Internal context-aware spoken text normalization for TTS engine:
        # Applies the 5-tier pronunciation hierarchy (Project -> Global -> Verified Dict ->
        # Contextual Auto-Detection -> Preserve) and product/policy version numbers
        # while strictly preserving user script, UI text, and subtitles.
        raw_rules = params.get("pronunciationRules")
        custom_rules = raw_rules if isinstance(raw_rules, list) else None
        prep = prepare_spoken_text_for_tts(
            text, language=language, engine=caps.engine, custom_rules=custom_rules
        )
        spoken_text = prep["spokenText"]

        req = SynthesisRequest(text=spoken_text, language=language, ref_audio_path=ref_audio, ref_text=ref_text,
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

        from ..audio_ops import (
            attenuate_leading_breath_and_measure_edges,
            detect_and_filter_leading_artifact,
            normalize_internal_breath_seams,
        )
        audio, leading_artifact_info = detect_and_filter_leading_artifact(audio, sr)
        audio, breath_seam_info = normalize_internal_breath_seams(audio, sr)
        audio, edge_silence_info = attenuate_leading_breath_and_measure_edges(audio, sr)

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
        peak = float(abs(audio).max()) if audio.size > 0 else 0.0
        result_payload: dict[str, Any] = {
            "engine": caps.engine,
            "outputPath": output_path,
            "sampleRate": sr,
            "durationSec": round(duration, 3),
            "inferenceSec": round(inference_sec, 3),
            "rtf": round(inference_sec / duration, 4) if duration > 0 else None,
            "peakAmplitude": round(peak, 4),
            "device": getattr(a, "device", None),
            "sourceText": text,
            "spokenText": spoken_text,
            "pronunciationMapping": prep["pronunciationMapping"],
            "leadingSilenceMs": edge_silence_info.get("leadingSilenceMs", 0),
            "trailingSilenceMs": edge_silence_info.get("trailingSilenceMs", 0),
        }
        if leading_artifact_info.get("action") != "none":
            result_payload["leadingArtifact"] = leading_artifact_info
        if breath_seam_info.get("compactedMs", 0) > 0 or breath_seam_info.get("attenuatedBreaths", 0) > 0:
            result_payload["breathSeamNormalization"] = breath_seam_info
        return result_payload

    def unload(self, _m: str, _p: dict[str, Any], _ctx: RequestContext) -> dict[str, Any]:
        self.unload_quiet()
        return {}

    def unload_quiet(self) -> None:
        if self._active is not None:
            engine = self._active.capabilities.engine
            self._active.unload()
            self._active = None
            log(f"tts unloaded engine={engine}")
