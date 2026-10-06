# VoxLab — Danh Sách Công Việc Triển Khai Tab "Hàng Loạt" (TODO.md)

**Tính năng**: Tab Điều Phối Xử Lý Hàng Loạt Hướng Tệp Tin (File-Centric Multi-Task Batch Orchestrator)
**Tài liệu đặc tả**: [`SPEC-batch.md`](file:///f:/Source%20Code%20Tool/Voxlab/SPEC-batch.md) (v3.2.0 Approved Gate D) · [`SPEC-settings.md`](file:///f:/Source%20Code%20Tool/Voxlab/SPEC-settings.md) (v1.2.0 Approved Gate D) · [`tasks/plan.md`](file:///f:/Source%20Code%20Tool/Voxlab/tasks/plan.md) (v3.2.0 File-Centric Architecture)
**CURRENT PHASE**: Phase 7 — Build Auto
**CURRENT GATE**: Gate D Final Approved
**NEXT PHASE**: Phase 8 — Test & Verification
**BUILD AUTO**: IN PROGRESS (Milestone 1 — TASK-01)
**Tổng số tasks**: 17 tasks (TASK-01 đến TASK-16 gồm TASK-05B, toàn bộ nằm trong Phase 7: Build Auto sau khi Gate D Final được duyệt)

---

## Trình Tự Thực Hiện Vòng Đời (Workflow Lifecycle Invariant)

1. **Phase 5 & 6 (GATE D APPROVED)**: Đã hoàn tất phê duyệt SPEC Delta v3.2.0, SPEC-settings v1.2.0 và UI/UX Prototype tại Gate D.
2. **Gate D Final Sign-off Review**: Cập nhật SPEC, Plan và TODO đồng bộ đầy đủ các thay đổi được duyệt (4 Khung Nhìn Thống Nhất, Row Scope Selection, Priority Arrow Queue Reorder, Snapshot Freeze Timing, 3-Way Dynamic CTA, Chuyển đổi định dạng âm thanh thực sự & Tái sử dụng Subtitle Parser/Exporter, Read-Only Preview, Sub-toolbar Staging Scope, Footer Status Bar Shared BatchFooter h-[39px], License Security Architecture & Real Validation, AC-01 đến AC-44, LICENSE-AC-01 đến LICENSE-AC-14) $\rightarrow$ **DỪNG ĐỂ DUYỆT GATE D FINAL TRƯỚC KHI BUILD**.
3. **Phase 7 (BUILD AUTO — TASK-01 đến TASK-16)**: **LOCKED — BẮT ĐẦU NGAY KHI GATE D FINAL ĐƯỢC PRODUCT OWNER PHÊ DUYỆT**. Triển khai tự động theo 6 Milestone, kiểm thử từng bước. Tuyệt đối không viết mã backend trước khi được duyệt.
4. **Phase 8 (TEST & VERIFICATION)**: Kiểm thử tự động đa tầng, Runtime Soak Benchmark, Thực nghiệm đo đạc tham số Tuning, và kiểm chứng visual qua Chrome DevTools MCP.

---

## Milestone 1: Hợp Đồng Dữ Liệu, Tương Thích & Bộ Phân Giải Phụ Thuộc (Phase 7 Build Auto)
- [x] **TASK-01**: Định nghĩa Domain Types, Step-Level & Job-Level State Models cho Batch Processing v3.2 (`src/types/batch.ts`, `src/types/ui.ts`) (RỦI RO: THẤP)
  - Phụ thuộc: **GATE D UI/UX Approved**.
  - Trạng thái: **HOÀN THÀNH (COMPLETE)**.
  - Tiêu chí: Đầy đủ 5 task types (`tts`, `dialogue`, `transcription`, `translation`, `dubbing`), 8 step states (`waiting`, `processing`, `completed`, `completed_with_warning`, `failed`, `skipped`, `cancelled`, `interrupted`), 9 job states (`waiting`, `processing`, `paused`, `completed`, `completed_with_warning`, `failed_with_artifact`, `failed`, `cancelled`, `interrupted`), 6 queue states (`idle`, `running`, `pausing`, `paused`, `cancelling`, `blocked`), 4 view tabs (`list`, `queued`, `completed`, `failed`), `BatchJobStage` (`staging`, `queued`), `queueOrder: number` (thứ tự ưu tiên nguyên dương, điều chỉnh qua nút `↑` / `↓`), `BatchDynamicCtaType` (`retry`, `regenerate`, `reexport`), `ConfigDiffResult`, Snapshot types cho 5 tác vụ + Output settings, artifact fingerprints, cờ `stale`, schema durable v3, `WorkspaceId: "batch"`.
  - Bao phủ: `AC-01`, `AC-02`, `AC-03`, `AC-04`, `AC-19`, `AC-21`, `AC-22`, `AC-25`, `AC-26`.
  - Kiểm tra: `npx tsc --noEmit` pass 0 lỗi.
  - Duyệt người dùng: KHÔNG (đã duyệt Gate D).

- [x] **TASK-02**: Triển khai Bộ Nhận Diện Tương Thích Định Dạng & Thẩm Định Hợp Đồng Phân Vai Hội Thoại (`src/services/batch/compatibilityDetector.ts`, `src/services/batch/dialogueValidator.ts`, `src/services/batch/__tests__/compatibility.test.ts`) (RỦI RO: THẤP)
  - Phụ thuộc: `TASK-01`.
  - Trạng thái: **HOÀN THÀNH (COMPLETE)**.
  - Tiêu chí: Nhận diện chính xác loại tệp (`text`, `media`, `subtitle`). Áp dụng ma trận tương thích cho từng cột (Media cấm TTS/Hội thoại; Text cấm Phụ đề; Subtitle cấm Phụ đề/TTS). Thẩm định nhanh file text bằng `DIALOGUE_LINE_REGEX`: chỉ cho phép bật Hội thoại nếu có cấu trúc phân vai `[Tên]:`. Áp dụng quy tắc loại trừ lẫn nhau (Mutually Exclusive) giữa TTS và Hội thoại trên cùng file text.
  - Bao phủ: `AC-02`, `AC-03`, `AC-04`, `AC-06`.
  - Kiểm tra: Unit tests `src/services/batch/__tests__/compatibility.test.ts` pass 100%.
  - Duyệt người dùng: KHÔNG.

- [x] **TASK-03**: Xây dựng Bộ Phân Giải Phụ Thuộc Tác Vụ & Trình Tự Thực Thi Tuyến Tính (`src/services/batch/dependencyResolver.ts`, `src/services/batch/__tests__/dependencyResolver.test.ts`) (RỦI RO: TRUNG BÌNH)
  - Phụ thuộc: `TASK-01`, `TASK-02`.
  - Trạng thái: **HOÀN THÀNH (COMPLETE)**.
  - Tiêu chí: Tự động kích hoạt tác vụ tiền đề (Auto-Enable Prerequisites): bật Dịch trên Media tự động bật Phụ đề kèm thông báo; bật Lồng tiếng trên Media tự động bật Phụ đề (và Dịch nếu khác ngôn ngữ). Tính toán `executionSequence` tuyến tính tối ưu. Hỗ trợ trường hợp `sourceLanguage === "auto"`: nếu ASR trả về ngôn ngữ trùng `targetLanguage`, cho phép chuyển Translation sang `skipped` với `skipReason` cụ thể và Dubbing tiêu thụ thẳng phụ đề nguồn. Hỗ trợ phụ đề sinh từ văn bản (Text $\rightarrow$ Subtitle) dựa trên thời lượng audio thực tế `durationSec` + ngắt câu.
  - Bao phủ: `AC-05`, `AC-07`, `AC-08`, `AC-44`.
  - Kiểm tra: Unit tests `src/services/batch/__tests__/dependencyResolver.test.ts` pass 100%.
  - Duyệt người dùng: KHÔNG.

---

## Milestone 2: Cấu Hình Bất Biến, Lưu Trữ Bền Vững v3 & Output Resolver (Phase 7 Build Auto)
- [x] **TASK-04**: Snapshot Resolver, Scope Isolation & Config Diff Derivation (`src/services/batch/configSnapshotResolver.ts`, `src/services/batch/configDiffResolver.ts`, `src/services/batch/__tests__/configSnapshot.test.ts`, `src/services/batch/__tests__/configDiff.test.ts`) (RỦI RO: TRUNG BÌNH)
  - Phụ thuộc: `TASK-01`.
  - Trạng thái: **HOÀN THÀNH (COMPLETE)**.
  - Tiêu chí: Hợp nhất $\text{EffectiveConfig} = \text{GlobalDefaults} \oplus \text{PerFileOverrides}$. Đóng băng snapshot Lazy: chỉ freeze ngay trước khi `waiting -> processing` (chuyển sang hàng đợi KHÔNG freeze snapshot). Scope Isolation: Global Defaults chỉ áp dụng cho tệp được chọn (`selectedJobIds`), tệp lỗi unselected không bị ảnh hưởng. Derived Diff (`computeJobConfigDiff`): so sánh normalized JSON không chứa UI-only fields, phân định AI changes vs Output changes. Khôi phục cấu hình trùng snapshot cũ tự động hoàn nguyên về Retry. Zero Secrets trong snapshot.
  - Bao phủ: `AC-14`, `AC-15`, `AC-16`, `AC-26`.
  - Kiểm tra: Unit tests `src/services/batch/__tests__/configSnapshot.test.ts` && `src/services/batch/__tests__/configDiff.test.ts` pass 100%.
  - Duyệt người dùng: KHÔNG.

- [x] **TASK-05**: Durable State Storage v3, Early Tauri FS Atomic Persistence & Crash Normalizer (`src-tauri/src/lib.rs`, `src/services/storage/tauriFsBridge.ts`, `src/services/batch/batchStorage.ts`, `src/services/batch/__tests__/batchStorage.test.ts`) (RỦI RO: CAO - ƯU TIÊN SỚM)
  - Phụ thuộc: `TASK-01`.
  - Trạng thái: **HOÀN THÀNH (COMPLETE)**.
  - Tiêu chí: **Triển khai sớm cầu nối Tauri IPC chuẩn `std::fs` ghi nguyên tử qua file `.tmp` rồi rename trước khi xây dựng tầng durable queue `batchStorage.ts`**. Lưu trữ đầy đủ `stage` (`staging` vs `queued`), `queueOrder`, `selectedTasks`, snapshots, results vào `batch_queue_v3.json`. Zero Audio Binary (cấm serialize PCM/base64). Crash Recovery Normalizer: đưa `running`/`pausing`/`cancelling` về `paused`, đưa job và step đang chạy dở về `interrupted`, reset cờ transient `isCancelling`, bảo toàn committed artifacts.
  - Bao phủ: `AC-09`, `AC-10`, `AC-11`, `AC-24`, `AC-25`.
  - Kiểm tra: Unit tests `src/services/batch/__tests__/batchStorage.test.ts` pass 100%.
  - Duyệt người dùng: KHÔNG.

- [x] **TASK-05B**: License Security Service via Rust HWID, Supabase RPC & DPAPI (`src-tauri/src/security/`, `src/services/license/licenseService.ts`, `src/services/license/__tests__/licenseService.test.ts`) (RỦI RO: CAO)
  - Phụ thuộc: `TASK-01`, `TASK-05`.
  - Trạng thái: **CODE HOÀN THÀNH — E2E CHƯA XÁC MINH (Phase 8 Test, 2026-10-06)**. DPAPI encrypt/decrypt + HWID đã chạy thật trên Windows (`cargo test` 6/6). `DEFAULT_SUPABASE_URL`/`ANON_KEY` trong `license_client.rs` là placeholder, chưa có project Supabase + RPC `activate_or_verify_license` thật → activation/expired/disabled/device-mismatch chưa thể verify E2E.
  - Tiêu chí: Sinh HWID v1 ổn định từ một stable Windows anchor: ưu tiên SMBIOS UUID; fallback sang MachineGuid nếu UUID không khả dụng (không combine cả hai thành composite); anchor được normalize, namespace và SHA-256 hash theo version. Client gọi Supabase RPC `activate_or_verify_license` với anon_key, tuyệt đối không truy cập trực tiếp bảng DB, không có service-role key trong client. Lưu trữ cache mã hóa an toàn bằng Windows DPAPI (`CryptProtectData`), ghi nguyên tử qua `.tmp -> rename`; cho phép Rust backend giải mã raw key phục vụ startup online re-verification. Domain status enum (`VALID`, `ACTIVATED`, `EXPIRED`, `DISABLED`, `NOT_FOUND`, `DEVICE_MISMATCH`, `DEVICE_LIMIT`, `NETWORK_ERROR`, `SERVER_ERROR`, `NO_KEY`, `OFFLINE_GRACE`). Cơ chế Offline Grace có kiểm soát (`OFFLINE_GRACE_DAYS = TUNING REQUIRED`, baseline phát triển tạm thời 7 ngày [PROVISIONAL / NOT PRODUCT-FROZEN], chỉ khi lỗi mạng tạm thời, không cấp khi server từ chối xác định). Frontend TypeScript chỉ nhận `LicenseSummary` (masked key, status, licenseType, expiresAtFormatted), không lưu full key trong `localStorage` hay React state lâu dài.
  - Bao phủ: `AC-SET-03`, `LICENSE-AC-01` đến `LICENSE-AC-14`.
  - Kiểm tra: Rust tests (6/6 pass) && `npx tsx --test src/services/license/__tests__/licenseService.test.ts` (8/8 pass).
  - Duyệt người dùng: KHÔNG.

- [x] **TASK-06**: Output Resolver, Artifact Fingerprinting, Real Transcoder & Subtitle Parser/Exporter Reuse (`src/services/batch/outputResolver.ts`, `src/services/batch/audioTranscoder.ts`, `src/services/batch/credentialResolver.ts`, `src/services/batch/__tests__/outputResolver.test.ts`, `src/services/batch/__tests__/transcoderAndConverter.test.ts`) (RỦI RO: TRUNG BÌNH)
  - Phụ thuộc: `TASK-01`.
  - Trạng thái: **HOÀN THÀNH (COMPLETE)**.
  - Tiêu chí: $\text{External Modification Protection} > \text{Global Collision Policy}$. Kiểm tra `artifactFingerprints` (size + mtime), nếu tệp đích bị sửa ngoài app thì tự động fallback sang `auto_rename` (`_001.ext`) thay vì ghi đè. Dubbing Granular Skip: khi `collisionPolicy = "skip"`, nếu `.srt` đã có mà `.wav` chưa có thì bỏ qua xuất `.srt` và tiếp tục tạo Master `.wav`. Bảo toàn artifact đã commit khi rerun/mutation (đánh dấu `stale`, output mới qua Resolver). **Chuyển mã âm thanh thực sự (WAV $\leftrightarrow$ MP3) và Tái sử dụng trực tiếp `src/services/subtitle/parser.ts` & `exporter.ts` khi Xuất lại, tuyệt đối không tạo mới module `subtitleConverter.ts`**. `CredentialResolver`: nạp API key an toàn lúc runtime.
  - Bao phủ: `AC-13`, `AC-17`, `AC-18`, `AC-30`.
  - Kiểm tra: Unit tests `src/services/batch/__tests__/outputResolver.test.ts` (13/13 pass) && `src/services/batch/__tests__/transcoderAndConverter.test.ts` (8/8 pass) pass 100%.
  - Duyệt người dùng: KHÔNG.

---

## Milestone 3: Step Executors — Tái Sử Dụng 100% Domain Services (Phase 7 Build Auto)
- [ ] **TASK-07**: Triển khai Bước Thực Thi TTS Đơn Giọng & Kịch Bản Phân Vai Hội Thoại (`src/services/batch/executors/ttsExecutor.ts`, `src/services/batch/executors/dialogueExecutor.ts`, `src/services/batch/__tests__/ttsAndDialogueExecutors.test.ts`) (RỦI RO: TRUNG BÌNH)
  - Phụ thuộc: `TASK-01`, `TASK-04`, `TASK-06`.
  - Trạng thái: **MỞ LẠI — STOP GATE E (license, 2026-10-06)**. Adapter OmniVoice (`sidecar/voxlab_sidecar/tts_engine.py`) đã viết nhưng CHƯA tải weights: model card `k2-fsa/OmniVoice` ghi pre-trained model **CC-BY-NC** (phi thương mại, do dữ liệu Emilia); audio tokenizer theo Boson Higgs Audio 2 Community License (giới hạn 100k AAU + attribution). Xung đột với VoxLab thương mại (license key). Chờ Product Owner quyết định engine/license.
  - Tiêu chí: `TtsExecutor`: tái sử dụng `scriptLoader.ts`, `normalizer/engine.ts`, `pause/chunker.ts`, TTS providers, `masterExport.ts`. Hỗ trợ tạm dừng/hủy ở cấp chunk. `DialogueExecutor`: tái sử dụng `dialogue/parser.ts`, `masterAssembly.ts`, `srtExporter.ts`. Xuất Master WAV và file phụ đề `.srt` phân vai. Đăng ký artifact xuất vào `BatchStepResult`.
  - Bao phủ: `AC-03`, `AC-04`, `AC-19`.
  - Kiểm tra: Unit tests `src/services/batch/__tests__/ttsAndDialogueExecutors.test.ts` (7/7 pass) pass 100%.
  - Duyệt người dùng: KHÔNG.

- [ ] **TASK-08**: Triển khai Bước Thực Thi Bóc Băng Phụ Đề ASR với Ngữ Nghĩa Hủy Nguyên Khối An Toàn (`src/services/batch/executors/transcriptionExecutor.ts`, `src/services/batch/__tests__/transcriptionExecutor.test.ts`) (RỦI RO: CAO)
  - Phụ thuộc: `TASK-01`, `TASK-04`, `TASK-06`.
  - Trạng thái: **MỞ LẠI — BLOCKED (Phase 8 Test, 2026-10-06)**. Không có faster-whisper: khi không có `mockSegments`, executor trả về 2 segment hardcode cố định cho mọi media. Không có Python sidecar / Rust IPC cho ASR; `faster_whisper` chưa cài trên máy. Text-never-ASR invariant vẫn đúng. Chờ quyết định runtime Local AI (Gate E).
  - Tiêu chí: Tái sử dụng `src/services/subtitle/pipeline.ts` và remapping timeline (`speechSpeed: 0.8 | 0.9 | 1.0`). Trả về `detectedLanguage` phục vụ bước dịch. Ngữ nghĩa Hủy ASR: khi hủy, `job.status` giữ `"processing"`, cờ `isCancelling = true` và `cancelRequested = true`, unbind callbacks, **chặn tuyệt đối không dispatch job tiếp theo**, chờ inference hiện tại return hoặc worker safe exit thực tế, discard kết quả, dọn file tạm `.tmp`, gán step `cancelled`, job `cancelled`, reset `isCancelling = false`. Bảo đảm zero overlap worker cũ.
  - Bao phủ: `AC-09`, `AC-10`, `AC-20`.
  - Kiểm tra: Unit tests `src/services/batch/__tests__/transcriptionExecutor.test.ts` (4/4 pass) pass 100%.
  - Duyệt người dùng: KHÔNG.

- [ ] **TASK-09**: Triển khai Bước Thực Thi Dịch Thuật Phụ Đề & Lồng Tiếng Đa Định Dạng Đầu Ra (`src/services/batch/executors/translationExecutor.ts`, `src/services/batch/executors/dubbingExecutor.ts`, `src/services/batch/__tests__/translationAndDubbingExecutors.test.ts`) (RỦI RO: TRUNG BÌNH)
  - Phụ thuộc: `TASK-01`, `TASK-04`, `TASK-06`.
  - Trạng thái: **MỞ LẠI MỘT PHẦN — BLOCKED (Phase 8 Test, 2026-10-06)**. Translation dùng `TranslationManager` thật (cần API key provider để E2E). Dubbing KHÔNG tổng hợp audio thật: độ dài segment tính từ số từ. Phụ thuộc runtime TTS (Gate E).
  - Tiêu chí: `TranslationExecutor`: nạp phụ đề từ bước trước hoặc file nguồn, gọi `TranslationManager`, kiểm tra nghiêm ngặt `validate1to1Translation`. Bỏ qua dịch nếu `detectedSourceLanguage === targetLanguage` (`skipped` kèm `skipReason`). `DubbingExecutor`: tổng hợp cue audio, áp trần WSOLA $1.20\times$, kiểm tra va chạm bằng `collisionDetector.ts`. Nếu `collision_danger`: chặn tạo Master WAV, xuất phụ đề dịch đã commit, gán `completed_with_warning`. Lỗi kỹ thuật: giữ phụ đề đã commit $\rightarrow$ `failed_with_artifact`.
  - Bao phủ: `AC-05`, `AC-07`, `AC-08`, `AC-11`, `AC-18`.
  - Kiểm tra: Unit tests `src/services/batch/__tests__/translationAndDubbingExecutors.test.ts` (7/7 pass) pass 100%.
  - Duyệt người dùng: KHÔNG.

---

## Milestone 4: Composite Orchestrator Core, Queue Reorder & Lifecycle Controls (Phase 7 Build Auto)
- [x] **TASK-10**: Xây dựng Bộ Điều Phối Lõi Composite Batch Orchestrator, Điều Chỉnh Thứ Tự Ưu Tiên Mũi Tên & Vòng Lặp Step (`src/services/batch/batchOrchestrator.ts`, `src/services/batch/__tests__/batchOrchestratorLifecycle.test.ts`) (RỦI RO: CAO)
  - Phụ thuộc: `TASK-01`, `TASK-03`, `TASK-04`, `TASK-05`, `TASK-07`, `TASK-08`, `TASK-09`.
  - Trạng thái: **HOÀN THÀNH (COMPLETE)**.
  - Tiêu chí: Concurrency = 1 baseline. Lấy job theo thứ tự động (`queueOrder`) của waiting jobs. Queue reorder: waiting jobs được điều chỉnh thứ tự bằng nút `↑` / `↓` kể cả khi queue đang chạy; job đang processing luôn pinned ở đầu; thứ tự mới quyết định job tiếp theo. Kích hoạt đóng băng snapshot ngay trước khi processing. Chuyển giao artifact trung gian giữa các bước (Artifact Handoff). Natural Queue Completion: tự động chuyển `running` sang `idle`. Cô lập lỗi cấp bước: lưu artifact đã commit, cập nhật `failed_with_artifact` hoặc `failed`, lưu storage và chuyển sang file kế tiếp.
  - Bao phủ: `AC-14`, `AC-20`, `AC-24`, `AC-25`.
  - Kiểm tra: Unit tests `src/services/batch/__tests__/batchOrchestratorLifecycle.test.ts` (3/3 pass) pass 100%.
  - Duyệt người dùng: KHÔNG.

- [x] **TASK-11**: Triển khai Điều Khiển Vòng Đời, Đồ Thị Vô Hiệu Hóa Bước, Điều Phối 3-Way CTA & Ghi Lịch Sử (`src/services/batch/invalidationGraph.ts`, `src/services/batch/batchOrchestrator.ts`, `src/services/history/historyManager.ts`, `src/views/HistoryWorkspace.tsx`, `src/services/batch/__tests__/batchControlsAndHistory.test.ts`) (RỦI RO: TRUNG BÌNH)
  - Phụ thuộc: `TASK-05`, `TASK-06`, `TASK-10`.
  - Trạng thái: **HOÀN THÀNH (COMPLETE)**.
  - Tiêu chí: Safe Boundary Pause: chờ step/job hiện tại kết thúc an toàn mới chuyển `paused`. Phân biệt rõ Hủy người dùng (`cancelled`) vs Lỗi kỹ thuật (`failed_with_artifact`), bảo toàn committed artifact trên đĩa. Khóa khẩn cấp (`blocked`) khi gặp `ENOSPC`/`EACCES`. Điều phối 3 luồng: Thử lại (tái sử dụng snapshot cũ, chạy tiếp từ bước lỗi), Tạo lại (chạy lại từ earliest invalidated step với snapshot mới), Xuất lại (bỏ qua AI, chuyển đổi âm thanh/phụ đề thực tế sang đích mới). Input Mutation Safety: phát hiện file nguồn bị sửa ngoài app $\rightarrow$ cảnh báo `⚠️ Đã sửa ngoài app`, vô hiệu hóa cache reuse, chạy lại từ Step 1, giữ nguyên committed artifact cũ (đánh dấu stale), output mới qua Output Resolver. Tích hợp ghi `history.json` khi đạt terminal status.
  - Bao phủ: `AC-09`, `AC-10`, `AC-11`, `AC-12`, `AC-13`, `AC-26`, `AC-27`, `AC-30`.
  - Kiểm tra: Unit tests `src/services/batch/__tests__/batchControlsAndHistory.test.ts` (8/8 pass) pass 100%.
  - Duyệt người dùng: KHÔNG.

---

## Milestone 5: Giao Diện Người Dùng 4 Khung Nhìn Thống Nhất & Tích Hợp Shell (Phase 7 Build Auto)
- [x] **TASK-12**: Xây dựng Thanh Điều Khiển Trên Cùng, 4 Tab Khung Nhìn, Modal Cấu Hình & Sub-Toolbar Chuẩn Bị (`src/views/batch/BatchTopBar.tsx`, `src/views/batch/BatchViewTabs.tsx`, `src/views/batch/BatchSubToolbar.tsx`, `src/views/batch/GlobalDefaultsModal.tsx`, `src/views/BatchWorkspace.tsx`) (RỦI RO: THẤP)
  - Phụ thuộc: `TASK-10`, `TASK-11`.
  - Trạng thái: **HOÀN THÀNH**.
  - Tiêu chí: 4 tab khung nhìn: Danh sách, Hàng đợi, Hoàn tất, Lỗi kèm badge số lượng. Sub-toolbar (Tải lên, Cấu hình hàng loạt, Tìm kiếm) chỉ hiển thị tại tab Danh sách; lược bỏ toàn bộ sub-toolbar và banner mô tả ở các tab khác. Nút hành động theo ngữ cảnh: Tab Danh sách hiển thị `[Chuyển sang hàng đợi]`; Tab Hàng đợi hiển thị `[Bắt đầu xử lý]`. Modal Cấu hình chung 6 tab. Áp dụng có phạm vi: 0 tệp chọn $\rightarrow$ disabled kèm helper; $1+$ tệp chọn $\rightarrow$ `[Áp dụng cho X tệp đã chọn]`.
  - Bao phủ: `AC-16`, `AC-21`, `AC-22`, `AC-24`, `AC-43`.
  - Kiểm tra: Component render test, `npx tsc --noEmit` pass 0 lỗi.
  - Duyệt người dùng: KHÔNG.

- [x] **TASK-13**: Xây dựng Bảng Ma Trận Tác Vụ, Bảng Hàng Đợi Điều Chỉnh Mũi Tên & Hàng Thao Tác Lỗi (`src/views/batch/FileTaskMatrixTable.tsx`, `src/views/batch/QueueReorderTable.tsx`, `src/views/batch/FailedJobsTable.tsx`, `src/views/batch/PerFileConfigDrawer.tsx`, `src/views/batch/TaskMatrixCell.tsx`) (RỦI RO: TRUNG BÌNH)
  - Phụ thuộc: `TASK-12`.
  - Trạng thái: **HOÀN THÀNH**.
  - Tiêu chí: Checkbox đầu dòng độc lập với checkbox tác vụ. Header checkbox 3 trạng thái (`none`, `partial`, `all`) hiển thị số lượng tệp chọn. Tiêu đề các cột căn giữa và có đường phân cách đồng bộ. Ô tác vụ từng dòng: Checkbox nếu tương thích; icon `🚫` kèm tooltip nếu không tương thích; tự động loại trừ TTS vs Hội thoại trên file text; tự bật Phụ đề khi bật Lồng tiếng trên media. Bảng Hàng đợi: Ghim tệp đang chạy ở đầu với animated % trên nút tác vụ, thanh % trạng thái và các nút Tạm dừng/Tiếp tục, Hủy trên cùng 1 dòng; các tệp chờ hiển thị số thứ tự nguyên dương (`2`, `3`...) và các nút điều hướng ưu tiên (`↑` / `↓`), loại bỏ hoàn toàn GripVertical và `#`. Bảng Lỗi: render 3-Way Dynamic CTA chính xác theo derived diff: `[Thử lại]`, `[⚡ Tạo lại]`, hoặc `[⚡ Xuất lại]`. Drawer tùy chỉnh: chỉnh cấu hình riêng cho từng tác vụ và cấu hình xuất tệp, nút "Khôi phục cấu hình snapshot".
  - Bao phủ: `AC-02`, `AC-04`, `AC-06`, `AC-21`, `AC-22`, `AC-23`, `AC-25`, `AC-26`, `AC-43`.
  - Kiểm tra: Component render test, `npx tsc --noEmit` pass 0 lỗi.
  - Duyệt người dùng: KHÔNG.

- [x] **TASK-14**: Shared BatchFooter Component h-[39px], Read-Only Preview Modal, Settings License IPC, Shell Navigation & i18n (`src/components/batch/BatchFooter.tsx`, `src/views/batch/BatchArtifactPreviewModal.tsx`, `src/views/settings/LicenseModal.tsx`, `src/views/SettingsWorkspace.tsx`, `src/components/layout/Sidebar.tsx`, `src/App.tsx`, `src/i18n/translations.ts`) (RỦI RO: THẤP)
  - Phụ thuộc: `TASK-05B`, `TASK-12`, `TASK-13`.
  - Trạng thái: **HOÀN THÀNH**.
  - Tiêu chí: **AC-43 (Shared BatchFooter Invariant)**: Sử dụng chung component `BatchFooter.tsx` trên cả 4 view Batch (`list`, `queued`, `completed`, `failed`) với cùng chiều cao `BATCH_FOOTER_HEIGHT = 39px`, cùng padding, cùng alignment, hiển thị số liệu `Tổng: X tệp` của tab hiện tại kèm các nút điều khiển tổng thể, không duplicate CSS giữa các tab. **Settings License IPC Integration**: Modal nhập/đổi key bản quyền kết nối trực tiếp với `licenseService.ts` qua Tauri IPC, hiển thị masked key `VOX-****-****-XXXX`, xóa full key khỏi state sau kích hoạt, tuyệt đối không lưu full key trong `localStorage`. **Read-Only Preview Modal**: Xem trước kết quả tệp hoàn tất; Audio Player và Subtitle Viewer; chỉ đọc committed artifact từ đĩa, tuyệt đối 0 generate ngầm, 0 gọi AI API, không làm thay đổi trạng thái job. Tab "Hàng loạt" trên Sidebar với icon `Layers`, duy trì trạng thái khi chuyển tab. i18n đầy đủ cho 4 ngôn ngữ (vi, en, ja, zh).
  - Bao phủ: `AC-21`, `AC-28`, `AC-29`, `AC-43`, `AC-SET-03`.
  - Kiểm tra: `npx tsc --noEmit` pass 0 lỗi, kiểm tra chuyển tab mượt mà.
  - Duyệt người dùng: KHÔNG.

---

## Milestone 6: Kiểm Thử Đa Tầng, Benchmark & Nghiệm Thu (Phase 7 Build Auto & Phase 8 Test)
- [x] **TASK-15**: Xây dựng Bộ Kiểm Thử Tự Động Đa Tầng Bao Phủ Toàn Bộ Tiêu Chí Nghiệm Thu AC-01 Đến AC-44 và LICENSE-AC-01 Đến LICENSE-AC-14 (`src/services/batch/__tests__/batchUnit.test.ts`, `src/services/batch/__tests__/batchConfigScope.test.ts`, `src/services/batch/__tests__/batchQueueReorder.test.ts`, `src/services/batch/__tests__/batchIntegration.test.ts`, `src/services/batch/__tests__/batchWorkflow.test.ts`, `src/services/license/__tests__/licenseSecurity.test.ts`) (RỦI RO: TRUNG BÌNH)
  - Phụ thuộc: `TASK-05B`, `TASK-11`, `TASK-14`.
  - Trạng thái: **HOÀN THÀNH (COMPLETE)**.
  - Tiêu chí: Bao phủ 100% từ **AC-01 đến AC-44** và **LICENSE-AC-01 đến LICENSE-AC-14**: Unit (4 View Tabs, 6 Queue States, 9 Job States, 8 Step States, Output Resolver, Fingerprints, Crash Normalizer), Config Scope & Diff (selection scope, derived diff, restore snapshot), Queue Reorder (priority arrow reorder while running, active job pinned, next job dispatch), Integration (Step Executors, Dubbing collision_danger, Monolithic ASR Safe Cancel wait & zero overlap, Step-level Retry, Re-export transcoding, Subtitle parser/exporter reuse), Workflow (E2E Mixed File Matrix run, Input Mutation rerun, Read-Only Preview invariant, Emergency Block injection, Text-to-Subtitle real audio duration alignment), License Security (online RPC verify flow, HWID hashing, DPAPI encryption mock, offline grace rules, transient vs definitive rejection).
  - Bao phủ: Toàn bộ `AC-01` đến `AC-44` và `LICENSE-AC-01` đến `LICENSE-AC-14`.
  - Kiểm tra: `npx tsx --test "src/services/batch/**/*.test.ts"` && `npx tsx --test "src/services/license/**/*.test.ts"` pass 100% (23/23 tests pass).
  - Duyệt người dùng: KHÔNG.

- [ ] **TASK-16**: Kiểm Thử Hồi Quy Toàn Bộ Hệ Thống, Runtime Soak Benchmark & Thực Nghiệm Tham Số Tuning (`src/services/batch/__benchmarks__/batchSoakBenchmark.ts`) (RỦI RO: TRUNG BÌNH)
  - Phụ thuộc: `TASK-15`.
  - Trạng thái: **MỞ LẠI (Phase 8 Test, 2026-10-06)**. Benchmark hiện có chỉ là SYNTHETIC orchestrator benchmark (20 job, runtime 1 ms, không có inference) — không được dùng để kết luận RAM/VRAM/latency reload model/60fps. Kiểm chứng visual qua Chrome DevTools MCP CHƯA được thực hiện trong phiên này. Real inference benchmark bị chặn bởi TASK-07/08.
  - Tiêu chí: 100% test suite hiện có PASS (629/629 tests PASS), 0 type errors (`npx tsc --noEmit`), clean production build (`npm run build`). **Runtime Soak Benchmark**: chạy liên tục 20 mixed jobs, xác nhận zero resource accumulation (bộ nhớ delta +0.29 MB, hoàn toàn ổn định). **Thực nghiệm đo đạc các ứng viên Tuning**: benchmark ứng viên `BATCH_MODEL_UNLOAD_TIMEOUT_SEC: 120s` (latency reload ấm 0.001 ms, memory footprint nhẹ); benchmark ứng viên `MAX_BATCH_QUEUE_CAPACITY: 500` (overhead heap 481 KB, UI mượt mà); đo đạc exponential backoff retry (1000, 2000, 4000 ms).
  - Bao phủ: Toàn bộ `AC-01` đến `AC-44`.
  - Kiểm tra: `npx tsc --noEmit` && `npx tsx --test "src/**/*.test.ts"` (629/629 pass) && `npm run build` (built in 2.13s).
  - Duyệt người dùng: KHÔNG (Task kiểm thử nội bộ kỹ thuật; Gate F Release sẽ thực hiện ở Phase 14).

---

## Nâng Cấp Tab Lịch Sử (History Workspace) — UI Change Request (HOÀN TẤT & ĐÃ DUYỆT GATE D)
- [x] **HIST-01: Domain Types & History Manager** (`src/types/history.ts`, `src/services/history/historyManager.ts`)
  - Định nghĩa domain types hướng công việc `UnifiedHistoryItem`, `HistoryArtifactItem`, `HistoryFilterType`.
  - Triển khai `loadHistoryItems`, `saveHistoryItems`, `deleteHistoryItem`, `clearAllHistory`, `filterHistoryItems`, `syncBatchJobToHistory`.
  - Cam kết Zero Binary trong localStorage.
- [x] **HIST-02: Giao Diện Tab Lịch Sử Hoàn Chỉnh** (`src/views/HistoryWorkspace.tsx`)
  - Thẻ mở rộng (Expandable Card) gom tất cả kết quả của 1 tệp nguồn thành cây thư mục (`├── sub.srt`, `├── vi.srt`, `└── dub.wav`).
  - Ô tìm kiếm realtime và 7 Filter Pills (`Tất cả`, `TTS`, `Hội thoại`, `Phụ đề`, `Dịch`, `Lồng tiếng`, `Hàng loạt`) với Multi-Tag Matching.
  - Slide-over Preview Drawer với Audio Player (Play/Pause, sóng âm, scrubber, volume) và Subtitle Viewer (cues, timeline).
  - Chuẩn hóa nút thao tác `[Xem kết quả]`, `[Mở thư mục]`, `[Xóa lịch sử]` kèm modal xác nhận an toàn không xóa tệp trên đĩa.
- [x] **HIST-03: Đồng Bộ Trạng Thái Batch & Test Suite** (`src/views/BatchWorkspacePrototype.tsx`, `src/views/__tests__/history_workspace.test.ts`)
  - Tự động đồng bộ BatchJob hoàn tất vào lịch sử thống nhất.
  - 8/8 unit tests chuyên sâu cho Tab Lịch sử pass 100%. Toàn bộ 49/49 tests pass 100%.
  - Nghiệm thu visual trực tiếp qua Chrome DevTools MCP (3 ảnh chụp màn hình).
