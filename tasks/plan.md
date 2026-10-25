# Kế Hoạch Triển Khai: Hệ Thống Bảo Mật & Bản Quyền VoxLab (Security v3)

## 1. Tổng Quan
Nâng cấp và cấu hình hoàn chỉnh hệ thống bảo mật & kích hoạt bản quyền cho **VoxLab** theo kiến trúc chuẩn **Security v3** của `Audio-Factory`, đồng bộ trực tiếp lên dự án Supabase `MMO-TOOL-Manager` (`owskwezrldwlerywsfex`), bật cơ chế chặn bắt buộc ngay lúc khởi động (Mandatory Startup Gate + 3 ngày Offline Grace) và mở quản lý/đổi Key trong mục Cài đặt.

## 2. Quyết Định Kiến Trúc (Architecture Decisions)
- **Đồng bộ Schema 10 cột trên `MMO-TOOL-Manager`**: Tạo bảng `public.voxlab_licenses` (10 cột gọn sạch giống hệt `audio_licenses` và `video_licenses`), hàm sinh key tự động `public.generate_voxlab_license_key()` (`VOXLAB-XXXX-XXXX-XXXX-XXXX`), bật RLS + `REVOKE ALL` đối với `anon`/`authenticated`.
- **Xác thực Nguyên tử qua RPC v3 (`SECURITY DEFINER`)**: Triển khai `public.activate_or_verify_voxlab_license_v3` dùng khóa dòng `SELECT ... FOR UPDATE` chống race condition, hỗ trợ tự động di trú HWID cũ (`p_legacy_candidates` → `MIGRATED`), kiểm tra `max_devices`, hạn dùng `expired_at` và các hàm quản trị `admin_reset_voxlab_license_devices_v3` / `admin_remove_voxlab_license_device_v3` chỉ cấp cho `service_role`.
- **Định danh phần cứng HWID v3 tốc độ cao & bền vững (`device_identity.rs`)**:
  - Ưu tiên `SMBIOS UUID`, fallback sang `MachineGuid` đọc trực tiếp qua Win32 Registry API (`windows-sys`, không cần gọi `reg.exe`), lọc chuỗi OEM placeholder, băm `SHA-256` 64 ký tự hex (`HWID_VERSION = 3`).
  - Cache kết quả trong bộ nhớ tiến trình (`OnceLock`) + lưu hồ sơ `device_profile.enc` kèm `fallback_proof` gắn với `MachineGuid` để không làm trễ các tác vụ TTS/ASR và chống mất kích hoạt khi WMI tạm thời chập chờn.
- **Lưu trữ DPAPI có Entropy & Ân hạn Ngoại tuyến 3 ngày (`license_storage.rs`, `mod.rs`)**:
  - Mã hóa `license.enc` bằng Windows DPAPI kèm entropy ứng dụng (`VoxLab-License-v3`), ghi nguyên tử qua `MoveFileExW`.
  - Áp dụng **Offline Grace 3 ngày** chỉ khi lỗi mạng/server tạm thời (`NETWORK_ERROR`, `SERVER_ERROR`), chống quay ngược đồng hồ hệ thống, và khóa ngay không ân hạn nếu server đã trả kết quả từ chối xác định (`EXPIRED`, `DISABLED`, `DEVICE_MISMATCH`, `DEVICE_LIMIT`, `NOT_FOUND`).
- **Zero Secrets in Source (`build.rs` + `.env.local`)**:
  - Không hard-code URL hay API key vào file mã nguồn được theo dõi bởi Git (`CONSTRAINTS.md` Rule 1.3).
  - Nạp biến cấu hình từ `.env.local` (được ignore bởi Git) trong `src-tauri/build.rs` lúc biên dịch Rust và trong Vite lúc chạy dev/build.
- **Chặn Khởi Động Bắt Buộc & Mở Cài Đặt Key (`App.tsx`, `LicenseModal.tsx`, `SettingsWorkspace.tsx`)**:
  - Khi mở ứng dụng, xác thực bản quyền trước khi cho phép vào giao diện chính; nếu chưa hợp lệ sẽ hiện màn hình kích hoạt bắt buộc (nút `Thoát ứng dụng` và `Kích hoạt ngay`, không có nút bỏ qua).
  - Mở khóa khu vực `Key bản quyền` trong `Cài đặt → Chung` để xem trạng thái, hạn dùng (`DD/MM/YYYY` hoặc `Vĩnh viễn`), kiểm tra lại và đổi key.

## 3. Danh Sách Công Việc (Task List)

### Phase 1: Cơ Sở Dữ Liệu Supabase (`MMO-TOOL-Manager`)
- [x] **TASK-01**: Cập nhật `sql/voxlab_license_setup.sql` & `docs/LICENSE_SUPABASE_DEPLOYMENT.md`, triển khai migration tạo `public.voxlab_licenses` + RPC v3 lên Supabase `MMO-TOOL-Manager`, tạo 1 License Key test và kiểm thử trực tiếp các kịch bản RPC trên DB.

### Phase 2: Nâng Cấp Lõi Bảo Mật Rust (Security v3 + Build Config)
- [x] **TASK-02**: Cấu hình `.gitignore`, `.env.example`, `.env.local` và `src-tauri/build.rs` để nạp cấu hình Supabase an toàn lúc build/dev mà không lưu secret trong Git.
- [x] **TASK-03**: Nâng cấp `src-tauri/src/security/` (`device_identity.rs`, `license_storage.rs`, `license_client.rs`, `mod.rs`, `lib.rs`) lên chuẩn Security v3 (HWID v3 64-hex + legacy migration, DPAPI entropy, RPC v3, Offline Grace 3 ngày, định dạng ngày `DD/MM/YYYY`, lệnh `exit_application`, bật mặc định commercial guard).

### Checkpoint 1: Kiểm Tra Backend & Database
- [x] `cargo check` và `cargo test` trong `src-tauri` đạt 100% không lỗi/cảnh báo (29/29 unit tests + 1/1 live Supabase E2E test passed).

### Phase 3: Giao Diện Chặn Khởi Động & Quản Lý Key Trong Cài Đặt
- [x] **TASK-04**: Cập nhật `src/services/license/licenseService.ts`, `src/components/modals/LicenseModal.tsx`, `src/App.tsx` và `src/views/SettingsWorkspace.tsx` (chặn khởi động bắt buộc giống Audio-Factory, bỏ nút "Để sau" lúc mở app, kích hoạt mục Đổi Key & Kiểm tra lại trong Cài đặt).

### Phase 4: Kiểm Thử Toàn Diện & Chạy Thử Thực Tế
- [x] **TASK-05**: Cập nhật & chạy toàn bộ unit test Frontend (`16/16 passed`), `tsc --noEmit` + `npm run build` (`0 errors`), `cargo test`, sau đó khởi chạy thực tế ứng dụng **VoxLab** (`tauri dev`) và kiểm chứng luồng chặn khởi động + kích hoạt Key thật trên Supabase.

## 4. Rủi Ro & Biện Pháp Giảm Thiểu
| Rủi ro | Mức độ | Biện pháp giảm thiểu |
| :--- | :--- | :--- |
| Lộ khóa trong Git | Cao | Lưu URL & anon key trong `.env.local` (git-ignored), kiểm tra `git status` & `git diff` trước khi hoàn tất. |
| Gọi PowerShell nhiều lần gây trễ TTS/ASR | Trung bình | Cache HWID trong `OnceLock` + đọc `MachineGuid` trực tiếp qua Win32 API `RegQueryValueExW` + lưu `device_profile.enc`. |
| Mất quyền dùng khi rớt mạng ngắn hạn | Trung bình | Offline Grace 3 ngày có kiểm tra chống lùi giờ hệ thống và khớp HWID. |
