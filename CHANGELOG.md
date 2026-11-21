# Changelog — VoxLab Desktop

All notable changes to **VoxLab** are documented in this file.

## [1.0.1] — 2026-11-22

### Added
- **Cài đặt thư mục Cache (bộ nhớ tạm)**:
  - Cho phép chọn thư mục Cache tùy chỉnh và khôi phục về mặc định (`<app_data>/scratch`) trong **Cài đặt → Chung**.
  - Đồng bộ toàn bộ `fs_scratch_dir`, sidecar (`TMP`/`TEMP`/`HF_HOME`/`TORCH_HOME`), installer và updater qua `settings/storage.json`, kèm kiểm tra an toàn đường dẫn & tệp đánh dấu `.voxlab-cache` để bảo vệ dữ liệu người dùng khi dọn bộ nhớ tạm.

### Fixed
- **Hậu kiểm Âm học (Pass 3B)**:
  - Bổ sung phát hiện lỗi lặp âm gió tách rời ở cuối từ (*detached coda sibilant echo*, ví dụ `/s/` lặp tách rời giữa hai từ không dấu câu) mà không làm ảnh hưởng đến các bộ dò hậu kiểm khác.

## [1.0.0] — 2026-11-15 (Initial Official Release)

### Added
- **Unified AI Voice, Subtitle, Dubbing & 5-Task Batch Studio**:
  - Full production workspaces for **Text to Speech**, **Hội thoại (Multi-Speaker Dialogue)**, **Voice Clone**, **Voice Library**, **Phụ đề (Whisper ASR)**, **Dịch & Lồng tiếng (WSOLA `1.20x` + Elastic Ripple Shift + Translation Gom Repair)**, and **Hàng loạt (5-Task Batch Queue)** with synchronized local (`Kokoro-82M`), cloned (`OmniVoice`, `Chatterbox Turbo`, `Qwen3-TTS 1.7B`), and online (`Edge TTS`, `Google Cloud TTS`) voices.
- **Acoustic & Lexical Post-QC Engine (`Hậu kiểm v4.4.6`)**:
  - 4-layer anti-ASR-mishearing protection: context-free vocabulary `hotwords`, General American flapped-`/ɾ/` homophones + compound/loanword normalization, waveform-energy word-boundary re-anchoring (`reanchor_asr_word_timestamps`), and context-aware isolated-slice verification (`verify_suspect_slice_in_context`).
  - Waveform envelope bridge validation (`measure_gap_acoustic_bridge_metrics`) + intra-word pause precision eliminating false `ABNORMAL_PAUSE` alerts on connected prosody while catching real hesitations, stutters, repeats, and swallowed words, with automatic background re-validation.
  - Canonical numeric/decimal/scale/unit & acronym span alignment (`number_normalizer.py`, `pronunciation.py`, `spokenTextNormalizer.ts`, `audio_quality.py`) preventing false missing-word alerts on spelled-out numbers, decimals, currency/units, and abbreviations.
- **Prosodic Punctuation Pause Shaping, Unified Subtitle Inspector & Preview Export**:
  - Real intra-chunk and inter-chunk prosodic punctuation pause shaping (`NGẮT NGHỈ`: `,`, `.`, `?!`, `:;`) across Local, Clone, and Online engines on both full runs, Merge & Export (`Ghép & xuất`), and single-chunk Regenerate (`Tạo lại`).
  - Unified **Phụ đề** inspector across TTS & Dialogue (`Mô hình`, `Tỷ lệ khung hình`, `Số dòng tối đa`, and parallel subtitle translation `Dịch phụ đề`) plus native OS Save As picker on `BottomAudioPlayer`.
- **Adaptive Container-Query Layout, Zero-Python Client Bootstrap & Commercial Security**:
  - Full-app responsive auto-scaling via CSS `@container` queries and fluid `clamp(...)` panels across **Lịch sử**, **Hàng loạt**, **Dịch & Lồng tiếng**, sidebars, drawers, and bottom audio player so tables and controls never overlap in compact windows.
  - Bundled standalone `uv.exe` + hardware-aware installer (`NVIDIA CUDA` vs `CPU`) with pre-bundled `Kokoro-82M` (`int8` ONNX) and manual model management in **Cài đặt → Mô hình**.
  - 4-layer Commercial Security Architecture (polymorphic Rust string cipher, `HMAC-SHA256` DPAPI license vault, mutual Host↔Sidecar `HMAC` handshake + PyArmor/BLAKE2b 256-bit sidecar vault, and hardened WebView2 CSP).
