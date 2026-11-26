# Changelog — VoxLab Desktop

All notable changes to **VoxLab** are documented in this file.

## [1.0.5] — 2026-11-26

### Fixed & Improved
- **Đồng nhất Bước Cuối Xuất Phụ Đề theo chuẩn `Audio-Factory` (`Subtitle Sync v2.2`)**:
  - **Khử hoàn toàn lỗi trôi lệch tích lũy trên bài dài (`0.000s` drift)**: Lấy trực tiếp mốc biên thực tế `[startSec, endSec, durationSec]` từ bộ ghép file Master Audio (`fastWav.segments` / `assembleRes.segments`) thay vì cộng dồn khoảng lặng ước tính, chấm dứt hiện tượng phụ đề chạy sớm gần `5 giây` ở cuối bài 25–60 phút.
  - **Hợp nhất cổng tối ưu Word-level DP (`exportUnifiedMasterSubtitlesFromTts`) cho Tab TTS, Tab Phụ đề, Hội thoại và Hàng loạt**: Tự động ánh xạ `qualityReview.words` vào đúng timeline Master Audio để chạy bộ tối ưu Python `optimize_subtitles_v2` trong `~0.1s` (hoặc tự động chạy `generateMasterSubtitles` nếu tắt Hậu kiểm), giữ chuẩn cả định dạng số/viết tắt (`$400`, `$4,800`, `2026`, `AI`, `G20`) lẫn danh từ riêng trong kịch bản.
  - **Chuẩn hóa khổ phụ đề 1 dòng (`max_lines = 1`) theo `Audio-Factory`**: Mở khổ `16:9` 1 dòng lên `target_width=36, max_width=42, max_words=14` (`1:1` 1 dòng: `28/35`; `9:16` 1 dòng: `26/32`) kèm luật `SEMANTIC_OVERFLOW` và bảo vệ cụm trạng từ chỉ mức độ (`very closely`), loại bỏ hoàn toàn các cue chớp `< 0.8s` và `CPS > 20`.
- **Đồng bộ 100% Hậu kiểm (`v4.5.0`) giữa Tab TTS, Tab Hội thoại và Tab Hàng loạt**:
  - Đồng bộ `QUALITY_VALIDATOR_VERSION = "4.5.0"`, bổ sung chuẩn hóa nhịp nghỉ dấu câu (`enforcePunctuationPauses`) trước khi Hậu kiểm ở nhánh Hàng loạt Hội thoại, truyền thống nhất model Whisper đã chọn và khóa chống ghi đè kết quả bất đồng bộ khi người dùng sửa câu thoại.

## [1.0.4] — 2026-11-24

### Fixed & Improved
- **Kháng tiếng lấy hơi `< -30 dBFS` & Đồng bộ Phụ đề chính xác theo Waveform (`Subtitle Sync v2.1`)**:
  - **Tách hoàn toàn bộ dò sóng âm Phụ đề khỏi ngưỡng siêu nhạy của Hậu kiểm**: Xây dựng bộ đo bao năng lượng giọng nói kháng tiếng lấy hơi (`_compute_speech_envelope`, `_find_breath_immune_onset`, `_find_breath_immune_offset`) với sàn cứng `>= -28/-30 dBFS`, loại bỏ hoàn toàn lỗi đặt mốc phụ đề sớm `250–500ms` vào tiếng lấy hơi (`-48..-32 dBFS`) trong khi vẫn bảo toàn phụ âm gió thật đầu/cuối từ (`/s/, /f/, /ʃ/, /kʰ/`).
  - **Cắt gọn điểm kết thúc (`end`) & bỏ nối cầu qua khoảng nghỉ**: Ngăn bộ làm mượt kéo lùi điểm bắt đầu phụ đề sớm vào khoảng lặng (`<= 40ms` lead-in) và chỉ nối khoảng hở `< 80ms` khi đọc liền mạch, không dính đuôi phụ đề vào tiếng lấy hơi câu sau.
  - **Hỗ trợ căn sóng âm trực tiếp cho file Video (`.mp4/.mov/.mkv`) & bật Silero VAD**: Bổ sung giải mã audio qua `PyAV` cho container video và bật `vad_filter=True` cho Whisper khi bóc băng Master.
  - **Đồng bộ căn sóng âm cho cả xuất SRT ở Tab TTS & Xử lý Hàng loạt**: Đăng ký RPC nhẹ `subtitle.align_cues` căn chỉnh trực tiếp các cue TTS trên file Master Audio vừa ghép.
- **Nâng cấp Hậu kiểm Phát âm Lặp âm gió `/s/` (`Hậu kiểm v4.5.0`)**:
  - Bắt chính xác lỗi lặp 2 dấu `/s/` trên các từ đuôi `-sks / -sts / -sps` (như `"tasks"` bị nuốt âm `/k/` thành `"tass-sss"`) kể cả khi đứng trước dấu câu hoặc cuối câu, sử dụng phổ 32 băng tần bất biến theo độ dài (`_sibilant_spec32`) và đo ngưỡng đỉnh âm gió thuần (`ZCR >= 0.42`).

## [1.0.3] — 2026-11-24

### Added & Improved
- **Đồng bộ Timestamp Phụ đề chuẩn từng mili-giây (`Subtitle Sync v2.0`)**:
  - **Re-anchor biên từ theo năng lượng sóng âm (`_reanchor_words_with_waveform`)**: Tích hợp bộ căn chỉnh biên từ âm học từ `Audio-Factory` vào quy trình tạo phụ đề Master (`optimize_subtitles_v2`), khử hoàn toàn hiện tượng Whisper đặt mốc bắt đầu sớm `150–500ms` vào vùng im lặng hoặc hơi thở.
  - **Bắt điểm khởi âm bằng ngưỡng nhiễu nền thích ứng (`align_cues_to_audio_onset`)**: Tính ngưỡng nhiễu nền tự động (`10th percentile` RMS) kết hợp kiểm tra duy trì năng lượng giọng nói (`lookahead confirmation`) trong cửa sổ `800ms`, gỡ bỏ khóa cứng `min(word_start)` và tuyệt đối không vay lấn thời gian sang từ đang đọc của câu kế tiếp.
  - **Đồng bộ trực tiếp Word Timestamps từ Hậu kiểm sang TTS / Hàng loạt**: Lưu lại danh sách mốc thời gian từng từ đã re-anchor trong Hậu kiểm (`qualityReview.words`) và kết quả `segments` từ `ai.assemble` để gán timestamp chính xác cho từng mệnh đề phụ đề mà không cần chờ chạy lại ASR lần 2.

### Fixed
- **Nâng cấp Hậu kiểm Ngắt nghỉ Cú pháp (`Hậu kiểm v4.4.9`)**:
  - Bắt lỗi ngắt nghỉ bất thường giữa cụm chủ ngữ ngắn sau dấu phẩy và vị ngữ (`Every single year, the gas pump | quietly drains`), giữa ngoại động từ và trạng từ ước lượng trước tân ngữ số (`drains | roughly $2,400`), và giữa tân ngữ số lượng/tiền tệ với cụm giới từ bổ nghĩa liền sau (`$2,400 | out of`).

## [1.0.2] — 2026-11-23

### Fixed
- **Nâng cấp Hậu kiểm Âm học & Ngắt nghỉ (`Hậu kiểm v4.4.8`)**:
  - **Pass 3B (Lặp / kéo dài âm gió `/s/`)**: Mở rộng kiểm tra cho từ đứng trước số đếm (`specialists one`), bỏ qua gợn hơi thở nhẹ (`< -47 dB`) trong khoảng lặng sau âm gió, bổ sung ngưỡng bảo vệ ngữ âm cho đuôi kép `-sts / -sks / -sps`, và hỗ trợ bắt âm gió lặp tách rời giữa hai từ liền nhau cùng có âm gió (`...-s | s-...`).
  - **Ngắt nghỉ bất thường trong cụm (`ABNORMAL_PAUSE`)**: Bắt lỗi ngắt nghỉ sau lượng từ nhỏ bổ nghĩa trực tiếp cho danh từ (`one | metro area`) và cụm ngoại động từ V-ing + tính từ bổ nghĩa trước danh từ (`seeing top | medical specialists`), bao gồm cả trường hợp tiếng bật âm tắc yếu (`/p, t, k/`) tách đôi khoảng lặng.
  - **Khử cảnh báo giả do cắt biên từ nối liền**: Kiểm tra lại lát cắt 2 từ liên tục ở Step 3 khi biên phải của từ đa âm tiết bị cắt xuyên qua vùng sóng đang nói (khắc phục cảnh báo giả `"highway"` nghe thành `"Hi"`).

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
