# Kế Hoạch Triển Khai: Chống Dịch Ngược & Bảo Mật Đa Lớp VoxLab (Security v3.1)

## 1. Tổng Quan
Tiếp nối hệ thống License Security v3 (commit `8e1aec2`), triển khai nâng cấp toàn diện 4 lớp chống dịch ngược (Anti-Reverse-Engineering) và gia cố bảo mật runtime cho **VoxLab** theo kiến trúc **Fail-Closed Lockout** đã được phê duyệt tại Gate E (tránh false-positive trên Windows Defender).

## 2. Kiến Trúc 4 Lớp Bảo Vệ
1. **Lớp 1 — Rust Binary Hardening & Polymorphic String Cipher (`Cargo.toml`, `build.rs`, `security/obf.rs`)**:
   - Mã hóa chuỗi nhạy cảm lúc biên dịch bằng dòng khóa đa hình SplitMix64 sinh ngẫu nhiên mỗi lần build, giải mã trên RAM qua `std::hint::black_box` và xóa bộ nhớ bằng `write_volatile` (`ZeroizingBytes`).
   - Cấu hình `[profile.release]`: `strip = "symbols"`, `lto = true`, `codegen-units = 1`, `panic = "abort"`, `opt-level = 3`.
2. **Lớp 2 — HMAC-DPAPI Seal, Anti-Debug Fail-Closed, Inlined `SessionSeal` & IPC/FS Boundary (`crypto_seal.rs`, `anti_tamper.rs`, `license_storage.rs`, `license_client.rs`, `mod.rs`, `lib.rs`, `fsio.rs`, `ai/mod.rs`)**:
   - RFC 2104 `HMAC-SHA256` + so sánh hằng thời gian (`ct_eq`).
   - Entropy DPAPI động gắn với HWID + chữ ký `integrity_tag` chống sửa trộm `license.enc` (giữ tương thích ngược cho `gemini_keys.enc` và cache hợp lệ).
   - Khóa toàn bộ biến môi trường bypass (`VOXLAB_ENFORCE_LICENSE`, `VOXLAB_SUPABASE_URL`, `VOXLAB_SIDECAR_ROOT`, `HTTPS_PROXY`) ở bản Release.
   - `anti_tamper.rs` kiểm tra `IsDebuggerPresent`, `CheckRemoteDebuggerPresent` & độ trễ bất thường → kích hoạt **Fail-Closed Lockout** (`SECURITY_VIOLATION`).
   - Cô lập tệp nhạy cảm (`license.enc`, `device_profile.enc`, `gemini_keys.enc`) khỏi các lệnh đọc/ghi file từ WebView.
3. **Lớp 3 — Xác Thực Hai Chiều Host↔Sidecar HMAC & Đóng Gói PyArmor (`sidecar.rs`, `ipc_auth.py`, `server.py`, `__main__.py`, `build_sidecars.ps1`)**:
   - Giao thức bắt tay `system.authenticate` dùng khóa phiên dẫn xuất từ `(obfuscated_ipc_key, spawn_seed, parent_pid, runtime)` chặn chạy lẻ `voxlab-sidecar-*.exe` (`UNAUTHORIZED_HOST`).
   - Nâng cấp `sidecar/build_sidecars.ps1` tích hợp **PyArmor** fail-closed + kiểm tra rò rỉ `.py` + tùy chọn ký số `signtool` chuẩn `Audio-Factory`.
4. **Lớp 4 — WebView2 Anti-Inspect, Vite Bundle Hardening & CSP (`vite.config.ts`, `antiInspect.ts`, `main.tsx`, `licenseService.ts`, `tauri.conf.json`)**:
   - Tắt sourcemap, loại bỏ `debugger` & legal comments lúc build production, khóa bypass `localStorage` ở `PROD`, chặn `F12`/`Ctrl+Shift+I/J/C`/`Ctrl+U` và chuột phải ngoài ô nhập liệu ở `PROD`, siết chặt CSP.

## 3. Các Bước Triển Khai & Kiểm Chứng (Increments)
- [x] **INC-01 (Rust Polymorphic Obfuscation & Release Profile)**: Cập nhật `Cargo.toml`, `build.rs`, tạo `security/obf.rs` & `security/crypto_seal.rs`; kiểm thử RFC 4231 HMAC vectors + zeroize + giải mã chuỗi.
- [x] **INC-02 (Vault HMAC Seal, Anti-Tamper Fail-Closed & IPC/FS Guards)**: Cập nhật `license_storage.rs`, `license_client.rs`, `anti_tamper.rs`, `security/mod.rs`, `lib.rs`, `fsio.rs`, `ai/mod.rs`; chạy `cargo test`.
- [x] **INC-03 (Sidecar Mutual HMAC Auth & PyArmor Build Pipeline)**: Tạo `sidecar/voxlab_sidecar/ipc_auth.py`, cập nhật `server.py`, `__main__.py`, `sidecar.rs`, `build_sidecars.ps1` và viết unit test Python + Rust kiểm chứng bắt tay & từ chối gọi lẻ.
- [x] **INC-04 (Frontend/WebView2 Hardening & Docs)**: Tạo `src/utils/antiInspect.ts`, cập nhật `src/main.tsx`, `src/services/license/licenseService.ts`, `vite.config.ts`, `src-tauri/tauri.conf.json`, `docs/WINDOWS_PACKAGING.md`.
- [x] **INC-05 (Full Verification, Release Binary String Audit & Live Run)**: Biên dịch cả `cargo test` và `cargo build --release`, quét nhị phân `voxlab.exe` xác nhận 0 chuỗi nhạy cảm lộ rõ, chạy toàn bộ unit test Rust + Python + Frontend, và mở chạy thử ứng dụng **VoxLab** thực tế.
