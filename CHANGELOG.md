# Changelog — VoxLab Desktop

All notable changes to **VoxLab** are documented in this file.

## [1.0.0] — 2026-11-13 (Initial Official Release)

### Added
- **Unified AI Voice, Subtitle, Dubbing & 5-Task Batch Studio**:
  - Full production workspaces for **Text to Speech**, **Hội thoại (Multi-Speaker Dialogue)**, **Voice Clone**, **Voice Library**, **Phụ đề (Whisper ASR)**, **Dịch & Lồng tiếng (WSOLA `1.20x` + Elastic Ripple Shift + Translation Gom Repair)**, and **Hàng loạt (5-Task Batch Queue)** with synchronized local (`Kokoro-82M`), cloned (`OmniVoice`, `Chatterbox Turbo`, `Qwen3-TTS 1.7B`), and online (`Edge TTS`, `Google Cloud TTS`) voices.
- **Acoustic & Lexical Post-QC Engine (`Hậu kiểm v4.2.0`)**:
  - 4-layer anti-ASR-mishearing protection: context-free vocabulary `hotwords`, General American flapped-`/ɾ/` homophones + compound/loanword normalization, waveform-energy word-boundary re-anchoring (`reanchor_asr_word_timestamps`), and context-aware isolated-slice verification (`verify_suspect_slice_in_context`).
  - Waveform envelope bridge validation (`measure_gap_acoustic_bridge_metrics`) eliminating false `ABNORMAL_PAUSE` alerts on connected prosody while catching real hesitations, stutters, repeats, and swallowed words (including dropped currency units like `"dollar"`/`"dollars"`).
  - Canonical numeric/decimal/scale/unit span alignment (`number_normalizer.py` + `audio_quality.py`) preventing false missing-word alerts when spelled-out numbers (`"eight point five"`, `"two trillion"`, `"twenty five degrees celsius"`) are transcribed or misheard as compact digits (`"0.5"`, `".5"`, `"$2T"`, `"25°C"`).
- **In-Chunk Punctuation Pause Shaping & Custom Preview Export**:
  - Two-tier prosodic punctuation pause control (`NGẮT NGHỈ`: `,`, `.`, `?!`, `:;`) across Local, Clone, and Online engines on both full runs and single-chunk Regenerate (`Tạo lại`).
  - Native OS Save As folder/file picker on `BottomAudioPlayer` preview bar for individual chunks/cues alongside full Merge & Export (`Ghép & xuất`).
- **Zero-Python Client AI Bootstrap & Tactile Studio UI**:
  - Bundled standalone `uv.exe` + hardware-aware installer (`NVIDIA CUDA` vs `CPU`) with pre-bundled `Kokoro-82M` (`int8` ONNX) and manual model management in **Cài đặt → Mô hình**.
  - 4-layer Commercial Security Architecture (polymorphic Rust string cipher, `HMAC-SHA256` DPAPI license vault, mutual Host↔Sidecar `HMAC` handshake + PyArmor/BLAKE2b 256-bit sidecar vault, and hardened WebView2 CSP).
