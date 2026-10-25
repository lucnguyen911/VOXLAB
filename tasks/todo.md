# Danh Sách Công Việc: Chống Dịch Ngược & Bảo Mật Đa Lớp VoxLab (Security v3.1)

- [x] **INC-01**: Cấu hình `[profile.release]` (`strip`, `lto`, `codegen-units=1`, `panic="abort"`), nâng cấp `src-tauri/build.rs` mã hóa chuỗi đa hình lúc build và tạo `security/obf.rs` + `security/crypto_seal.rs` (HMAC-SHA256 & constant-time verify).
- [x] **INC-02**: Gia cố `license_storage.rs` (entropy động KDF + `integrity_tag` HMAC), `license_client.rs` (khóa env/proxy ở Release), tạo `security/anti_tamper.rs` (Fail-Closed Lockout), cập nhật `security/mod.rs` (`SessionSeal` inline) và khóa biên IPC/FS (`lib.rs`, `fsio.rs`, `ai/mod.rs`).
- [x] **INC-03**: Triển khai xác thực hai chiều HMAC Host↔Sidecar (`ipc_auth.py`, `server.py`, `__main__.py`, `sidecar.rs`) và nâng cấp `sidecar/build_sidecars.ps1` tích hợp PyArmor fail-closed + kiểm tra rò rỉ mã nguồn.
- [x] **INC-04**: Gia cố Frontend & WebView2 (`antiInspect.ts`, `main.tsx`, `licenseService.ts`, `vite.config.ts`, `tauri.conf.json`, `docs/WINDOWS_PACKAGING.md`).
- [x] **INC-05**: Kiểm thử toàn diện (Rust tests, Python sidecar tests, Frontend tests, `npm run build`, `cargo build --release` + quét chuỗi nhị phân `voxlab.exe`) và chạy trực tiếp ứng dụng **VoxLab**.
