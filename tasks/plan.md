# VoxLab — Implementation Plan & Architecture Specification

**Document Version**: 1.0.0  
**Phase**: Phase 4 — Plan + Task Breakdown (GATE C)  
**Status**: Pending User Approval  
**Source Documents**: [`SPEC.md`](file:///f:/Source%20Code%20Tool/Voxlab/SPEC.md) (v2.4.0), [`CONSTRAINTS.md`](file:///f:/Source%20Code%20Tool/Voxlab/CONSTRAINTS.md)  
**Target Platform**: Windows 10/11 64-bit (x64)  
**Stack**: Tauri v2 (Rust) + React 19 + TypeScript + Vite + Isolated Python/C++ Model Workers  

---

## 1. Plan Overview & Architectural Foundations

Kế hoạch triển khai VoxLab được xây dựng theo phương pháp **Vertical Slicing** và **Thử nghiệm rủi ro kỹ thuật sớm (Fail-Fast)**, bám sát tuyệt đối các ràng buộc trong [`CONSTRAINTS.md`](file:///f:/Source%20Code%20Tool/Voxlab/CONSTRAINTS.md) và các đặc tả hành vi sản phẩm trong [`SPEC.md`](file:///f:/Source%20Code%20Tool/Voxlab/SPEC.md) v2.4.0.

### 1.1 Ranh giới Phân tầng Kiến trúc (System Boundaries)
1. **Frontend Layer (React 19 + TypeScript + Vite)**:
   - Trực quan hóa dữ liệu, quản lý trạng thái UI in-memory, xử lý audio preview bằng Web Audio API.
   - Giao tiếp với backend 100% thông qua Tauri IPC (`invoke` và `listen`).
   - **Tuyệt đối không**: Chạy shell command, gọi trực tiếp tiến trình Python, truy cập trực tiếp file system.
2. **Backend Orchestration Layer (Tauri v2 / Rust)**:
   - Giám sát tiến trình con (Process Supervisor): Khởi động, dừng, kiểm tra sức khỏe và dọn dẹp worker khi cancel/crash.
   - Quản lý hàng đợi an toàn (Safe Sequential Queue, Concurrency = 1).
   - Kiểm tra phần cứng (NVIDIA NVML / CUDA / VRAM / CPU / RAM).
   - Quản lý lưu trữ bền vững (SQLite Manager với ordered migrations và backup).
   - Quản lý đường dẫn độc lập: App Install $\neq$ Data Root $\neq$ Model Paths (TTS & ASR) $\neq$ Output Path.
   - Xử lý audio stitching bằng FFmpeg cục bộ.
   - Cầu nối lưu trữ thông tin xác thực bảo mật (Windows DPAPI / OS Credential Store).
3. **Model Worker Subprocesses (Python venv / Isolated Runtimes)**:
   - Chạy cô lập trong các tiến trình con riêng biệt.
   - Giao tiếp với Rust qua documented & versioned IPC interface có **Capability & Version Handshake**.
   - Crash của worker được cô lập hoàn toàn, không làm sập giao diện chính.
4. **Local LLM & Online Providers**:
   - Local LLM: Kết nối qua HTTP tới LM Studio / OpenAI-compatible local endpoint (LM Studio tự quản lý GGUF/VRAM).
   - Translation: Generic provider architecture (Local LLM + Cloud Gemini API có cảnh báo bảo mật).
   - Online Voice: Kiến trúc provider trừu tượng (Microsoft, Google...), loại trừ endpoint không chính thức.

---

## 2. Lộ trình Milestones & Ma trận Nhiệm vụ

Kế hoạch được chia thành **8 Milestones chiến lược**:

* **Milestone 1: Foundations, Storage Engine & Safe Data Migration** (Nền tảng cấu hình, 4 đường dẫn, SQLite versioning, migration an toàn và credential store).
* **Milestone 2: Process Supervisor, Safe Queue & Worker IPC Interface** (Hệ thống điều phối tiến trình con, handshake năng lực, hàng đợi tuần tự, bounded cancel).
* **Milestone 3: Model Feasibility Spike & Primary Engine Adapters** (Thẩm định kỹ thuật các model TTS candidate và tích hợp faster-whisper).
* **Milestone 4: Core Text & Audio Stitching Pipelines** (Chuẩn hóa tất định bảo vệ protected spans, Smart Chunking, Local LLM client, Gemini translation, FFmpeg stitcher).
* **Milestone 5: Voice Profile & Voice Library Engine** (Tài sản reference mẫu bền vững, định danh voice bất biến, quản trị thư viện giọng, "Use in TTS").
* **Milestone 6: UI / UX Design & Prototyping Gate (Pre-wiring for Gate D)** (Chuẩn bị kiến trúc frontend, routing, state stores, sẵn sàng cho Stitch UI/UX Gate).
* **Milestone 7: Desktop Studio Workspaces & Feature Workflows** (Hiện thực hóa 4 workspace chính, 2 workspace tiện ích, inspector và bottom job bar).
* **Milestone 8: System Hardening, Recovery & Packaging Verification** (Kiểm chứng Interrupted Recovery, Update Migration, Downgrade Safety, Offline Core, và Windows installer).

---

## 3. Chi tiết Task Breakdown (T01 đến T28)

### MILESTONE 1: FOUNDATIONS, STORAGE ENGINE & SAFE DATA MIGRATION

#### [TASK-01] Kiến trúc Lưu trữ 4 Đường dẫn & Cơ chế Bootstrap Data Root Discovery
- **Goal**: Xây dựng module quản lý 4 loại đường dẫn độc lập (App Install, Data Root, TTS Model Path, Transcription Model Path, Output Path) và cơ chế bootstrap lưu vị trí Data Root bền vững.
- **Dependencies**: None.
- **Expected Files**: `src-tauri/src/paths.rs`, `src-tauri/src/bootstrap.rs`.
- **Acceptance Criteria**:
  - Nhận diện đúng thư mục cài đặt app (chỉ đọc).
  - Khởi tạo mặc định Data Root tại Windows user data, cho phép cấu hình sang ổ đĩa khác (ví dụ `D:\VoxLabData`).
  - Ghi nhận đường dẫn Data Root tích cực vào file bootstrap nhẹ tại OS standard location.
  - Khi binary app khởi động lại, tự động đọc bootstrap để định vị Data Root hiện hành; nếu mất dấu thì trả về trạng thái yêu cầu người dùng định vị (Locate Existing Data Root), không tự tạo thư mục rỗng ngầm.
- **Verification**: `cargo test test_bootstrap_data_root_discovery`.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

#### [TASK-02] SQLite Storage Engine với Versioned Schema & Ordered Migrations
- **Goal**: Thiết lập kết nối SQLite local (`voxlab.db`), quản lý phiên bản schema tường minh (`schema_version`), và cơ chế migration tuần tự có backup phục hồi.
- **Dependencies**: TASK-01.
- **Expected Files**: `src-tauri/src/db/mod.rs`, `src-tauri/src/db/migrations.rs`, `src-tauri/src/db/schema.rs`.
- **Acceptance Criteria**:
  - Tạo bảng `schema_version` ghi nhận số hiệu phiên bản hiện hành.
  - Hỗ trợ chuỗi migration tuần tự ($1 \rightarrow 2 \rightarrow 3$).
  - Trước khi chạy migration: tự động tạo bản sao lưu recoverable backup (`voxlab.db.bak`).
  - Nếu migration thất bại: tự động rollback về bản backup, không xóa backup, trả mã lỗi nâng cấp rõ ràng, không tạo DB rỗng thay thế.
  - Kiểm tra tương thích hạ cấp (Downgrade Safety): Nếu phiên bản app cũ gặp DB có schema cao hơn, từ chối mở và không ghi đè database.
- **Verification**: `cargo test test_ordered_migrations_and_rollback`.
- **Risk**: HIGH (Liên quan đến an toàn dữ liệu người dùng).
- **User Approval Required**: NO.

#### [TASK-03] Module Safe Data Root Migration (Copy $\rightarrow$ Verify $\rightarrow$ Activate/Rollback)
- **Goal**: Xây dựng dịch vụ di chuyển toàn bộ dữ liệu ứng dụng (database, sessions, voice library, managed assets) sang vị trí mới khi người dùng đổi Data Root.
- **Dependencies**: TASK-01, TASK-02.
- **Expected Files**: `src-tauri/src/storage/migration.rs`.
- **Acceptance Criteria**:
  - Quét kiểm tra dữ liệu hiện có tại Data Root cũ.
  - Sao chép toàn bộ persistent data sang Data Root mới.
  - Kiểm chứng tính toàn vẹn của dữ liệu sau khi sao chép.
  - Kích hoạt Data Root mới chỉ sau khi kiểm chứng thành công 100%; không xóa dữ liệu tại Data Root cũ trước khi kích hoạt thành công.
  - Nếu xảy ra lỗi (ví dụ hết dung lượng đĩa đích): rollback, tiếp tục dùng Data Root cũ an toàn.
- **Verification**: `cargo test test_data_root_migration_with_rollback`.
- **Risk**: HIGH.
- **User Approval Required**: NO.

#### [TASK-04] Secure Credential Storage Bridge cho Online Providers
- **Goal**: Tích hợp cơ chế lưu trữ an toàn cho API keys (Google Gemini API, Online Voice credentials) sử dụng Windows DPAPI / Credential Manager.
- **Dependencies**: None.
- **Expected Files**: `src-tauri/src/security/credentials.rs`.
- **Acceptance Criteria**:
  - Mã hóa và lưu trữ API keys an toàn qua DPAPI hoặc Windows Credential Store.
  - Tuyệt đối không lưu API keys dưới dạng plaintext trong SQLite hay file config thông thường.
  - Đọc và xóa credential an toàn khi người dùng yêu cầu reset.
- **Verification**: `cargo test test_credential_dpapi_roundtrip`.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

---

### MILESTONE 2: PROCESS SUPERVISOR, SAFE QUEUE & WORKER IPC INTERFACE

#### [TASK-05] Process Supervisor & Subprocess Lifecycle Manager
- **Goal**: Xây dựng module Rust quản lý việc khởi chạy, giám sát sức khỏe, ngắt kết nối và dọn dẹp các tiến trình con Python/C++ của model worker.
- **Dependencies**: TASK-01.
- **Expected Files**: `src-tauri/src/supervisor/mod.rs`, `src-tauri/src/supervisor/process.rs`.
- **Acceptance Criteria**:
  - Khởi động tiến trình worker trong môi trường cô lập với tham số lệnh an toàn (mảng args rời rạc, chống shell injection).
  - Giám sát trạng thái tiến trình (heartbeat / ping); phát hiện ngay khi worker crash (exit code $\neq 0$).
  - Đảm bảo window chính và giao diện React hoàn toàn không bị ảnh hưởng khi tiến trình con gặp sự cố crash.
  - Khi app đóng hoặc khi cancel: dọn dẹp sạch sẽ toàn bộ tiến trình con, không để lại tiến trình mồ côi (no orphan processes).
- **Verification**: `cargo test test_worker_process_crash_isolation`.
- **Risk**: HIGH.
- **User Approval Required**: NO.

#### [TASK-06] Documented IPC Protocol & Capability/Version Handshake
- **Goal**: Định nghĩa giao thức truyền thông điệp có cấu trúc giữa Rust supervisor và model worker, kèm cơ chế bắt tay phiên bản và năng lực (Capability Handshake).
- **Dependencies**: TASK-05.
- **Expected Files**: `src-tauri/src/ipc/protocol.rs`, `src-tauri/src/ipc/handshake.rs`.
- **Acceptance Criteria**:
  - Khởi tạo giao thức truyền tải tin cậy có schema rõ ràng (typed messages).
  - Khi worker khởi động, bắt buộc gửi bản tin handshake khai báo: phiên bản giao thức, engine name, model name, supported languages, supported features (voice cloning, emotion tags, streaming).
  - Nếu phiên bản giao thức không khớp hoặc thiếu năng lực yêu cầu: báo lỗi tường minh, từ chối nạp model, không silent fail.
- **Verification**: `cargo test test_worker_handshake_compatibility`.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

#### [TASK-07] Safe Sequential Job Queue Orchestrator & Bounded Cancellation
- **Goal**: Xây dựng hàng đợi xử lý tác vụ tuần tự (Safe Sequential Queue, Concurrency = 1) với cơ chế tạm dừng an toàn (Pause) và hủy bỏ có kiểm soát (Bounded Cancel).
- **Dependencies**: TASK-05, TASK-06.
- **Expected Files**: `src-tauri/src/queue/mod.rs`, `src-tauri/src/queue/job.rs`.
- **Acceptance Criteria**:
  - Quản lý hàng đợi tác vụ tuần tự (mặc định xử lý 1 tác vụ tại một thời điểm để bảo vệ VRAM).
  - Pause Queue: Ngay lập tức không nạp chunk tiếp theo; chunk đang chạy dở dang được hoàn tất an toàn hoặc ngắt an toàn.
  - Cancel Job: Dừng hàng đợi, gửi tín hiệu ngắt tới worker (cooperative cancel hoặc controlled restart), dọn dẹp tài nguyên và giải phóng RAM/VRAM; toàn bộ các chunk đã hoàn thành trước đó được giữ nguyên trạng thái `Ready`.
- **Verification**: `cargo test test_queue_pause_and_bounded_cancel`.
- **Risk**: HIGH.
- **User Approval Required**: NO.

#### [TASK-08] Hardware Diagnostics & Capability Inspection Module
- **Goal**: Thu thập thông tin phần cứng hệ thống (NVIDIA GPU, VRAM tổng/khả dụng, CUDA runtime, CPU, RAM) và kiểm tra sự sẵn sàng của FFmpeg.
- **Dependencies**: None.
- **Expected Files**: `src-tauri/src/hardware/mod.rs`, `src-tauri/src/hardware/nvml.rs`, `src-tauri/src/hardware/ffmpeg.rs`.
- **Acceptance Criteria**:
  - Phát hiện chính xác GPU NVIDIA và dung lượng VRAM (hoạt động tốt trên RTX 5070 Ti 16GB).
  - Kiểm tra tính sẵn sàng của CUDA runtime và FFmpeg trong hệ thống.
  - Cung cấp dữ liệu chẩn đoán cho thuật toán Auto Whisper và màn hình Settings $\rightarrow$ System & Hardware.
- **Verification**: `cargo test test_hardware_detection`.
- **Risk**: LOW.
- **User Approval Required**: NO.

---

### MILESTONE 3: MODEL FEASIBILITY SPIKE & PRIMARY ENGINE ADAPTERS

#### [TASK-09] Model Feasibility Spike: Đánh giá Candidate TTS Models trên Windows/CUDA
- **Goal**: Thực hiện technical spike kiểm chứng thực tế 3 candidate models: OmniVoice, Chatterbox Turbo, Qwen TTS trên môi trường Windows 11 / CUDA 13.x / RTX 5070 Ti.
- **Dependencies**: TASK-05, TASK-06, TASK-08.
- **Expected Files**: `scripts/feasibility/tts_spike.py`, `docs/MODEL_FEASIBILITY_REPORT.md`.
- **Acceptance Criteria**:
  - Đánh giá khả năng cài đặt dependency, độ ổn định runtime, dung lượng VRAM thực tế khi nạp model.
  - Kiểm tra khả năng phát âm Tiếng Việt và Tiếng Anh (Model Set coverage).
  - Kiểm chứng năng lực Reference Audio / Voice Cloning: đo thời lượng audio mẫu yêu cầu, độ ổn định clone, và năng lực multilingual clone.
  - Phân loại chính thức từng model thành: `RECOMMENDED FOR MVP`, `RECOMMENDED FOR LATER`, `NOT RECOMMENDED`, `NEEDS TECHNICAL SPIKE`.
  - Báo cáo kết quả rõ ràng để chốt tổ hợp model cho MVP.
- **Verification**: Thực thi script benchmark và tạo báo cáo `docs/MODEL_FEASIBILITY_REPORT.md`.
- **Risk**: HIGH (Quyết định model set chính thức của MVP).
- **User Approval Required**: YES (Trình User duyệt kết quả Model Feasibility trước khi đóng gói adapter).

#### [TASK-10] Adapter Tích hợp faster-whisper (Medium, Large V3, Large V3 Turbo & Auto)
- **Goal**: Xây dựng worker adapter cho engine faster-whisper hỗ trợ Tiếng Việt, Tiếng Anh và đa ngôn ngữ với Auto Language Detection.
- **Dependencies**: TASK-06, TASK-08.
- **Expected Files**: `workers/asr/whisper_worker.py`, `src-tauri/src/workers/asr_adapter.rs`.
- **Acceptance Criteria**:
  - Hỗ trợ các kích thước model: `Medium`, `Large V3`, `Large V3 Turbo`.
  - Cơ chế `Auto`: Tự động chọn model phù hợp dựa trên VRAM khả dụng và trạng thái model đã cài đặt.
  - Bóc băng âm thanh/video, tự động nhận diện ngôn ngữ nguồn (`Auto Detect`) và trích xuất cấu trúc segments có timestamp chuẩn (`Start --> End`).
  - Xuất dữ liệu transcript hợp lệ, không bị crash khi gặp file audio dài.
- **Verification**: `cargo test test_whisper_adapter_transcription`.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

#### [TASK-11] Adapter Tích hợp TTS Engine chính thức cho MVP
- **Goal**: Xây dựng worker adapter cho model TTS được chọn từ kết quả Task 09, hỗ trợ Standard TTS và Voice Cloning.
- **Dependencies**: TASK-06, TASK-09.
- **Expected Files**: `workers/tts/tts_worker.py`, `src-tauri/src/workers/tts_adapter.rs`.
- **Acceptance Criteria**:
  - Hỗ trợ sinh âm thanh chất lượng tốt cho cả Tiếng Việt và Tiếng Anh (theo Model Set).
  - Hỗ trợ Voice Cloning từ reference audio mẫu: nhận file mẫu, áp dụng các tham số clone được hỗ trợ.
  - Triển khai Capability Handshake tương thích hoàn toàn với Rust supervisor.
  - Sinh ra dữ liệu audio PCM/WAV hợp lệ cho từng chunk văn bản.
- **Verification**: `cargo test test_tts_worker_generation`.
- **Risk**: HIGH.
- **User Approval Required**: NO.

---

### MILESTONE 4: CORE TEXT & AUDIO STITCHING PIPELINES

#### [TASK-12] Deterministic Text Normalization với Bảo vệ Protected Spans
- **Goal**: Hiện thực hóa thuật toán chuẩn hóa văn bản tất định không làm thay đổi ngữ nghĩa, bảo vệ 100% các định dạng số, thời gian, URL, email, từ viết tắt.
- **Dependencies**: None.
- **Expected Files**: `src-tauri/src/text/normalization.rs`.
- **Acceptance Criteria**:
  - Chuẩn hóa Unicode NFC dựng sẵn thống nhất đa ngôn ngữ.
  - Tối ưu khoảng trắng thừa, chuẩn hóa ngắt dòng (tối đa 2 dòng), ngoặc kép `""`, gạch ngang `-`.
  - Chuẩn hóa khoảng cách quanh dấu câu nhưng bảo vệ nguyên vẹn các Protected Spans: số thập phân (`3.14`), giờ (`10:30`), URL (`example.com`), email (`user@email.com`), từ viết tắt (`TP.HCM`), IP (`127.0.0.1`), version (`v2.0`).
- **Verification**: `cargo test test_deterministic_normalization_protected_spans`.
- **Risk**: LOW.
- **User Approval Required**: NO.

#### [TASK-13] Smart Chunking Engine phân tầng theo Model Profile
- **Goal**: Xây dựng bộ chia phân đoạn câu thông minh theo thứ tự ưu tiên (Đoạn văn $\rightarrow$ Câu hoàn chỉnh $\rightarrow$ Vế câu $\rightarrow$ Fallback an toàn) dựa trên profile model.
- **Dependencies**: TASK-12.
- **Expected Files**: `src-tauri/src/text/chunking.rs`.
- **Acceptance Criteria**:
  - Cắt câu theo phân tầng ưu tiên, không bao giờ cắt ngang Protected Spans.
  - Cấu hình linh hoạt ngưỡng độ dài chunk (min, target, max chars) theo từng profile model TTS (TUNING REQUIRED).
  - Trả về danh sách chunks có chỉ số thứ tự, nội dung text, và hash xác thực.
- **Verification**: `cargo test test_smart_chunking_hierarchy`.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

#### [TASK-14] Local LLM Client (LM Studio Integration) & AI Text Actions
- **Goal**: Xây dựng client HTTP kết nối tới LM Studio / OpenAI-compatible endpoint, tự động discover model, thực hiện AI Punctuation có Lexical Guardrail và AI Optimize.
- **Dependencies**: None.
- **Expected Files**: `src-tauri/src/ai/client.rs`, `src-tauri/src/ai/punctuation.rs`, `src-tauri/src/ai/guardrail.rs`.
- **Acceptance Criteria**:
  - Test Connection tới LM Studio URL, kiểm tra các trạng thái kết nối và lấy danh sách model qua API.
  - Prompt AI Punctuation chỉ định rõ chỉ sửa dấu câu.
  - **Lexical Guardrail Validation**: So khớp danh sách từ trước và sau; phát hiện và gắn cờ cảnh báo nếu LLM tự ý thêm/bớt/sửa từ vựng.
  - Quản lý Text Revision Semantics: Hỗ trợ `Reject AI Revision` (về Working Text cũ) và `Restore Original` (về 100% Original Source ban đầu).
- **Verification**: `cargo test test_ai_lexical_guardrail`.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

#### [TASK-15] Generic Translation Provider Architecture (Local LLM & Google Gemini API)
- **Goal**: Xây dựng hệ thống dịch văn bản hỗ trợ 2 providers: Local LLM và Optional Cloud Provider (Google Gemini API) với chính sách Per-Operation Apply Policy.
- **Dependencies**: TASK-04, TASK-14.
- **Expected Files**: `src-tauri/src/translation/mod.rs`, `src-tauri/src/translation/gemini.rs`, `src-tauri/src/translation/local.rs`.
- **Acceptance Criteria**:
  - Giao diện provider generic: dịch từ Source Language sang Target Language.
  - Kết nối Gemini API sử dụng API Key lưu bảo mật qua DPAPI.
  - Cảnh báo rõ ràng việc gửi dữ liệu ra ngoài khi dùng Cloud; không tự ý fallback sang cloud khi local lỗi.
  - Áp dụng Per-Operation Apply Policy: Hỗ trợ `Review before Apply` (mặc định) và `Auto Apply` (vẫn bảo toàn bản gốc).
- **Verification**: `cargo test test_translation_provider_interfaces`.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

#### [TASK-16] Audio Stitching Pipeline & FFmpeg Concat Engine
- **Goal**: Xây dựng module ghép nối các file chunk audio thành file audio tổng hoàn chỉnh (WAV/MP3) có chèn khoảng lặng tự động (Auto Pause Buffer).
- **Dependencies**: TASK-08.
- **Expected Files**: `src-tauri/src/audio/stitcher.rs`, `src-tauri/src/audio/silence.rs`.
- **Acceptance Criteria**:
  - Nối các file chunk theo đúng thứ tự kịch bản.
  - Tự động chèn khoảng lặng giữa các câu dựa trên cấu trúc (ngắt đoạn dài hơn ngắt câu, mặc định ~400ms TUNING REQUIRED).
  - Hỗ trợ ghi đè khoảng lặng (pause override) riêng từng chunk.
  - Xuất ra file `.wav` chuẩn hoặc `.mp3` chuẩn có gắn metadata.
- **Verification**: `cargo test test_audio_stitching_with_pause`.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

---

### MILESTONE 5: VOICE PROFILE & VOICE LIBRARY ENGINE

#### [TASK-17] Managed Reference Audio Assets Engine
- **Goal**: Xây dựng cơ chế lưu trữ và quản lý bền vững các file audio mẫu clone trong Data Root (`managed voice assets`).
- **Dependencies**: TASK-01.
- **Expected Files**: `src-tauri/src/voice/assets.rs`.
- **Acceptance Criteria**:
  - Khi lưu Voice Profile, tự động sao chép file audio mẫu vào thư mục dữ liệu quản lý của VoxLab với định danh an toàn.
  - Xác thực tính hợp lệ và thời lượng tối thiểu của file mẫu.
  - Đảm bảo khi người dùng xóa file gốc ngoài máy, Voice Profile đã lưu vẫn hoạt động bình thường.
- **Verification**: `cargo test test_managed_reference_assets`.
- **Risk**: LOW.
- **User Approval Required**: NO.

#### [TASK-18] Voice Profile Repository & Stable Identity Management
- **Goal**: Quản trị thực thể Voice Profile trong SQLite với định danh bất biến (Stable ID), metadata tương thích model/ngôn ngữ, và hệ thống tag.
- **Dependencies**: TASK-02, TASK-17.
- **Expected Files**: `src-tauri/src/voice/repository.rs`, `src-tauri/src/voice/profile.rs`.
- **Acceptance Criteria**:
  - Tạo mới Voice Profile với Stable ID duy nhất.
  - Cho phép đổi tên (Rename) và sửa Tags mà không làm thay đổi ID.
  - Các phiên làm việc (sessions) cũ liên kết với voice qua Stable ID.
  - Lưu trữ metadata tương thích model và ngôn ngữ hỗ trợ.
- **Verification**: `cargo test test_voice_profile_stable_identity`.
- **Risk**: LOW.
- **User Approval Required**: NO.

#### [TASK-19] Voice Library Business Logic & Safe Delete Orchestration
- **Goal**: Xây dựng các dịch vụ quản lý thư viện giọng: Liệt kê, tìm kiếm theo tên, lọc theo tag, lọc theo nguồn (Local / Online), xóa an toàn có cảnh báo, và cầu nối `[Use in TTS]`.
- **Dependencies**: TASK-18.
- **Expected Files**: `src-tauri/src/voice/library.rs`.
- **Acceptance Criteria**:
  - Tìm kiếm voice theo tên và lọc chính xác theo mảng tags.
  - Phân loại nguồn voice: Local My Voices, Preset Local, và Online Voices (gắn nhãn ONLINE rõ ràng).
  - Xóa an toàn: Kiểm tra liên kết với session cũ, yêu cầu xác nhận và cảnh báo; xóa profile chỉ xóa managed assets của profile đó, tuyệt đối không xóa audio đã sinh trong session cũ.
  - Action `Use in TTS`: Trả về Voice Profile được chọn để đặt làm active voice cho TTS.
- **Verification**: `cargo test test_voice_library_safe_delete`.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

---

### MILESTONE 6: UI / UX DESIGN & PROTOTYPING GATE (GATE D PRE-WIRING)

#### [TASK-20] Chuẩn bị Kiến trúc Frontend, IPC Typings & State Stores (Pre-UI Gate)
- **Goal**: Thiết lập hạ tầng TypeScript types đồng bộ với backend IPC, React Context/Zustand state stores cho 6 workspaces, và audio playback service in-memory mà không khóa trước visual styling.
- **Dependencies**: TASK-02, TASK-06, TASK-07, TASK-19.
- **Expected Files**: `src/types/ipc.ts`, `src/stores/ttsStore.ts`, `src/stores/voiceStore.ts`, `src/stores/transcriptionStore.ts`, `src/services/audioPlayer.ts`.
- **Acceptance Criteria**:
  - Định nghĩa 100% typed interfaces cho mọi Tauri IPC commands và events.
  - Xây dựng state stores quản lý dữ liệu: Original vs Working Text, Chunks table, Voice list, Transcription segments, Job progress.
  - Web Audio API player in-memory phát preview audio từ cache byte buffers.
  - Tách bạch hoàn toàn logic trạng thái khỏi CSS/styling để Phase 6 (Stitch UI/UX Gate) tự do thiết kế visual direction.
- **Verification**: `npm run build` (Typecheck passes, zero compilation errors).
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

> [!IMPORTANT]
> **GATE D CHECKPOINT**: Sau Task 20, dự án sẽ kích hoạt **PHASE 6 — UI / UX DESIGN + PROTOTYPE GATE** theo quy định của `AGENT_WORKFLOW.txt`. Sử dụng **Stitch MCP** để thiết kế và hoàn thiện visual direction, component tokens, desktop layout hierarchy và prototype thực tế trước khi bước vào triển khai giao diện chuyên sâu.

---

### MILESTONE 7: DESKTOP STUDIO FRONTEND INTEGRATION & WORKFLOWS

#### [TASK-21] Shell Layout, Top Bar, Collapsible Navigation & Bottom Job Bar
- **Goal**: Hiện thực hóa bộ khung desktop studio chuẩn: Top Utility Bar (Branding, Session name, VN/EN, Theme, Settings), Left Sidebar thu gọn được, và Bottom Job Bar cố định tiến độ.
- **Dependencies**: TASK-20, GATE D (Approved UI Design).
- **Expected Files**: `src/components/layout/Shell.tsx`, `src/components/layout/TopBar.tsx`, `src/components/layout/Sidebar.tsx`, `src/components/layout/BottomJobBar.tsx`.
- **Acceptance Criteria**:
  - Khởi động hiển thị đủ 6 mục điều hướng: TTS, Voice Clone, Voice Library, Transcription, History, Settings.
  - Sidebar hỗ trợ thu gọn/mở rộng mượt mà.
  - Chuyển đổi tức thì giữa ngôn ngữ giao diện VN / EN và giao diện Sáng / Tối.
  - Bottom Job Bar hiển thị model đang chạy, % tiến độ, nút Pause, Cancel, Open Output.
- **Verification**: Runtime verification qua Tauri dev build & Chrome DevTools MCP.
- **Risk**: LOW.
- **User Approval Required**: NO.

#### [TASK-22] Workspace 1: Text to Speech Studio (Text Prep & Hybrid Chunk Studio)
- **Goal**: Hiện thực hóa không gian làm việc TTS thích ứng theo 2 giai đoạn: Text Preparation View (Original vs Working, Normalization, AI diff review) và Chunk Studio View (danh sách thẻ câu, nghe thử, retry, pause override).
- **Dependencies**: TASK-12, TASK-13, TASK-14, TASK-16, TASK-21.
- **Expected Files**: `src/views/tts/TextPrepView.tsx`, `src/views/tts/ChunkStudioView.tsx`, `src/views/tts/ChunkCard.tsx`, `src/components/inspector/TtsInspector.tsx`.
- **Acceptance Criteria**:
  - Giai đoạn 1: Dán text $\rightarrow$ Bấm Chuẩn hóa $\rightarrow$ Bấm AI Punctuation/Optimize hiện Diff view Before/After $\rightarrow$ Accept/Reject/Restore hoạt động chính xác.
  - Bấm Chia chunk $\rightarrow$ Chuyển sang Chunk Studio hiển thị danh sách thẻ câu.
  - Sinh audio $\rightarrow$ Progressive availability (câu nào xong nghe thử được ngay).
  - Sửa text câu nào $\rightarrow$ Câu đó chuyển trạng thái `Modified`, audio cũ bị vô hiệu hóa (Stale Cache Invalidation).
  - Bấm Ghép audio $\rightarrow$ Gọi backend nối file và mở thư mục output.
- **Verification**: E2E workflow test trên giao diện ứng dụng.
- **Risk**: HIGH.
- **User Approval Required**: NO.

#### [TASK-23] Workspace 2 & 3: Voice Clone & Voice Library
- **Goal**: Hiện thực hóa giao diện tạo giọng mẫu (Voice Clone) và quản trị thư viện giọng tái sử dụng (Voice Library) kèm cầu nối `[Use in TTS]`.
- **Dependencies**: TASK-11, TASK-17, TASK-18, TASK-19, TASK-21.
- **Expected Files**: `src/views/clone/VoiceCloneView.tsx`, `src/views/library/VoiceLibraryView.tsx`, `src/views/library/VoiceCard.tsx`.
- **Acceptance Criteria**:
  - Voice Clone: Kéo thả file audio mẫu $\rightarrow$ Chọn model $\rightarrow$ Nhập test text và nghe thử preview $\rightarrow$ Đặt tên, tags và bấm Lưu.
  - Voice Library: Hiển thị danh sách voice, tìm kiếm theo tên, lọc theo tag, lọc theo nguồn (Local / Online).
  - Đổi tên và sửa tags thành công; xóa voice có confirmation dialog và cảnh báo session liên kết.
  - Bấm `[Use in TTS]` $\rightarrow$ Chuyển sang TTS Studio và nạp voice đó làm active voice.
- **Verification**: E2E test quy trình Clone $\rightarrow$ Save $\rightarrow$ Library Filter $\rightarrow$ Use in TTS.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

#### [TASK-24] Workspace 4: Standalone Transcription Studio
- **Goal**: Hiện thực hóa không gian bóc băng âm thanh/video bằng faster-whisper, hiển thị Plain Text và Timestamped Segments, xuất TXT/SRT, và cầu nối `[Chuyển sang TTS]`.
- **Dependencies**: TASK-10, TASK-21.
- **Expected Files**: `src/views/transcription/TranscriptionView.tsx`, `src/components/inspector/TranscriptionInspector.tsx`.
- **Acceptance Criteria**:
  - Nạp file media audio/video $\rightarrow$ Chọn model faster-whisper (hoặc Auto) $\rightarrow$ Bật Auto Detect ngôn ngữ $\rightarrow$ Bóc băng thành công.
  - Hiển thị linh hoạt giữa Plain Text View và Segments View (timestamp chuẩn).
  - Nút xuất file `.txt` và `.srt` hoạt động đúng.
  - Bấm `[Chuyển sang TTS]` $\rightarrow$ Đưa toàn bộ text sang tab TTS làm working text mới; transcript gốc giữ nguyên.
- **Verification**: E2E test bóc băng và xuất file phụ đề.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

#### [TASK-25] Workspace 5 & 6: History & Settings (9 Nhóm chức năng)
- **Goal**: Hiện thực hóa màn hình lịch sử phiên và cài đặt hệ thống toàn diện 9 nhóm, bao gồm giao diện cấu hình đường dẫn, quản lý tải model, và kiểm tra phần cứng.
- **Dependencies**: TASK-01, TASK-02, TASK-03, TASK-08, TASK-15, TASK-21.
- **Expected Files**: `src/views/history/HistoryView.tsx`, `src/views/settings/SettingsView.tsx`, `src/views/settings/sections/*.tsx`.
- **Acceptance Criteria**:
  - History: Liệt kê các session gần đây, mở lại phiên, mở output, xóa lịch sử (không xóa file audio trên đĩa).
  - Settings 9 nhóm:
    - General: Ngôn ngữ, theme, confirmation.
    - TTS & Transcription: Cấu hình mặc định.
    - AI Text & Translation: LM Studio connection, Gemini API key an toàn.
    - Models & Runtime: Cấu hình `TTS Model Path` và `Transcription Model Path`, nút Rescan, danh sách trạng thái và nút Download model còn thiếu.
    - Storage & Cache: Đổi Data Root kích hoạt hộp thoại Safe Migration, nút Clear Cache, Clear History tách bạch.
    - System & Hardware: Bảng chẩn đoán CPU, GPU, VRAM, CUDA, FFmpeg, nút Run System Check.
    - About: Build info, Open Log, Reset Settings an toàn.
- **Verification**: Kiểm tra lưu trữ và khôi phục cài đặt qua restart app.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

---

### MILESTONE 8: SYSTEM HARDENING, RECOVERY & PACKAGING VERIFICATION

#### [TASK-26] Basic Interrupted-Session Recovery & Cache Invalidation Verification
- **Goal**: Hiện thực hóa và kiểm chứng khả năng phục hồi phiên làm việc gián đoạn khi app bị tắt đột ngột hoặc restart.
- **Dependencies**: TASK-02, TASK-07, TASK-22.
- **Expected Files**: `src-tauri/src/session/recovery.rs`.
- **Acceptance Criteria**:
  - Tạo phiên sinh 20 chunks, chạy xong 10 chunks $\rightarrow$ Giả lập tắt app $\rightarrow$ Mở lại app và Reopen session.
  - 10 chunks cũ được phục hồi trạng thái `Ready` và nghe thử được ngay.
  - Bấm tiếp tục sinh chỉ sinh các chunk từ 11 đến 20; ghép audio tạo ra file hoàn chỉnh 20 chunk.
  - Nếu text chunk bị sửa trong phiên, chunk đó chuyển `Modified` và audio cũ bị invalidate.
- **Verification**: Tự động hóa kịch bản test phục hồi phiên gián đoạn (AC-13).
- **Risk**: HIGH.
- **User Approval Required**: NO.

#### [TASK-27] Offline Core Integrity, Zero Telemetry & Network Isolation Verification
- **Goal**: Kiểm chứng hệ thống hoạt động hoàn hảo khi ngắt toàn bộ kết nối mạng internet và đảm bảo 0% telemetry.
- **Dependencies**: TASK-22, TASK-23, TASK-24.
- **Expected Files**: `tests/offline_test.rs`.
- **Acceptance Criteria**:
  - Ngắt kết nối mạng: Toàn bộ quy trình Chuẩn hóa text, Chia chunk, TTS local, Ghép audio, Bóc băng faster-whisper, Dịch qua Local LLM hoạt động 100% bình thường, không có thông báo lỗi mạng.
  - Không có bất kỳ gói tin mạng nào gửi ra internet khi sử dụng các tính năng local.
  - Khi dùng Online Voice hoặc Gemini Translation: Báo lỗi mạng rõ ràng nếu mất mạng, tuyệt đối không tự ý fallback ngầm.
- **Verification**: Automated test ngắt mạng và kiểm tra network sockets (AC-12).
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

#### [TASK-28] Application Update Schema Migration & Packaging Verification
- **Goal**: Kiểm chứng vòng đời nâng cấp phiên bản ứng dụng, đảm bảo toàn bộ dữ liệu người dùng, cấu hình đường dẫn, models và voice profiles được bảo toàn nguyên vẹn.
- **Dependencies**: TASK-02, TASK-03, TASK-25.
- **Expected Files**: `tests/update_migration_test.rs`, `src-tauri/tauri.conf.json`.
- **Acceptance Criteria**:
  - Cài đặt bản N với custom data root, model paths, voice profiles và session $\rightarrow$ Nâng cấp lên bản N+1.
  - Khởi động bản N+1: Bootstrap discovery nhận diện đúng Data Root, migration tuần tự chạy thành công, toàn bộ dữ liệu và model tái sử dụng trực tiếp mà không tải lại (AC-14).
  - Thử nghiệm mở DB mới bằng bản cũ: Báo lỗi không tương thích phiên bản an toàn, không làm hỏng database (Downgrade safety, AC-15).
  - Đóng gói thử nghiệm Windows bundle (`cargo tauri build`) hoàn tất thành công.
- **Verification**: Automated upgrade test & build package verification.
- **Risk**: HIGH.
- **User Approval Required**: NO.

---

## 4. Tóm tắt Kế hoạch (Plan Summary)

* **TOTAL TASKS**: **28 Tasks** (T01 đến T28).
* **MILESTONES**: **8 Milestones** tuần tự và logic.
* **HIGH-RISK TASKS (8 Tasks)**:
  - `TASK-02`: SQLite Schema Versioning & Ordered Migrations.
  - `TASK-03`: Safe Data Root Migration (Rollback & Data Preservation).
  - `TASK-05`: Process Supervisor & Crash Isolation.
  - `TASK-07`: Safe Sequential Job Queue & Bounded Cancel.
  - `TASK-09`: Model Feasibility Spike (Candidate TTS Models on Windows/CUDA).
  - `TASK-11`: Primary TTS Engine Adapter Integration.
  - `TASK-22`: Long-form TTS Studio & Hybrid Chunk Studio Integration.
  - `TASK-26`: Basic Interrupted-Session Recovery.
  - `TASK-28`: Application Update Migration & Packaging Verification.
* **MAJOR ARCHITECTURE DECISIONS**:
  1. *4-Way Path Separation*: Tách rời App Install, Data Root, TTS Model Path, Transcription Model Path, và Output Path.
  2. *LM Studio as External Provider*: VoxLab không quản lý GGUF/LLM files; kết nối qua HTTP OpenAI-compatible endpoint.
  3. *Isolated Process Supervision*: Rust giám sát subprocesses; worker crash không làm sập UI; capability handshake bắt buộc.
  4. *Local-First Core + Explicit Optional Online*: Cốt lõi 100% offline, online voice/translation có cảnh báo và không auto-fallback.
  5. *Safe Sequential Queue*: Concurrency = 1 mặc định để đảm bảo 0% rủi ro OOM trên GPU.
  6. *Decoupled Visual Design*: Chuẩn bị hạ tầng trạng thái và typings ở Task 20 trước khi kích hoạt Phase 6 Stitch UI/UX Gate.
* **BIGGEST RISKS & MITIGATION**:
  - *Rủi ro tương thích Model TTS trên Windows/CUDA*: Giải quyết bằng Task 09 (Model Feasibility Spike độc lập, có benchmark và báo cáo duyệt trước).
  - *Rủi ro mất dữ liệu khi đổi Data Root hoặc Update app*: Giải quyết bằng quy trình Copy $\rightarrow$ Verify $\rightarrow$ Activate, backup database trước khi migrate, và rollback an toàn.
  - *Rủi ro Worker crash hoặc treo máy*: Giải quyết bằng cô lập tiến trình con và cơ chế Bounded Cancel thu hồi tài nguyên sạch sẽ.
* **USER DECISIONS REQUIRED**:
  - **Duyệt GATE C (Implementation Plan)**: Xác nhận cấu trúc 28 tasks và lộ trình 8 milestones để chính thức bước vào triển khai.
  - *(Lưu ý: Sau Task 09 sẽ có báo cáo kết quả Model Feasibility để bạn duyệt chốt model set chính thức; sau Milestone 5 sẽ có Gate D để duyệt visual design trên Stitch).*

---

### DỪNG TẠI GATE C (CHỜ USER DUYỆT)
Kế hoạch triển khai kỹ thuật đã sẵn sàng. Không viết code, không chia nhỏ thêm cho đến khi nhận được phê duyệt chính thức GATE C từ bạn.
