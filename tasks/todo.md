# Danh Sách Công Việc & Trạng Thái Vòng Đời Dự Án VoxLab (`tasks/todo.md`)

## 1. Bảo Mật Đa Lớp & Chống Dịch Ngược (Security v3.1 — Phase 10)
- [x] **INC-01**: Cấu hình `[profile.release]` (`strip`, `lto`, `codegen-units=1`, `panic="abort"`), nâng cấp `src-tauri/build.rs` mã hóa chuỗi đa hình lúc build và tạo `security/obf.rs` + `security/crypto_seal.rs` (HMAC-SHA256 & constant-time verify).
- [x] **INC-02**: Gia cố `license_storage.rs` (entropy động KDF + `integrity_tag` HMAC), `license_client.rs` (khóa env/proxy ở Release), tạo `security/anti_tamper.rs` (Fail-Closed Lockout), cập nhật `security/mod.rs` (`SessionSeal` inline) và khóa biên IPC/FS (`lib.rs`, `fsio.rs`, `ai/mod.rs`).
- [x] **INC-03**: Triển khai xác thực hai chiều HMAC Host↔Sidecar (`ipc_auth.py`, `server.py`, `__main__.py`, `sidecar.rs`) và nâng cấp `sidecar/build_sidecars.ps1` tích hợp PyArmor fail-closed + kiểm tra rò rỉ mã nguồn.
- [x] **INC-04**: Gia cố Frontend & WebView2 (`antiInspect.ts`, `main.tsx`, `licenseService.ts`, `vite.config.ts`, `tauri.conf.json`, `docs/WINDOWS_PACKAGING.md`).
- [x] **INC-05**: Kiểm thử toàn diện (Rust tests, Python sidecar tests, Frontend tests, `npm run build`, `cargo build --release` + quét chuỗi nhị phân `voxlab.exe`) và chạy trực tiếp ứng dụng **VoxLab**.

## 2. Hoàn Thiện UI/UX Voice Clone & Voice Library (Approved UI Polish)
- [x] **UI-01**: Tối ưu khu vực Voice Clone (tự động chọn vùng/accent hợp lệ đầu tiên, loại bỏ tùy chọn rỗng, bỏ dòng chú thích thừa dưới hàng Model & Ngôn ngữ — commits `36bdac7`, `d431add`).
- [x] **UI-02**: Chuẩn hóa phân loại quốc gia/thẻ giọng đọc, sắp xếp ưu tiên trong Voice Library, và dọn dẹp 7 giọng local alias trùng lặp + 2 giọng clone mẫu ảo, chỉ giữ lại 4 giọng Local thật có file âm thanh chuẩn (`Thảo Trinh`, `Nam Anh`, `Sarah`, `David`) — commits `68cc26d`, `d3a5fe3`.

## 3. Hiệu Năng, WebPerf & Benchmark `TUNING REQUIRED` (Phase 11)
- [x] **PERF-01**: Đo đạc `/webperf` (Cold Startup LCP `84 ms` @ 1× / `340 ms` @ 6×; Runtime INP trên toàn bộ 9 workspaces) và xử lý triệt để vòng lặp đọc/ghi vô hạn ở `HistoryWorkspace` (`e56508d`) cùng tối ưu `React.memo` cho `TtsChunkCard` giảm `-88%` INP khi gõ trên kịch bản 319 chunks (`5533e3f`).
- [x] **PERF-02**: Thực thi đầy đủ 8 hạng mục `TUNING REQUIRED` với benchmark đa giá trị trên GPU thực tế (RTX 5070 Ti 16 GB), khắc phục lỗi rớt từ cuối câu của Chatterbox Turbo trên chunk `> 380` ký tự (`30%` lỗi → `0%` lỗi, `-40.3%` Effective RTF), tắt `cudnn.benchmark` cho TTS khả biến độ dài (`-11%` thời gian suy luận), kiểm chứng thực nghiệm giới hạn bộ nhớ Master WAV ở các mốc `30m / 60m / 120m` và ghi nhận toàn bộ vào `PERFORMANCE.md` (`386a04f`).

## 4. Đơn Giản Hóa Mã Nguồn (`/code-simplify` — Phase 12)
- [x] **SIMP-01**: Hợp nhất logic khởi tạo CUDA, giải phóng working set, tóm tắt VRAM và clamp tham số `extra` vào `sidecar/voxlab_sidecar/tts/base.py` cho cả 3 TTS adapters (`omnivoice`, `chatterbox`, `qwen`) và dọn regex thừa trong `service.py`.
- [x] **SIMP-02**: Hợp nhất bộ lọc ngôn ngữ/giọng đọc và bảng màu Avatar trùng lặp giữa `VoiceCloneWorkspace.tsx`, `VoiceLibraryWorkspace.tsx` và `VoiceSelectionModal.tsx` về `src/constants/voiceFilters.ts`; loại bỏ hơn 6.800 dòng dead prototype JSX trong `src/views/BatchWorkspacePrototype.tsx` (`2b5717e`).

## 5. Rà Soát Cuối Cùng (`FINAL REVIEW` — Phase 13)
- [x] **REV-01**: Đối chiếu toàn bộ implementation với `SPEC.md`, `CONSTRAINTS.md`, `tasks/plan.md`, `PERFORMANCE.md` và UI/UX đã duyệt; xác nhận toàn bộ 903 Frontend tests + 222 Python sidecar tests + 35 Rust unit tests + `tsc --noEmit` + `npm run build` đều PASS (`Verdict: READY`).
