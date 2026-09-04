# VoxLab — Implementation Plan & Architecture Specification

**Document Version**: 2.0.0 (Final Plan Consistency Pass)  
**Phase**: Phase 4 — Plan + Task Breakdown (GATE C)  
**Status**: Pending User Approval  
**Source Documents**: [`SPEC.md`](file:///f:/Source%20Code%20Tool/Voxlab/SPEC.md) (v2.4.0, Approved), [`CONSTRAINTS.md`](file:///f:/Source%20Code%20Tool/Voxlab/CONSTRAINTS.md) (Approved)  
**Target Platform**: Windows 10/11 64-bit (x64)  
**Stack**: Tauri v2 (Rust) + React 19 + TypeScript + Vite + Isolated Python/C++ Model Workers  

---

## 1. Plan Overview & Architectural Foundations

Kế hoạch triển khai VoxLab được tổ chức theo phương pháp **Vertical Slicing** và **Thử nghiệm rủi ro kỹ thuật sớm (Early Fail-Fast Track)**. Toàn bộ các ranh giới kỹ thuật tuân thủ nghiêm ngặt theo các nguyên tắc:
1. **Ranh giới 4 loại đường dẫn độc lập**: Tách biệt hoàn toàn giữa App Installation Path (read-only), Configurable App Data Root, Configurable Model Paths (TTS và ASR độc lập), và Output Path.
2. **Early Model Feasibility Track**: Khởi chạy thẩm định thực tế candidate models (TTS, faster-whisper calibration, online providers) song song ngay từ đầu để chốt thông số kỹ thuật và adapter set, không trì hoãn đến cuối.
3. **Local LLM Outside**: VoxLab không tải và không quản lý file GGUF/LLM; LM Studio quản lý toàn bộ runtime, context và VRAM của LLM; VoxLab kết nối qua HTTP client.
4. **Cô lập tiến trình (Process Supervision)**: Rust giám sát worker con; phát hiện lỗi/crash tin cậy trong giới hạn thời gian (bounded error detection); worker crash không làm sập giao diện React.
5. **Điều phối an toàn (Safe Sequential Queue)**: Concurrency = 1 mặc định giúp giảm thiểu tối đa nguy cơ tràn VRAM (OOM) so với xử lý đồng thời.
6. **UI Gate Boundary**: Trước **GATE D (Stitch UI/UX Gate)**, chỉ xây dựng các hợp đồng dữ liệu ổn định (IPC Types, Domain DTOs). Toàn bộ visual components, routing và interaction-specific stores chỉ được hiện thực hóa sau khi visual design được duyệt tại Gate D.

---

## 2. Danh mục Milestones Chiến lược

* **Milestone 1: Foundations, Storage Engine & Session Persistence** (Tasks 01 – 06)
* **Milestone 2: Early Model Feasibility & Calibration Track (Fail-Fast)** (Tasks 07 – 09)
* **Milestone 3: Process Supervisor, Safe Queue & Worker IPC Interface** (Tasks 10 – 13)
* **Milestone 4: Model Discovery, Provisioning & Production Engine Adapters** (Tasks 14 – 18)
* **Milestone 5: Core Media & Text Pipelines** (Tasks 19 – 23)
* **Milestone 6: Voice Profile & Voice Library Engine** (Tasks 24 – 26)
* **Milestone 7: UI Architecture Pre-wiring & GATE D (Stitch UI/UX Gate)** (Task 27 $\rightarrow$ **GATE D**)
* **Milestone 8: Desktop Studio Frontend Implementation (Post-Gate D)** (Tasks 28 – 32)
* **Milestone 9: System Hardening, Recovery & Production Packaging** (Tasks 33 – 35)

---

## 3. Chi tiết Task Breakdown (T01 đến T35)

### MILESTONE 1: FOUNDATIONS, STORAGE ENGINE & SESSION PERSISTENCE

#### [TASK-01] Kiến trúc 4 Loại Đường dẫn & Cơ chế Bootstrap Data Root Discovery
- **Goal**: Quản lý 4 loại đường dẫn độc lập và cơ chế bootstrap lưu vị trí Data Root bền vững.
- **Dependencies**: None.
- **Expected Files**: `src-tauri/src/paths.rs`, `src-tauri/src/bootstrap.rs`.
- **Acceptance Criteria**:
  - Nhận diện đúng thư mục cài đặt app (chỉ đọc).
  - Khởi tạo Data Root mặc định tại Windows user data, cho phép cấu hình sang ổ đĩa khác (ví dụ `D:\VoxLabData`).
  - Ghi nhận vị trí Data Root vào file bootstrap nhẹ tại OS standard location.
  - Khi binary khởi động lại, tự động đọc bootstrap để định vị Data Root; nếu mất dấu, mở giao diện phục hồi *"Locate Existing Data Root"*, không tự tạo thư mục rỗng ngầm.
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
  - Tự động tạo bản recoverable backup (`voxlab.db.bak`) trước khi chạy migration.
  - Rollback an toàn nếu migration lỗi; không xóa backup; báo lỗi nâng cấp tường minh; không tạo DB rỗng thay thế.
  - Downgrade Safety: Bản cũ từ chối mở DB có schema mới hơn mà không làm hỏng file.
- **Verification**: `cargo test test_ordered_migrations_and_rollback`.
- **Risk**: HIGH.
- **User Approval Required**: NO.

#### [TASK-03] Module Safe Data Root Migration (Copy $\rightarrow$ Verify $\rightarrow$ Activate/Rollback)
- **Goal**: Dịch vụ di chuyển toàn bộ dữ liệu ứng dụng (database, sessions, voice library, managed assets) sang vị trí mới khi đổi Data Root.
- **Dependencies**: TASK-01, TASK-02.
- **Expected Files**: `src-tauri/src/storage/migration.rs`.
- **Acceptance Criteria**:
  - Quét kiểm tra dữ liệu hiện có tại Data Root cũ.
  - Sao chép toàn bộ persistent data sang Data Root mới.
  - Kiểm chứng tính toàn vẹn của dữ liệu sau khi sao chép.
  - Kích hoạt Data Root mới chỉ sau khi kiểm chứng thành công 100%; không xóa dữ liệu tại Data Root cũ trước khi kích hoạt thành công.
  - Rollback nếu gặp lỗi (ví dụ đĩa đầy) và tiếp tục sử dụng Data Root cũ.
- **Verification**: `cargo test test_data_root_migration_with_rollback`.
- **Risk**: HIGH.
- **User Approval Required**: NO.

#### [TASK-04] Session, History & Chunk Cache Metadata Persistence Repository
- **Goal**: Xây dựng tầng lưu trữ bền vững cho Session, History và Metadata của từng Chunk (text content hash, audio cache path, voice ID, status, stale flag).
- **Dependencies**: TASK-02.
- **Expected Files**: `src-tauri/src/session/repository.rs`, `src-tauri/src/session/model.rs`.
- **Acceptance Criteria**:
  - Lưu và truy vấn metadata các phiên làm việc và lịch sử tác vụ trong SQLite.
  - Lưu trữ chi tiết từng chunk: index, text content hash, trạng thái (`Pending`, `Generating`, `Ready`, `Failed`, `Modified`), đường dẫn file audio cache.
  - Cập nhật cờ `Stale / Invalid` ngay khi text của chunk bị thay đổi.
  - Cung cấp dữ liệu phục vụ quy trình Reopen/Resume và khôi phục phiên gián đoạn.
- **Verification**: `cargo test test_session_chunk_metadata_persistence`.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

#### [TASK-05] Secure Credential Storage Bridge cho Online Providers
- **Goal**: Tích hợp cơ chế lưu trữ bảo mật cho API keys (Google Gemini API, Online Voice credentials) sử dụng Windows DPAPI / Credential Manager.
- **Dependencies**: None.
- **Expected Files**: `src-tauri/src/security/credentials.rs`.
- **Acceptance Criteria**:
  - Mã hóa và lưu trữ API keys an toàn qua DPAPI hoặc Windows Credential Store.
  - Tuyệt đối không lưu API keys dưới dạng plaintext trong SQLite.
  - Đọc và xóa credential an toàn khi reset settings.
- **Verification**: `cargo test test_credential_dpapi_roundtrip`.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

#### [TASK-06] Logging & Diagnostics Implementation Module
- **Goal**: Xây dựng hệ thống ghi log ứng dụng, log của worker tiến trình con, và gói chẩn đoán hệ thống (Diagnostic Bundle).
- **Dependencies**: TASK-01.
- **Expected Files**: `src-tauri/src/diagnostics/logging.rs`, `src-tauri/src/diagnostics/bundle.rs`.
- **Acceptance Criteria**:
  - Ghi log có cấu trúc (info, warn, error) cho backend và worker vào thư mục `logs/` trong Data Root.
  - Action `Open Log Folder` mở đúng thư mục log qua system file manager.
  - Action `Copy System Information` tổng hợp thông tin phiên bản app, OS, GPU, VRAM, và trạng thái runtime.
- **Verification**: `cargo test test_logging_and_diagnostic_bundle`.
- **Risk**: LOW.
- **User Approval Required**: NO.

---

### MILESTONE 2: EARLY MODEL FEASIBILITY & CALIBRATION TRACK (FAIL-FAST)

#### [TASK-07] Early Model Feasibility Spike: Đánh giá Candidate TTS Models trên Windows/CUDA
- **Goal**: Thẩm định kỹ thuật thực tế 3 candidate models: OmniVoice, Chatterbox Turbo, Qwen TTS trên môi trường phát triển (Windows 11 / CUDA 13.x / RTX 5070 Ti) để chốt Model Set cho MVP.
- **Dependencies**: None (Chạy độc lập/song song như fail-fast spike).
- **Expected Files**: `scripts/feasibility/tts_spike.py`, `docs/MODEL_FEASIBILITY_REPORT.md`.
- **Acceptance Criteria**:
  - Xác minh phiên bản model cụ thể, dependencies, độ tương thích Windows/CUDA, VRAM/RAM yêu cầu.
  - Đo lường khả năng hỗ trợ Tiếng Việt và Tiếng Anh (bao phủ qua Model Set).
  - Kiểm chứng Reference Audio / Voice Cloning: thời lượng audio mẫu yêu cầu (TUNING REQUIRED), độ ổn định clone, cross-language cloning.
  - Đo đạc khả năng kiểm soát biểu cảm/sắc thái (expressive capabilities) và hành vi ngắt/cancel.
  - Đánh giá dung lượng ổ cứng, phạm vi chunk khuyến nghị, và siêu tham số suy luận (inference params).
  - Phân loại rõ từng candidate: `RECOMMENDED FOR MVP`, `RECOMMENDED FOR LATER`, `NOT RECOMMENDED`, `NEEDS TECHNICAL SPIKE`.
  - Xuất báo cáo chi tiết `docs/MODEL_FEASIBILITY_REPORT.md` (không coi RTX 5070 Ti là yêu cầu tối thiểu của bản phát hành).
- **Verification**: Chạy script benchmark và hoàn thành báo cáo thẩm định.
- **Risk**: HIGH.
- **User Approval Required**: YES (Trình User duyệt Model Feasibility Report để chốt Model Set).

#### [TASK-08] faster-whisper Benchmark, Calibration & Auto-Selection Engine
- **Goal**: Thực hiện benchmark thực tế các model `Medium`, `Large V3`, `Large V3 Turbo` trên cả CPU và CUDA để xây dựng thuật toán chọn model `Auto` dựa trên dữ liệu đo lường.
- **Dependencies**: None (Chạy song song).
- **Expected Files**: `scripts/feasibility/whisper_benchmark.py`, `src-tauri/src/workers/whisper_calibration.rs`.
- **Acceptance Criteria**:
  - Đo mức chiếm dụng VRAM/RAM thực tế, tốc độ xử lý trên file audio dài, và hành vi tránh tràn bộ nhớ (OOM).
  - Xây dựng bảng quy tắc lựa chọn cho chế độ `Auto`: tự động chọn kích thước model tối ưu dựa trên phần cứng thực tế và trạng thái model đã cài đặt.
  - Không hardcode các ngưỡng VRAM bằng phỏng đoán lý thuyết.
- **Verification**: `cargo test test_whisper_auto_selection_policy`.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

#### [TASK-09] Online Voice Provider Feasibility & Terms/Legal Evaluation
- **Goal**: Thẩm định kỹ thuật, tính khả dụng của API và Điều khoản dịch vụ đối với các ứng viên Online Voice Provider chính thức (Microsoft, Google).
- **Dependencies**: None.
- **Expected Files**: `docs/ONLINE_VOICE_FEASIBILITY_REPORT.md`.
- **Acceptance Criteria**:
  - Kiểm tra official API availability, authentication, danh sách giọng đọc, ngôn ngữ hỗ trợ, cơ chế synthesis, quotas và rate limits.
  - Đánh giá Điều khoản dịch vụ (ToS), bản quyền và tính hợp pháp khi tích hợp vào ứng dụng desktop.
  - Dứt khoát loại trừ các endpoint không chính thức/lậu (CapCut, Edge-TTS reverse-engineered).
  - Kết luận: Nếu ít nhất 1 provider chính thức đạt chuẩn $\rightarrow$ Đề xuất tích hợp ở Task 18; Nếu không có provider nào đạt $\rightarrow$ Đề xuất đánh dấu tạm hoãn (deferred) theo quy định của SPEC.
- **Verification**: Hoàn thành tài liệu đánh giá pháp lý và kỹ thuật `docs/ONLINE_VOICE_FEASIBILITY_REPORT.md`.
- **Risk**: MEDIUM.
- **User Approval Required**: YES (Trình User duyệt kết quả Online Voice Feasibility).

---

### MILESTONE 3: PROCESS SUPERVISOR, SAFE QUEUE & WORKER IPC INTERFACE

#### [TASK-10] Process Supervisor & Subprocess Lifecycle Manager
- **Goal**: Module Rust quản lý khởi chạy, giám sát sức khỏe, ngắt và dọn dẹp tiến trình con Python/C++ của model workers.
- **Dependencies**: TASK-01.
- **Expected Files**: `src-tauri/src/supervisor/mod.rs`, `src-tauri/src/supervisor/process.rs`.
- **Acceptance Criteria**:
  - Khởi động worker trong môi trường cô lập với mảng đối số tách rời (chống shell injection).
  - Phát hiện lỗi/crash của tiến trình con một cách tin cậy trong thời gian giới hạn (bounded error detection); cửa sổ ứng dụng React hoàn toàn không bị ảnh hưởng.
  - Dọn dẹp sạch sẽ toàn bộ tiến trình con khi thoát app hoặc cancel, không để lại tiến trình mồ côi (no orphan processes).
- **Verification**: `cargo test test_worker_process_crash_isolation`.
- **Risk**: HIGH.
- **User Approval Required**: NO.

#### [TASK-11] Documented IPC Protocol & Capability/Version Handshake
- **Goal**: Định nghĩa giao thức truyền thông điệp có cấu trúc giữa Rust và worker, kèm cơ chế bắt tay phiên bản và năng lực (Capability Handshake).
- **Dependencies**: TASK-10.
- **Expected Files**: `src-tauri/src/ipc/protocol.rs`, `src-tauri/src/ipc/handshake.rs`.
- **Acceptance Criteria**:
  - Giao thức truyền tin cậy (typed messages).
  - Worker bắt buộc gửi bản tin handshake khai báo: phiên bản giao thức, engine name, model name, supported languages, supported capabilities (voice cloning, emotion tags, streaming).
  - Báo lỗi tường minh và từ chối nạp nếu phiên bản không khớp hoặc thiếu năng lực yêu cầu.
- **Verification**: `cargo test test_worker_handshake_compatibility`.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

#### [TASK-12] Safe Sequential Job Queue Orchestrator & Bounded Cancellation
- **Goal**: Hàng đợi xử lý tác vụ tuần tự (Safe Sequential Queue, Concurrency = 1) giúp giảm thiểu tối đa rủi ro OOM trên GPU, có cơ chế Pause và Bounded Cancel.
- **Dependencies**: TASK-10, TASK-11.
- **Expected Files**: `src-tauri/src/queue/mod.rs`, `src-tauri/src/queue/job.rs`.
- **Acceptance Criteria**:
  - Quản lý hàng đợi tuần tự Concurrency = 1.
  - Pause: Ngay lập tức không nạp chunk tiếp theo; chunk đang chạy được hoàn tất hoặc ngắt an toàn.
  - Cancel: Dừng hàng đợi, gửi tín hiệu ngắt tới worker, thu hồi RAM/VRAM sạch sẽ; toàn bộ các chunk đã hoàn thành trước đó được giữ nguyên trạng thái `Ready`.
- **Verification**: `cargo test test_queue_pause_and_bounded_cancel`.
- **Risk**: HIGH.
- **User Approval Required**: NO.

#### [TASK-13] Hardware Diagnostics & Capability Inspection Module
- **Goal**: Thu thập thông tin phần cứng hệ thống (NVIDIA GPU, VRAM tổng/khả dụng, CUDA runtime, CPU, RAM) và FFmpeg readiness.
- **Dependencies**: None.
- **Expected Files**: `src-tauri/src/hardware/mod.rs`, `src-tauri/src/hardware/nvml.rs`, `src-tauri/src/hardware/ffmpeg.rs`.
- **Acceptance Criteria**:
  - Phát hiện chính xác GPU NVIDIA và dung lượng VRAM.
  - Kiểm tra trạng thái sẵn sàng của CUDA runtime và FFmpeg.
  - Cung cấp dữ liệu phần cứng cho thuật toán Auto Whisper và màn hình Settings.
- **Verification**: `cargo test test_hardware_detection`.
- **Risk**: LOW.
- **User Approval Required**: NO.

---

### MILESTONE 4: MODEL DISCOVERY, PROVISIONING & PRODUCTION ENGINE ADAPTERS

#### [TASK-14] Model Discovery, Inspection & Registry Service
- **Goal**: Dịch vụ quét (scan) các thư mục `TTS Model Path` và `Transcription Model Path` đã cấu hình, nhận diện model, kiểm tra tương thích và quản lý trạng thái.
- **Dependencies**: TASK-01.
- **Expected Files**: `src-tauri/src/models/registry.rs`, `src-tauri/src/models/scanner.rs`.
- **Acceptance Criteria**:
  - Quét độc lập 2 thư mục model đã cấu hình.
  - Nhận diện và phân loại trạng thái: `Installed / Valid / Ready`, `Missing`, `Invalid / Incomplete`, `Incompatible`.
  - Tái sử dụng trực tiếp các model tương thích đã có sẵn trên máy; tuyệt đối không sao chép model vào AppData.
  - Hỗ trợ thao tác `Rescan / Refresh Models` để cập nhật khi người dùng copy thêm model thủ công.
  - Đổi Model Path chỉ quét thư mục mới, không tự ý di chuyển hay xóa file ở thư mục cũ.
- **Verification**: `cargo test test_model_discovery_and_registry`.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

#### [TASK-15] Minimal User-Initiated Model Provisioning & Download Service
- **Goal**: Dịch vụ tải model trực tiếp do người dùng chủ động kích hoạt dành riêng cho TTS Models và faster-whisper Models (loại trừ LLM).
- **Dependencies**: TASK-01, TASK-14.
- **Expected Files**: `src-tauri/src/models/downloader.rs`, `src-tauri/src/models/integrity.rs`.
- **Acceptance Criteria**:
  - Tải file model trực tiếp vào `TTS Model Path` hoặc `Transcription Model Path` tương ứng.
  - Sử dụng file tạm staging (`.download`), cập nhật tiến độ (%), hỗ trợ Cancel và Retry.
  - Kiểm tra dung lượng đĩa trống trước khi tải.
  - Kiểm tra tính toàn vẹn: Dùng trusted SHA256 checksum khi nguồn hỗ trợ, hoặc dùng cơ chế xác thực mạnh nhất theo cấu trúc file; chỉ chuyển sang `Ready` sau khi xác thực thành công.
  - Tải lỗi hoặc bị hủy tuyệt đối không tạo ra trạng thái model hợp lệ giả mạo.
- **Verification**: `cargo test test_model_download_lifecycle_and_integrity`.
- **Risk**: HIGH.
- **User Approval Required**: NO.

#### [TASK-16] faster-whisper Production Engine Adapter Integration
- **Goal**: Xây dựng worker adapter cho engine faster-whisper (`Medium`, `Large V3`, `Large V3 Turbo`, `Auto`) hỗ trợ đa ngôn ngữ và Auto Detect.
- **Dependencies**: TASK-08, TASK-10, TASK-11, TASK-14.
- **Expected Files**: `workers/asr/whisper_worker.py`, `src-tauri/src/workers/asr_adapter.rs`.
- **Acceptance Criteria**:
  - Tích hợp model set đã duyệt; áp dụng thuật toán Auto selection từ kết quả Task 08.
  - Bóc băng audio/video, tự động nhận diện ngôn ngữ nguồn (`Auto Detect` metadata trả về đúng).
  - Trích xuất cấu trúc segments có timestamp chuẩn (`Start --> End`), xuất dữ liệu transcript hợp lệ, không rỗng.
- **Verification**: `cargo test test_whisper_adapter_transcription`.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

#### [TASK-17] Approved MVP TTS Model Set Adapter Integration
- **Goal**: Xây dựng worker adapter cho tổ hợp model TTS đã được phê duyệt từ kết quả Task 07 (đáp ứng Tiếng Việt + Tiếng Anh và Voice Cloning).
- **Dependencies**: TASK-07, TASK-10, TASK-11, TASK-14.
- **Expected Files**: `workers/tts/tts_worker.py`, `src-tauri/src/workers/tts_adapter.rs`.
- **Acceptance Criteria**:
  - Hỗ trợ tổ hợp model TTS đã duyệt: bao phủ phát âm hợp lệ cho cả Tiếng Việt và Tiếng Anh (xuất ra file audio hợp lệ, phát được).
  - Hỗ trợ Voice Cloning từ file audio mẫu: tiếp nhận file mẫu, áp dụng các tham số clone được hỗ trợ.
  - Triển khai Capability Handshake tương thích hoàn toàn với Rust supervisor; không xảy ra lỗi crash/corruption.
- **Verification**: `cargo test test_tts_model_set_adapter_generation`.
- **Risk**: HIGH.
- **User Approval Required**: NO.

#### [TASK-18] Official Online Voice Provider Adapter Integration
- **Goal**: Tích hợp adapter cho nhà cung cấp Online Voice chính thức nếu vượt qua thẩm định tại Task 09 (hoặc đánh dấu deferred nếu không đạt).
- **Dependencies**: TASK-05, TASK-09.
- **Expected Files**: `src-tauri/src/voice/online_provider.rs`.
- **Acceptance Criteria**:
  - Nếu Task 09 phê duyệt provider chính thức: Tích hợp API synthesis, quản lý xác thực an toàn qua DPAPI, gắn cờ `ONLINE` cho giọng.
  - Hiển thị thông báo khi gửi text ra ngoài; lỗi mạng không làm ảnh hưởng tới các giọng Local.
  - Nếu không có provider nào đạt: Đánh dấu deferred trong cấu hình, không dùng endpoint lậu thay thế.
- **Verification**: `cargo test test_online_voice_provider_integration`.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

---

### MILESTONE 5: CORE MEDIA & TEXT PIPELINES

#### [TASK-19] Deterministic Text Normalization & Protected Spans Preservation
- **Goal**: Thuật toán chuẩn hóa văn bản tất định không làm thay đổi ngữ nghĩa, bảo vệ 100% các định dạng số, thời gian, URL, email, từ viết tắt.
- **Dependencies**: None.
- **Expected Files**: `src-tauri/src/text/normalization.rs`.
- **Acceptance Criteria**:
  - Chuẩn hóa Unicode NFC dựng sẵn thống nhất đa ngôn ngữ.
  - Tối ưu khoảng trắng thừa, ngắt dòng (tối đa 2 dòng), ngoặc kép `""`, gạch ngang `-`.
  - Chuẩn hóa khoảng cách quanh dấu câu nhưng bảo vệ nguyên vẹn các Protected Spans: số thập phân (`3.14`), giờ (`10:30`), URL (`example.com`), email (`user@email.com`), từ viết tắt (`TP.HCM`), IP (`127.0.0.1`), version (`v2.0`).
- **Verification**: `cargo test test_deterministic_normalization_protected_spans`.
- **Risk**: LOW.
- **User Approval Required**: NO.

#### [TASK-20] Smart Chunking Engine phân tầng theo Model Profile
- **Goal**: Bộ chia phân đoạn câu thông minh theo thứ tự ưu tiên (Đoạn văn $\rightarrow$ Câu hoàn chỉnh $\rightarrow$ Vế câu $\rightarrow$ Fallback an toàn) dựa trên profile model.
- **Dependencies**: TASK-19.
- **Expected Files**: `src-tauri/src/text/chunking.rs`.
- **Acceptance Criteria**:
  - Cắt câu theo phân tầng ưu tiên, không bao giờ cắt ngang Protected Spans.
  - Cấu hình linh hoạt ngưỡng độ dài chunk (min, target, max) theo từng profile model TTS (TUNING REQUIRED).
  - Trả về danh sách chunks có chỉ số thứ tự, nội dung text, và hash xác thực.
- **Verification**: `cargo test test_smart_chunking_hierarchy`.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

#### [TASK-21] Local LLM Client (LM Studio Integration) & AI Text Actions
- **Goal**: Client HTTP kết nối tới LM Studio / OpenAI-compatible endpoint, tự động discover model, thực hiện AI Punctuation có Lexical Guardrail và AI Optimize.
- **Dependencies**: None.
- **Expected Files**: `src-tauri/src/ai/client.rs`, `src-tauri/src/ai/punctuation.rs`, `src-tauri/src/ai/guardrail.rs`.
- **Acceptance Criteria**:
  - Test Connection tới LM Studio URL, kiểm tra các trạng thái kết nối và lấy danh sách model qua API.
  - Prompt AI Punctuation chỉ định rõ chỉ sửa dấu câu.
  - **Lexical Guardrail Validation**: So khớp từ vựng trước và sau; phát hiện và gắn cờ cảnh báo nếu LLM tự ý thêm/bớt/sửa từ vựng.
  - Quản lý Text Revision Semantics: Hỗ trợ `Reject AI Revision` (về Working Text cũ) và `Restore Original` (về 100% Original Source ban đầu).
- **Verification**: `cargo test test_ai_lexical_guardrail`.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

#### [TASK-22] Generic Translation Provider Architecture (Local LLM & Google Gemini API)
- **Goal**: Hệ thống dịch văn bản hỗ trợ 2 providers: Local LLM và Optional Cloud Provider (Google Gemini API) với chính sách Per-Operation Apply Policy.
- **Dependencies**: TASK-05, TASK-21.
- **Expected Files**: `src-tauri/src/translation/mod.rs`, `src-tauri/src/translation/gemini.rs`, `src-tauri/src/translation/local.rs`.
- **Acceptance Criteria**:
  - Giao diện provider generic: dịch từ Source Language sang Target Language.
  - Kết nối Gemini API sử dụng API Key lưu bảo mật qua DPAPI.
  - Cảnh báo rõ ràng việc gửi dữ liệu ra ngoài khi dùng Cloud; không tự ý fallback sang cloud khi local lỗi.
  - Áp dụng Per-Operation Apply Policy: Hỗ trợ `Review before Apply` (mặc định) và `Auto Apply` (vẫn bảo toàn bản gốc).
- **Verification**: `cargo test test_translation_provider_interfaces`.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

#### [TASK-23] Audio Stitching Pipeline & FFmpeg Concat Engine
- **Goal**: Module ghép nối các file chunk audio thành file audio tổng hoàn chỉnh (WAV/MP3) có chèn khoảng lặng tự động (Auto Pause Buffer).
- **Dependencies**: TASK-13.
- **Expected Files**: `src-tauri/src/audio/stitcher.rs`, `src-tauri/src/audio/silence.rs`.
- **Acceptance Criteria**:
  - Nối các file chunk theo đúng thứ tự kịch bản.
  - Tự động chèn khoảng lặng giữa các câu dựa trên cấu trúc (ngắt đoạn dài hơn ngắt câu, mặc định ~400ms TUNING REQUIRED).
  - Hỗ trợ ghi đè khoảng lặng (pause override) riêng từng chunk.
  - Xuất ra file `.wav` hoặc `.mp3` chuẩn.
- **Verification**: `cargo test test_audio_stitching_with_pause`.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

---

### MILESTONE 6: VOICE PROFILE & VOICE LIBRARY ENGINE

#### [TASK-24] Managed Reference Audio Assets Engine
- **Goal**: Cơ chế lưu trữ và quản lý bền vững các file audio mẫu clone trong Data Root (`managed voice assets`).
- **Dependencies**: TASK-01.
- **Expected Files**: `src-tauri/src/voice/assets.rs`.
- **Acceptance Criteria**:
  - Khi lưu Voice Profile, tự động sao chép file audio mẫu vào thư mục dữ liệu quản lý của VoxLab với định danh an toàn.
  - Xác thực tính hợp lệ và thời lượng tối thiểu của file mẫu (TUNING REQUIRED theo model).
  - Khi người dùng xóa file gốc ngoài máy, Voice Profile đã lưu vẫn hoạt động bình thường.
- **Verification**: `cargo test test_managed_reference_assets`.
- **Risk**: LOW.
- **User Approval Required**: NO.

#### [TASK-25] Voice Profile Repository & Stable Identity Management
- **Goal**: Quản trị thực thể Voice Profile trong SQLite với định danh bất biến (Stable ID), metadata tương thích model/ngôn ngữ, và hệ thống tag.
- **Dependencies**: TASK-02, TASK-24.
- **Expected Files**: `src-tauri/src/voice/repository.rs`, `src-tauri/src/voice/profile.rs`.
- **Acceptance Criteria**:
  - Tạo mới Voice Profile với Stable ID duy nhất.
  - Cho phép đổi tên (Rename) và sửa Tags mà không làm thay đổi ID.
  - Các phiên làm việc cũ liên kết với voice qua Stable ID.
  - Lưu trữ metadata tương thích model và ngôn ngữ hỗ trợ.
- **Verification**: `cargo test test_voice_profile_stable_identity`.
- **Risk**: LOW.
- **User Approval Required**: NO.

#### [TASK-26] Voice Library Business Logic & Safe Delete Orchestration
- **Goal**: Các dịch vụ quản lý thư viện giọng: Liệt kê, tìm kiếm theo tên, lọc theo tag, lọc theo nguồn (Local / Online), xóa an toàn có cảnh báo, và cầu nối `[Use in TTS]`.
- **Dependencies**: TASK-18, TASK-25.
- **Expected Files**: `src-tauri/src/voice/library.rs`.
- **Acceptance Criteria**:
  - Tìm kiếm voice theo tên và lọc chính xác theo mảng tags.
  - Phân loại nguồn voice: Local My Voices, Preset Local, và Online Voices (gắn nhãn ONLINE).
  - Xóa an toàn: Kiểm tra liên kết với session cũ, yêu cầu xác nhận và cảnh báo; xóa profile chỉ xóa managed assets của profile đó, tuyệt đối không xóa audio đã sinh trong session cũ.
  - Action `Use in TTS`: Trả về Voice Profile được chọn để đặt làm active voice cho TTS.
- **Verification**: `cargo test test_voice_library_safe_delete`.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

---

### MILESTONE 7: UI ARCHITECTURE PRE-WIRING & GATE D (STITCH UI/UX GATE)

#### [TASK-27] Pre-UI IPC Contracts, Domain DTOs & Typed Interfaces
- **Goal**: Chuẩn bị các hợp đồng giao tiếp IPC TypeScript types đồng bộ với Rust backend, Domain DTOs và command/event signatures mà không khóa trước visual components, routing hay UX layout assumptions.
- **Dependencies**: TASK-02, TASK-04, TASK-06, TASK-14, TASK-26.
- **Expected Files**: `src/types/ipc.ts`, `src/types/domain.ts`.
- **Acceptance Criteria**:
  - Định nghĩa 100% typed interfaces cho toàn bộ Tauri IPC commands và events.
  - Định nghĩa domain DTOs cho Text Chunks, Voice Profiles, Transcription Segments, Model Statuses, và Settings.
  - Hoàn toàn độc lập với styling/CSS, sẵn sàng cho Phase 6 (Stitch UI/UX Gate) thiết kế giao diện tự do và chuẩn mực.
- **Verification**: `npm run build` (TypeScript compiles with zero errors).
- **Risk**: LOW.
- **User Approval Required**: NO.

> [!IMPORTANT]
> **GATE D — UI / UX DESIGN + PROTOTYPE GATE (PHASE 6)**  
> Sau khi hoàn thành Task 27, dự án kích hoạt **PHASE 6** theo quy trình của `AGENT_WORKFLOW.txt`.  
> Sử dụng **Stitch MCP** để khám phá và hoàn thiện visual direction, component conventions, desktop layout hierarchy (Top Bar, 3-column Adaptive Workspace, Bottom Job Bar) và tạo prototype thực tế trước khi tiến hành code giao diện chi tiết ở Milestone 8.

---

### MILESTONE 8: DESKTOP STUDIO FRONTEND IMPLEMENTATION (POST-GATE D)

#### [TASK-28] Shell Layout, Top Bar, Collapsible Navigation & Bottom Job Bar
- **Goal**: Hiện thực hóa bộ khung desktop studio chuẩn theo thiết kế được duyệt tại Gate D: Top Utility Bar (Branding, Session name, VN/EN, Theme, Settings), Left Sidebar thu gọn được, và Bottom Job Bar cố định tiến độ.
- **Dependencies**: TASK-27, GATE D (Approved UI Design).
- **Expected Files**: `src/components/layout/Shell.tsx`, `src/components/layout/TopBar.tsx`, `src/components/layout/Sidebar.tsx`, `src/components/layout/BottomJobBar.tsx`.
- **Acceptance Criteria**:
  - Khởi động hiển thị đủ 6 mục điều hướng: TTS, Voice Clone, Voice Library, Transcription, History, Settings.
  - Sidebar hỗ trợ thu gọn/mở rộng.
  - Chuyển đổi tức thì ngôn ngữ giao diện VN / EN và giao diện Sáng / Tối.
  - Bottom Job Bar hiển thị model đang chạy, % tiến độ, nút Pause, Cancel, Open Output.
- **Verification**: Runtime verification qua Tauri dev build & Chrome DevTools MCP.
- **Risk**: LOW.
- **User Approval Required**: NO.

#### [TASK-29] Workspace 1: Text to Speech Studio (Text Prep & Hybrid Chunk Studio)
- **Goal**: Không gian làm việc TTS thích ứng theo 2 giai đoạn: Text Preparation View (Original vs Working, Normalization, AI diff review) và Chunk Studio View (thẻ câu, progressive availability, retry, pause override).
- **Dependencies**: TASK-17, TASK-19, TASK-20, TASK-21, TASK-23, TASK-28.
- **Expected Files**: `src/views/tts/TextPrepView.tsx`, `src/views/tts/ChunkStudioView.tsx`, `src/views/tts/ChunkCard.tsx`, `src/components/inspector/TtsInspector.tsx`.
- **Acceptance Criteria**:
  - Giai đoạn 1: Dán text $\rightarrow$ Chuẩn hóa $\rightarrow$ AI Punctuation/Optimize hiện Diff Before/After $\rightarrow$ Accept/Reject/Restore hoạt động đúng.
  - Chia chunk $\rightarrow$ Chuyển sang Chunk Studio hiển thị thẻ câu.
  - Sinh audio $\rightarrow$ Progressive availability (câu nào xong nghe thử được ngay).
  - Sửa text câu nào $\rightarrow$ Câu đó chuyển trạng thái `Modified`, audio cũ bị vô hiệu hóa (Stale Cache Invalidation).
  - Bấm Ghép audio $\rightarrow$ Gọi backend nối file và mở thư mục output.
- **Verification**: E2E workflow test trên giao diện ứng dụng.
- **Risk**: HIGH.
- **User Approval Required**: NO.

#### [TASK-30] Workspace 2 & 3: Voice Clone & Voice Library
- **Goal**: Giao diện tạo giọng mẫu (Voice Clone) capability-aware và quản trị thư viện giọng tái sử dụng (Voice Library) kèm cầu nối `[Use in TTS]`.
- **Dependencies**: TASK-17, TASK-24, TASK-25, TASK-26, TASK-28.
- **Expected Files**: `src/views/clone/VoiceCloneView.tsx`, `src/views/library/VoiceLibraryView.tsx`, `src/views/library/VoiceCard.tsx`.
- **Acceptance Criteria**:
  - Voice Clone: Kéo thả file audio mẫu $\rightarrow$ Chọn model $\rightarrow$ Nhập test text và nghe thử preview $\rightarrow$ Đặt tên, tags và bấm Lưu.
  - Voice Library: Danh sách voice, tìm kiếm theo tên, lọc theo tag, lọc theo nguồn (Local / Online).
  - Đổi tên và sửa tags thành công; xóa voice có confirmation dialog và cảnh báo session liên kết.
  - Bấm `[Use in TTS]` $\rightarrow$ Chuyển sang TTS Studio và nạp voice đó làm active voice.
- **Verification**: E2E test quy trình Clone $\rightarrow$ Save $\rightarrow$ Library Filter $\rightarrow$ Use in TTS.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

#### [TASK-31] Workspace 4: Standalone Transcription Studio
- **Goal**: Không gian bóc băng âm thanh/video bằng faster-whisper, hiển thị Plain Text và Timestamped Segments, xuất TXT/SRT, và cầu nối `[Chuyển sang TTS]`.
- **Dependencies**: TASK-16, TASK-28.
- **Expected Files**: `src/views/transcription/TranscriptionView.tsx`, `src/components/inspector/TranscriptionInspector.tsx`.
- **Acceptance Criteria**:
  - Nạp file media audio/video $\rightarrow$ Chọn model faster-whisper (hoặc Auto) $\rightarrow$ Bật Auto Detect ngôn ngữ $\rightarrow$ Bóc băng thành công.
  - Hiển thị linh hoạt giữa Plain Text View và Segments View (timestamp chuẩn).
  - Nút xuất file `.txt` và `.srt` hoạt động đúng.
  - Bấm `[Chuyển sang TTS]` $\rightarrow$ Đưa toàn bộ text sang tab TTS làm working text mới; transcript gốc giữ nguyên.
- **Verification**: E2E test bóc băng và xuất file phụ đề.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

#### [TASK-32] Workspace 5 & 6: History & Settings (9 Nhóm chức năng)
- **Goal**: Màn hình lịch sử phiên và cài đặt hệ thống toàn diện 9 nhóm, bao gồm giao diện cấu hình đường dẫn, quản lý tải model, và kiểm tra phần cứng.
- **Dependencies**: TASK-01, TASK-02, TASK-03, TASK-06, TASK-13, TASK-14, TASK-15, TASK-22, TASK-28.
- **Expected Files**: `src/views/history/HistoryView.tsx`, `src/views/settings/SettingsView.tsx`, `src/views/settings/sections/*.tsx`.
- **Acceptance Criteria**:
  - History: Liệt kê các session gần đây, mở lại phiên, mở output, xóa lịch sử (không xóa file audio trên đĩa).
  - Settings 9 nhóm: General, TTS, AI Text, Translation, Transcription, Models & Runtime (TTS/ASR paths, Rescan, Download), Storage & Cache (Data Root migration UI, Clear Cache/History), System & Hardware, About & Diagnostics.
- **Verification**: Kiểm tra lưu trữ và khôi phục cài đặt qua restart app.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

---

### MILESTONE 9: SYSTEM HARDENING, RECOVERY & PRODUCTION PACKAGING

#### [TASK-33] Basic Interrupted-Session Recovery & Cache Invalidation Verification (E2E)
- **Goal**: Kiểm chứng toàn diện khả năng phục hồi phiên làm việc gián đoạn khi app bị tắt đột ngột hoặc crash dựa trên repository metadata đã xây dựng tại Task 04.
- **Dependencies**: TASK-04, TASK-12, TASK-29.
- **Expected Files**: `src-tauri/src/session/recovery.rs`, `tests/recovery_e2e_test.rs`.
- **Acceptance Criteria**:
  - Tạo phiên sinh 20 chunks, chạy xong 10 chunks $\rightarrow$ Giả lập tắt app $\rightarrow$ Mở lại app và Reopen session.
  - 10 chunks cũ được phục hồi trạng thái `Ready` và nghe thử được ngay lập tức.
  - Bấm tiếp tục sinh chỉ sinh các chunk từ 11 đến 20; ghép audio tạo ra file hoàn chỉnh 20 chunk (AC-13).
  - Nếu text chunk bị sửa, chunk đó chuyển `Modified` và audio cũ bị invalidate (AC-04).
- **Verification**: Kịch bản automated test phục hồi phiên gián đoạn.
- **Risk**: HIGH.
- **User Approval Required**: NO.

#### [TASK-34] Offline Core Integrity, Zero Telemetry & Network Isolation Verification
- **Goal**: Kiểm chứng hệ thống hoạt động hoàn hảo khi ngắt toàn bộ kết nối mạng internet và đảm bảo 0% telemetry.
- **Dependencies**: TASK-29, TASK-30, TASK-31.
- **Expected Files**: `tests/offline_test.rs`.
- **Acceptance Criteria**:
  - Ngắt kết nối mạng: Toàn bộ quy trình Chuẩn hóa text, Chia chunk, TTS local, Ghép audio, Bóc băng faster-whisper, Dịch qua Local LLM hoạt động 100% bình thường, không có thông báo lỗi mạng (AC-12).
  - Không có bất kỳ gói tin mạng nào gửi ra internet khi sử dụng các tính năng local.
  - Khi dùng Online Voice hoặc Gemini Translation: Báo lỗi mạng rõ ràng nếu mất mạng, tuyệt đối không tự ý fallback ngầm.
- **Verification**: Automated test ngắt mạng và kiểm tra network sockets.
- **Risk**: MEDIUM.
- **User Approval Required**: NO.

#### [TASK-35] Production Packaging, Upgrade Migration & Downgrade Safety Verification
- **Goal**: Kiểm chứng toàn diện quy trình đóng gói sản phẩm (`cargo tauri build`), vòng đời cài đặt sạch, nâng cấp phiên bản N $\rightarrow$ N+1 bảo toàn dữ liệu, và an toàn hạ cấp.
- **Dependencies**: TASK-02, TASK-03, TASK-04, TASK-14, TASK-32.
- **Expected Files**: `tests/lifecycle_package_test.rs`, `src-tauri/tauri.conf.json`.
- **Acceptance Criteria**:
  - Đóng gói installer Windows hoàn tất thành công.
  - Kiểm tra Clean Install, First Launch, Restart, khởi động worker và kiểm tra tính sẵn sàng của FFmpeg.
  - Nâng cấp N $\rightarrow$ N+1: Data Root được định vị chính xác, database migration tự động chạy thành công, Voice Profiles, History, settings, model paths và output files được bảo toàn nguyên vẹn 100% (AC-14).
  - Thử nghiệm mở DB mới bằng bản cũ: Báo lỗi không tương thích phiên bản an toàn, không làm hỏng database (Downgrade safety, AC-15).
  - Gỡ cài đặt hoặc update app không âm thầm xóa dữ liệu người dùng.
- **Verification**: Automated full lifecycle test & build package verification.
- **Risk**: HIGH.
- **User Approval Required**: NO.

---

## 4. Tóm tắt Kế hoạch (Plan Summary)

* **PLAN VERSION**: **2.0.0**
* **TOTAL TASKS**: **35 Tasks** (Từ `TASK-01` đến `TASK-35`).
* **MILESTONES**: **9 Milestones** chiến lược.
* **HIGH-RISK TASKS (10 Tasks — Danh sách và Số lượng khớp 100%)**:
  1. `TASK-02`: SQLite Storage Engine với Versioned Schema & Ordered Migrations
  2. `TASK-03`: Module Safe Data Root Migration (Copy $\rightarrow$ Verify $\rightarrow$ Activate/Rollback)
  3. `TASK-07`: Early Model Feasibility Spike: Đánh giá Candidate TTS Models trên Windows/CUDA
  4. `TASK-10`: Process Supervisor & Subprocess Lifecycle Manager (Crash Isolation)
  5. `TASK-12`: Safe Sequential Job Queue Orchestrator & Bounded Cancellation
  6. `TASK-15`: Minimal User-Initiated Model Provisioning & Download Service
  7. `TASK-17`: Approved MVP TTS Model Set Adapter Integration
  8. `TASK-29`: Workspace 1: Text to Speech Studio (Text Prep & Hybrid Chunk Studio)
  9. `TASK-33`: Basic Interrupted-Session Recovery & Cache Invalidation Verification (E2E)
  10. `TASK-35`: Production Packaging, Upgrade Migration & Downgrade Safety Verification
* **USER APPROVAL CHECKPOINTS**:
  - **GATE C**: Phê duyệt Implementation Plan này (hiện tại).
  - **CHECKPOINT 1 (Sau Task 07)**: Phê duyệt Báo cáo Thẩm định Model Feasibility (TTS Candidate Models).
  - **CHECKPOINT 2 (Sau Task 09)**: Phê duyệt Báo cáo Thẩm định Online Voice Provider (nếu có provider chính thức đạt chuẩn).
  - **GATE D (Sau Task 27)**: Phê duyệt Phase 6 — UI / UX Design Gate với Stitch.
  - **GATE F**: Phê duyệt Final Release trước khi xuất xưởng.
* **GATE D POSITION**: Nằm ngay sau `TASK-27` (hoàn tất các hợp đồng IPC và Domain DTOs) và trước `TASK-28` (bắt đầu triển khai giao diện frontend chi tiết).

---

## 5. SPEC Coverage Matrix (Bảng Ánh xạ 15 Tiêu chí Nghiệm thu của SPEC)

| Tiêu chí Nghiệm thu SPEC | Mô tả ngắn gọn | Implementation Task(s) | Verification Task(s) |
| :--- | :--- | :--- | :--- |
| **AC-01** | Navigation & Shell Layout (6 tabs, thu gọn, VN/EN, Theme) | TASK-27, TASK-28 | TASK-28, TASK-35 |
| **AC-02** | Chuẩn hóa tất định & Bảo vệ Protected Spans (`3.14`, URL...) | TASK-19 | TASK-19, TASK-29 |
| **AC-03** | AI Text Assistance, Lexical Guardrail & Revision Semantics | TASK-21 | TASK-21, TASK-29 |
| **AC-04** | Smart Chunking & Invalidation Cache khi sửa text câu | TASK-04, TASK-20 | TASK-20, TASK-29, TASK-33 |
| **AC-05** | TTS Generation (VI + EN playable) & Bounded Cancellation | TASK-12, TASK-17 | TASK-17, TASK-29, TASK-34 |
| **AC-06** | Voice Clone Multilingual & Quản lý Reference Assets | TASK-07, TASK-17, TASK-24, TASK-25 | TASK-17, TASK-30 |
| **AC-07** | Voice Library, Online Voices (gắn nhãn) & "Use in TTS" | TASK-09, TASK-18, TASK-26 | TASK-18, TASK-26, TASK-30 |
| **AC-08** | Standalone Transcription với faster-whisper & Auto Detect | TASK-08, TASK-16 | TASK-16, TASK-31 |
| **AC-09** | Model Discovery, Rescan & User-Initiated Download có Staging | TASK-14, TASK-15 | TASK-14, TASK-15, TASK-32 |
| **AC-10** | Translation Providers (Local/Cloud) & Per-Operation Policy | TASK-05, TASK-22 | TASK-22, TASK-29 |
| **AC-11** | Configurable Data Root, Safe Migration & Data Separation | TASK-01, TASK-03 | TASK-03, TASK-32 |
| **AC-12** | Offline Core Integrity (100% offline) & Zero Telemetry | TASK-10, TASK-14, TASK-17, TASK-21 | TASK-34 |
| **AC-13** | Basic Interrupted-Session Recovery (MVP Target) | TASK-04, TASK-12, TASK-26 | TASK-33 |
| **AC-14** | Application Update & Persistent Data Preservation ($N \rightarrow N+1$) | TASK-01, TASK-02, TASK-04, TASK-14 | TASK-35 |
| **AC-15** | Migration Failure Rollback, Cache Invalidate & Downgrade Safety | TASK-02, TASK-04, TASK-14 | TASK-35 |

---

### DỪNG TẠI GATE C (CHỜ USER DUYỆT)
Kế hoạch triển khai kỹ thuật v2.0.0 đã hoàn thiện toàn diện, không còn bất kỳ điểm thiếu sót nào. Không viết code cho đến khi nhận được phê duyệt chính thức GATE C từ bạn!
