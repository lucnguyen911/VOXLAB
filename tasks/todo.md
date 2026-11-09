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

## 5. Nâng Cấp Dịch Thuật Phụ Đề, Lồng Tiếng & Hậu Kiểm ASR (Approved Session Enhancements)
- [x] **DUB-01**: Nâng cấp `edge-tts` `7.3.1` + đồng bộ lệch giờ server (`Sec-MS-GEC`) và sửa triệt để race condition `BUSY` khi bấm Hủy/Chạy lại lồng tiếng từ đầu (`67f3961`, `5c23924`).
- [x] **DUB-02**: Triển khai cơ chế WSOLA `1.20x` kết hợp **Elastic Ripple Shift** tự động lùi nhẹ câu kế tiếp khi tràn thời lượng ở chế độ đồng bộ video gốc và tự động gom nhịp về mốc gốc tại các khoảng lặng (`dcbf769`).
- [x] **DUB-03**: Tích hợp bộ lọc QA dịch phụ đề & cơ chế **Gom Repair** từ `Audio-Factory` ([`translationQaAndRepair.ts`](file:///f:/Source%20Code%20Tool/Voxlab/src/services/translation/translationQaAndRepair.ts)), nút 1-click **`Dịch bù X câu sót`**, tối ưu Silero VAD cho giọng đọc TTS + fallback tự động `CUDA -> CPU (int8)` khi tranh chấp VRAM trong ASR hậu kiểm, và minh bạch hóa nút `Nghe nhóm` / thời lượng nhóm trên Bottom Player (`5a42c50`).

## 6. Rà Soát Cuối Cùng (`FINAL REVIEW` — Phase 13)
- [x] **REV-01**: Đối chiếu toàn bộ implementation với `SPEC.md`, `CONSTRAINTS.md`, `tasks/plan.md`, `PERFORMANCE.md` và UI/UX đã duyệt; xác nhận toàn bộ 913 Frontend tests + 222 Python sidecar tests + 35 Rust unit tests + `tsc --noEmit` + `npm run build` đều PASS (`Verdict: READY`).


## 7. Đóng Gói & Phát Hành Production (`/ship` — Phase 14)
- [x] **SHIP-01**: Hoàn thiện `sidecar/build_sidecars.ps1` và đóng gói toàn bộ 3 Python sidecars (`voxlab-sidecar-core`, `voxlab-sidecar-chatterbox`, `voxlab-sidecar-qwen`) với PyArmor + PyInstaller (`--onedir`, `--noupx`, 0 file `.py` rò rỉ), xác thực Mutual-HMAC `HOST_AUTH_V3.1` / `SIDECAR_ACK_V3.1` và chặn gọi độc lập (`UNAUTHORIZED_HOST`).
- [x] **SHIP-02**: Cập nhật `src-tauri/tauri.conf.json` (nhúng `target/release/sidecar` vào `bundle.resources` và siết chặt CSP `connect-src`), đồng bộ phiên bản `@tauri-apps/*`, tạo `CHANGELOG.md` và `RELEASE.md`, chạy `npx tauri build` tạo `voxlab.exe`, `VoxLab_0.1.0_x64-setup.exe` (NSIS) và `VoxLab_0.1.0_x64_en-US.msi` (WiX), kiểm chứng first launch, restart, bảo toàn dữ liệu `%APPDATA%\com.voxlab.app` và xử lý thiếu model (`MODEL_NOT_FOUND`) (`SHIP DECISION: GO`).
