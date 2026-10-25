# Hướng Dẫn Đóng Gói Bản Thương Mại Windows (VoxLab Security v3.1)

Tài liệu này mô tả kiến trúc đóng gói chống dịch ngược đa lớp (**Security v3.1**), quy trình biên dịch Frontend + Rust Tauri + Python Sidecar (PyArmor + PyInstaller), ký số Authenticode và danh sách kiểm tra trước phát hành.

---

## 1. Kiến trúc Bảo mật & Chống dịch ngược 4 Lớp (Security v3.1)

1. **Lớp 1 — Binary Rust gốc (`voxlab.exe`)**:
   - `src-tauri/build.rs` mã hóa đa hình (Polymorphic SplitMix64 + Rotate + Add) toàn bộ hằng số nhạy cảm (`VOXLAB_SUPABASE_URL`, `VOXLAB_SUPABASE_ANON_KEY`, đường dẫn RPC, seed KDF, đường dẫn Registry) theo từng lần build và giải mã qua `black_box` + xóa bộ nhớ tức thì (`ZeroizingBytes`) tại `src-tauri/src/security/obf.rs`.
   - Cấu hình `[profile.release]` bật `lto = true`, `codegen-units = 1`, `panic = "abort"`, `strip = "symbols"`.
   - Khóa cứng mọi biến môi trường/proxy ghi đè (`VOXLAB_ENFORCE_LICENSE`, `VOXLAB_SUPABASE_URL`, `VOXLAB_SIDECAR_ROOT`, `HTTPS_PROXY`) ở bản Release.
2. **Lớp 2 — Kho khóa DPAPI + HMAC Seal, Anti-Debug/Tamper & `SessionSeal`**:
   - `license.enc` được bảo vệ kép bằng Windows DPAPI (với entropy động dẫn xuất 2048 vòng KDF) **kèm chữ ký `HMAC-SHA256` (`integrity_tag`)** trên toàn bộ trường dữ liệu; vẫn duy trì đọc tương thích ngược cho `gemini_keys.enc`.
   - Hệ thống chống gỡ lỗi chế độ người dùng (`IsDebuggerPresent`, `CheckRemoteDebuggerPresent` + kiểm tra bất thường thời gian thực thi) kích hoạt khóa cứng **Fail-Closed (`SECURITY_VIOLATION`)** và thu hồi `SessionSeal` trong RAM.
   - Các tệp nhạy cảm (`license.enc`, `device_profile.enc`, `gemini_keys.enc`) bị cô lập khỏi các lệnh IPC hệ thống tệp chung (`fs_*`).
3. **Lớp 3 — Xác thực Tương hỗ HMAC Host ↔ Python Sidecar & PyArmor**:
   - `voxlab.exe` và `voxlab-sidecar-<rt>.exe` thực hiện bắt tay xác thực 2 chiều `HMAC-SHA256` (`system.authenticate`) gắn chặt với `VOXLAB_SPAWN_SEED`, chuỗi tiến trình cha-con trực tiếp (`VOXLAB_HOST_PID`) và tên `runtime`. Mọi lần gọi trực tiếp `voxlab-sidecar-*.exe` từ bên ngoài đều bị từ chối với mã `UNAUTHORIZED_HOST`.
   - `sidecar/build_sidecars.ps1` mã hóa bytecode/AST bằng **PyArmor** ở chế độ **Fail-Closed** trước khi đóng gói bằng PyInstaller `--onedir --noupx`, kiểm tra rò rỉ `.py` trong `_internal` và kiểm tra tự động khóa `UNAUTHORIZED_HOST`.
4. **Lớp 4 — WebView2 / Vite Bundle & CSP**:
   - Tắt hoàn toàn sourcemap (`sourcemap: false`), loại bỏ `debugger` và chú thích bản quyền trong bundle JS, khóa cứng cổng kiểm tra bản quyền ở chế độ `PROD` và chặn phím tắt DevTools (`F12`, `Ctrl+Shift+I/J/C`, `Ctrl+U`).

---

## 2. Cấu trúc thư mục khi đóng gói

`src-tauri/src/ai/sidecar.rs` (`resolve_packaged_runtime_from_dir`) tự động dò tìm Sidecar theo thứ tự ưu tiên:

1. **PyInstaller `--onedir` đã bọc PyArmor (Khuyến nghị thương mại)**:
   - `<Thư mục cài đặt>\sidecar\voxlab-sidecar-core\voxlab-sidecar-core.exe`
   - `<Thư mục cài đặt>\sidecar\voxlab-sidecar-chatterbox\voxlab-sidecar-chatterbox.exe`
   - `<Thư mục cài đặt>\sidecar\voxlab-sidecar-qwen\voxlab-sidecar-qwen.exe`
2. **Executable đơn lẻ cùng thư mục `voxlab.exe`**:
   - `<Thư mục cài đặt>\voxlab-sidecar-<runtime>.exe`

---

## 3. Quy trình Build Thương Mại Windows

### Bước 1: Thiết lập cấu hình Build-time (`.env.local` — không đưa lên Git)
Đảm bảo `.env.local` tại thư mục gốc chứa cấu hình Supabase của dự án:
```env
VOXLAB_SUPABASE_URL=https://<project-ref>.supabase.co
VOXLAB_SUPABASE_ANON_KEY=<publishable-or-anon-key>
VOXLAB_ENFORCE_LICENSE=1
```

### Bước 2: Chạy kiểm thử toàn diện (TypeScript, Security Suite, Python IPC & Rust)
```powershell
npx tsc --noEmit
npx tsx --test src/services/license/__tests__/licenseService.test.ts src/services/license/__tests__/licenseSecurity.test.ts
.\sidecar\.venv\Scripts\python.exe -m unittest discover -s sidecar/tests -p "test_ipc_auth.py" -v
cargo test --manifest-path src-tauri/Cargo.toml
```

### Bước 3: Đóng gói Sidecar với PyArmor + PyInstaller (Kèm ký số tùy chọn)
```powershell
# Tùy chọn: cung cấp SHA1 thumbprint chứng chỉ Code Signing trong Windows Cert Store
# $env:VOXLAB_SIGN_CERT_SHA1 = "YOUR_CERT_SHA1_THUMBPRINT"
powershell -ExecutionPolicy Bypass -File .\sidecar\build_sidecars.ps1
```
*(Chỉ khi test nội bộ không cần PyArmor mới truyền `-SkipObfuscationForDev`; bản thương mại luôn chạy mặc định Fail-Closed).*

### Bước 4: Đóng gói ứng dụng Tauri Release (`voxlab.exe` / NSIS / MSI)
```powershell
npx tauri build
```
Tệp thực thi sau khi build nằm tại:
- `src-tauri\target\release\voxlab.exe`
- Bộ cài đặt NSIS/MSI nằm tại: `src-tauri\target\release\bundle\`

---

## 4. Danh sách kiểm tra An ninh & Chức năng trên máy sạch

- [ ] Quét chuỗi nhị phân `voxlab.exe`: **0 kết quả** cho `supabase.co`, JWT key, `activate_or_verify_voxlab_license_v3`, `VoxLab-License-v3`, `MachineGuid`.
- [ ] Kiểm tra thư mục `dist/` không chứa tệp `*.map` nào.
- [ ] Chạy thử độc lập `voxlab-sidecar-core.exe --runtime core` từ CMD: từ chối `system.ping` với lỗi `UNAUTHORIZED_HOST`.
- [ ] Mở `voxlab.exe` trên máy chưa kích hoạt: hiển thị bắt buộc cổng kích hoạt License, không sử dụng được AI/TTS/Dịch thuật khi chưa nhập key hợp lệ.
- [ ] Sau khi kích hoạt key hợp lệ (`VOXLAB-XXXX-XXXX-XXXX-XXXX`), kiểm tra Cài đặt $\rightarrow$ Bản quyền chỉ hiển thị mã đã che (`VOXLAB-****-****-XXXX`), kho `gemini_keys.enc` hoạt động bình thường.
