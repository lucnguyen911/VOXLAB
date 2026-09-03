# VoxLab — Project Constraints & Quality Bar

**Last updated**: 2026-09-03 (Phase 0 — Project Constraints)  
**Target Platform**: Windows 10/11 64-bit (x64)  
**Primary Stack**: Tauri v2 (Rust) + React 19 + TypeScript + Vite  

---

## 1. Quality Floor (Always Enforced, Non-Negotiable)

- **Zero Suppression Comments**: No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `# noqa`, `# type: ignore` without an approved documented exception.
- **No Unimplemented Stubs**: No `throw new Error("Not implemented")`, no empty `catch {}` blocks that swallow errors silently.
- **Zero Secrets in Source**: No hard-coded API keys, tokens, or machine-specific absolute paths.
- **No Test / Check Weakening**: Never delete tests, remove assertions, or weaken validation to make builds pass.
- **Verifiable Diffs**: This file (`CONSTRAINTS.md`) cannot be edited down or weakened to bypass a failing check.

---

## 2. Engineering Verification Policy

| Dimension | Rule | Enforced Scope & Mechanism | Frequency / Stage |
| :--- | :--- | :--- | :--- |
| **Types (Frontend)** | Zero type errors (`strict: true`) | `tsc --noEmit` | Targeted during editing; mandatory full check before task DONE |
| **Lint / Formatting** | Zero lint errors from config | Project linter (`npm run lint` / configured linter) | Targeted during editing; mandatory full check before task DONE |
| **Backend (Rust)** | Zero compilation errors; enforced warnings resolved | `cargo check` with warning-enforcement configuration | Targeted during editing; mandatory full check before task DONE |
| **Native Build & Link** | Clean binary compilation and link | `cargo build` | Milestone end, Verify, Ship |
| **Secrets & Credentials** | Zero leaked credentials in diffs | Diff inspection / scanning tool | Every commit |
| **Tests (Frontend & Rust)** | All relevant tests pass; no silent skips | `npm test` & `cargo test` | Task end, Verify, Ship |
| **Process Hygiene** | No orphan subprocesses, clean termination | Process supervisor verification | Runtime test / Verify |

### Verification Frequency Principle
- **During active implementation**: Run lightweight, targeted checks appropriate to the touched files (e.g. single-file type check or targeted unit test).
- **Before marking any task DONE**: Bắt buộc phải chạy đầy đủ các bài kiểm tra liên quan (typecheck, lint, unit tests, build verification).
- **Milestones, Verification, & Release**: Bắt buộc chạy full verification suite theo đúng quy định của `AGENT_WORKFLOW.txt`.

---

## 3. Target Hardware & Platform Policy

- **Application Shell**: Hoạt động ổn định trên Windows 10/11 64-bit (x64).
- **CPU-Only Support**: Máy chỉ có CPU vẫn phải khởi động được ứng dụng shell và sử dụng được các tính năng tương thích (như text normalization, giao diện, hoặc model hỗ trợ chạy CPU).
- **Model Hardware Diversity**:
  - Không giả định mọi AI model đều bắt buộc phải chạy được trên CPU.
  - Từng model có thể yêu cầu phần cứng riêng biệt (ví dụ NVIDIA CUDA, mức VRAM tối thiểu, instruction set cụ thể).
  - Khả dụng của từng model trên UI phải dựa trên kết quả phát hiện phần cứng (hardware detection) và yêu cầu thực tế đã được kiểm chứng qua Model Feasibility Check, không đoán định trước.

---

## 4. Architecture & Boundary Constraints

### 4.1 Frontend / Native Boundary
- **Các giới hạn của React Frontend**:
  - KHÔNG chạy arbitrary shell command.
  - KHÔNG trực tiếp điều khiển Python/C++ model runtime.
  - KHÔNG thực hiện unrestricted native filesystem operations.
- **Quyền hạn được phép của Frontend**:
  - Được phép thực hiện các tác vụ non-privileged / in-memory phục vụ UI/UX mượt mà: audio preview qua Web Audio API, tính toán waveform / visualizer data, tạo temporary Blob / Object URL cho playback, quản lý UI state, xử lý drag/drop file, và chuyển đổi cấu trúc dữ liệu nhẹ trong bộ nhớ.
- **Phạm vi của Native Layer (Tauri / Rust)**:
  - Giữ toàn quyền điều phối tiến trình (process supervision), kiểm tra phần cứng, quản lý hàng đợi, truy xuất hệ thống file an toàn (đã qua sanitize path), và làm cầu nối IPC an toàn.

### 4.2 Model Worker Isolation & IPC
- **Process Isolation**: Model runtimes (Python / faster-whisper / TTS engines) phải chạy tách biệt trong các subprocess/worker riêng do Rust quản lý. Sự cố crash của worker tuyệt đối không được làm sập giao diện ứng dụng desktop (UI window).
- **Documented & Versioned IPC Interface**:
  - Giao tiếp giữa Rust và model worker phải thông qua interface có tài liệu rõ ràng, có versioning và kiểm thử được.
  - Transport cụ thể (ví dụ stdin/stdout JSON-RPC, localhost socket, hay protocol khác) KHÔNG chốt sớm tại Phase 0 mà sẽ được quyết định sau Model Feasibility Check và đánh giá kiến trúc.
- **Worker Capability & Version Handshake**:
  - Mỗi model worker phải có cơ chế bắt tay (handshake) khai báo version và capabilities khi khởi động.
  - Orchestrator không được giả định mọi model đều có chung tính năng. Các capability (voice cloning, reference audio, style/emotion, language support, streaming, cancellation) phải được khai báo hoặc phát hiện rõ ràng.
  - Worker/runtime/protocol version không tương thích phải báo lỗi tường minh (fail explicitly), tuyệt đối không im lặng bỏ qua (silent failure).

### 4.3 Job Cancellation & Crash Recovery
- **Cancellation Path**: Các tác vụ AI tốn thời gian phải hỗ trợ hủy (cancel) khi runtime/model bên dưới về mặt kỹ thuật cho phép (sẽ xác minh trong Model Feasibility).
- **Resource & Process Cleanup**: Khi job bị hủy hoặc worker gặp sự cố:
  - Tuyệt đối không để lại orphan subprocess chạy ngầm.
  - Giải phóng RAM/VRAM ngay lập tức, không để tài nguyên bị chiếm giữ vô hạn.
  - Đóng toàn bộ file handle, không để lại file bị khóa (locked files).
- **State & Artifact Integrity**:
  - Job phải chuyển sang trạng thái kết thúc tường minh (`Cancelled` hoặc `Failed`).
  - Tuyệt đối không biến partial output (audio dở dang) thành file output hoàn chỉnh hợp lệ.
  - Các file tạm/dở dang phải được dọn dẹp sạch sẽ hoặc gắn cờ đánh dấu an toàn.
  - Worker crash phải được cô lập, hiển thị thông báo lỗi rõ ràng lên UI và đưa hệ thống về trạng thái an toàn để người dùng có thể thử lại (Retry).

---

## 5. Storage, Data Persistence & Migration Policy

### 5.1 Storage Scope cho MVP
- **Workflow**: Task/Session-based workflow, tập trung vào xử lý tác vụ trực tiếp.
- **Export**: Xuất file trực tiếp (Direct file export) ra thư mục do người dùng chỉ định (`.wav`, `.mp3`, `.txt`, `.srt`...).
- **State Storage**: Lưu trữ cấu hình ứng dụng (settings) và lịch sử tác vụ gần đây (recent tasks/history) bằng SQLite local hoặc file cấu hình cục bộ gọn nhẹ.
- **Phạm vi loại trừ MVP**: Không yêu cầu xây dựng hệ thống quản lý thư viện dự án phức tạp (Full Studio / Multi-Project Library) trong phạm vi MVP.

### 5.2 File System & Path Portability
- **Non-Destructive**: Tuyệt đối không ghi đè lên file có sẵn của người dùng nếu chưa có xác nhận rõ ràng hoặc cơ chế tự động đánh số phiên bản (`_001.wav`).
- **Path Portability**: Dữ liệu lưu trữ bền vững (persisted data/settings) không được phụ thuộc vào đường dẫn tuyệt đối gắn chết với máy phát triển; sử dụng đường dẫn tương đối hoặc các thư mục chuẩn của OS (Windows AppData / LocalStorage).

### 5.3 Schema Versioning & Migration Safety
- Cấu trúc cơ sở dữ liệu (SQLite schema) và cấu hình persistent settings phải có versioning rõ ràng.
- Việc cập nhật ứng dụng (App update) tuyệt đối không được làm mất mát dữ liệu người dùng một cách âm thầm (silent data loss).
- Migration phải có cơ chế an toàn: nếu migration thất bại, hệ thống phải fail safely và có chiến lược sao lưu/khôi phục (backup/recovery) trước khi thực hiện thao tác có nguy cơ phá hủy.

---

## 6. Privacy, Network & Model Download Safety

### 6.1 Local-First & Privacy Baseline (MVP)
- **100% Local Processing**: Mọi chức năng cốt lõi (TTS, transcription/ASR, text normalization, và text optimization) phải hoạt động hoàn toàn offline trên máy người dùng.
- **Không Cloud Fallback trong MVP**: MVP không tích hợp Cloud API fallback, đảm bảo tính độc lập và bảo mật cục bộ trọn vẹn.
- **Zero Telemetry**: Tuyệt đối không thu thập dữ liệu người dùng, không gửi telemetry hay analytic ra máy chủ bên ngoài.

### 6.2 Model Download & Resource Integrity Safety
- **User-Initiated**: Kết nối mạng chỉ được kích hoạt khi người dùng chủ động yêu cầu (ví dụ: bấm nút tải model hoặc cập nhật tài nguyên).
- **Staging / Partial Download**: Quá trình tải model phải sử dụng file tạm/staging (ví dụ `.download`), chỉ kích hoạt khi đã tải trọn vẹn.
- **Integrity Verification**: Phải kiểm tra toàn vẹn (checksum/hash verification) trước khi chuyển model sang trạng thái active/installed.
- **Failure Resilience**: Nếu quá trình tải bị lỗi, người dùng hủy (cancel), hoặc ổ đĩa đầy (disk-full), hệ thống tuyệt đối không được làm hỏng model hợp lệ đang có sẵn trên máy.
- **No Invalid State**: Tài nguyên chưa tải xong hoặc bị lỗi hash tuyệt đối không được đánh dấu là `Installed` hoặc `Ready`.

---

## 7. Resource Scheduling & Tuning Policy

### 7.1 Scheduling Baseline
- **Safe-by-default**: Ưu tiên cao nhất cho tính ổn định của hệ thống và tránh tràn bộ nhớ (OOM).
- **Development/MVP Concurrency**: Mặc định đặt concurrency = 1 đối với các tác vụ model AI nặng (xếp hàng đợi tuần tự).
- **Không khóa cứng kiến trúc**: Kiến trúc điều phối (orchestrator) không được giả định concurrency luôn luôn bằng 1; phải thiết kế mở để hỗ trợ dynamic/parallel execution khi đủ điều kiện.
- **Điều kiện mở song song**: Chạy song song nhiều model nặng chỉ được kích hoạt sau khi có hardware detection xác nhận đủ RAM/VRAM và đã qua benchmark thực tế chứng minh ổn định.

### 7.2 TUNING REQUIRED Policy
Tuyệt đối không chốt cứng các giá trị tối ưu hóa khi chưa có benchmark thực tế. Các thông số sau bắt buộc phải đánh dấu `TUNING REQUIRED`:
- Kích thước phân đoạn văn bản (Text chunk size & segmentation thresholds).
- Batch size và kích thước buffer âm thanh (Audio buffer size).
- Thời gian chờ giải phóng model khi không sử dụng (Model unload idle timeout — giá trị phát triển ban đầu: ~120s).
- Concurrency limit cho môi trường production.
- Các tham số suy luận riêng của từng model (Inference parameters).

*Lưu ý: Mọi giá trị mặc định trong giai đoạn phát triển chỉ đóng vai trò baseline giúp hệ thống chạy được, không được coi là production requirement.*

---

## 8. Performance Metrics & Ratchet Policy (Provisional)

Các chỉ số dưới đây là quan sát ban đầu trên skeleton phát triển, được đánh dấu là **Provisional (Tạm thời)** và **chưa phải là hard release gate**:

| Chỉ số quan sát | Giá trị sơ bộ (Dev Machine) | Phân loại & Ghi chú |
| :--- | :--- | :--- |
| **Frontend Bundle Size** | ~195 kB (uncompressed) | Chỉ tính các asset client-side trong `dist/`, không tính model/backend |
| **Cold Startup Time** | ~1.0s – 1.5s | Đo thời gian từ lúc bật process shell đến khi UI render lần đầu |
| **Idle RAM (App Shell)** | ~100 MB – 120 MB | Chỉ tính riêng tiến trình Tauri shell + WebView2, **chưa tính model worker** |

### Nguyên tắc thiết lập Ratchet chính thức
- Trước khi chuyển các chỉ số trên thành hard constraint / ratchet, phải xây dựng phương pháp benchmark có thể tái lập (reproducible methodology).
- Phải phân định rành mạch giữa:
  - Bản dựng **Debug** vs **Release**.
  - Trạng thái **App shell idle** vs **Model worker loaded** (kèm RAM/VRAM tương ứng).
  - Định nghĩa chính xác điểm bắt đầu và điểm kết thúc của phép đo startup.
  - Danh sách cụ thể các tiến trình được tính vào tổng dung lượng bộ nhớ.

---

## 9. Exceptions & Waivers

*Hiện tại không có ngoại lệ. Mọi ngoại lệ trong tương lai bắt buộc phải có sự phê duyệt của User, lý do kỹ thuật chính đáng và thời hạn hết hạn (expiry date).*
