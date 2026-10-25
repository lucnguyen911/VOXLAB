# Danh Sách Công Việc: Bảo Mật & Bản Quyền VoxLab Security v3 (TODO.md)

## Phase 1: Cơ Sở Dữ Liệu Supabase (`MMO-TOOL-Manager`)
- [x] **TASK-01**: Viết chuẩn SQL v3 (`sql/voxlab_license_setup.sql`, `docs/LICENSE_SUPABASE_DEPLOYMENT.md`), chạy migration lên Supabase `MMO-TOOL-Manager` (`public.voxlab_licenses` + `activate_or_verify_voxlab_license_v3` + admin RPCs), tạo sẵn 1 License Key test và xác minh quyền RLS.

## Phase 2: Nâng Cấp Lõi Bảo Mật Rust (Security v3 + Build Config)
- [x] **TASK-02**: Thiết lập `.gitignore`, `.env.example`, `.env.local` và cập nhật `src-tauri/build.rs` nạp biến môi trường lúc biên dịch mà không hard-code secret vào source.
- [x] **TASK-03**: Nâng cấp `src-tauri/src/security/` (`device_identity.rs`, `license_storage.rs`, `license_client.rs`, `mod.rs`) và `src-tauri/src/lib.rs` lên chuẩn Security v3 (HWID v3 64-hex, Win32 Registry MachineGuid, `device_profile.enc` fallback proof, DPAPI entropy, Offline Grace 3 ngày, format ngày `DD/MM/YYYY`, command `exit_application`).
- [x] **CHECKPOINT-01**: Chạy `cargo test` & `cargo check` xác minh toàn bộ Rust backend biên dịch sạch và vượt qua các test bảo mật.

## Phase 3: Giao Diện Chặn Khởi Động & Cài Đặt Bản Quyền
- [x] **TASK-04**: Cập nhật `licenseService.ts`, `LicenseModal.tsx`, `App.tsx` (Mandatory Startup Gate chặn vào app khi chưa kích hoạt) và `SettingsWorkspace.tsx` (mở khóa khu vực Key bản quyền, hiển thị trạng thái/hạn dùng, nút Kiểm tra lại & Đổi key).

## Phase 4: Kiểm Thử Toàn Diện & Chạy Thử Thực Tế
- [x] **TASK-05**: Chạy `npx tsc --noEmit`, unit tests TypeScript, `cargo test` (bao gồm live E2E với Supabase), và khởi chạy ứng dụng VoxLab thực tế kiểm chứng luồng kích hoạt với Supabase `MMO-TOOL-Manager`.
