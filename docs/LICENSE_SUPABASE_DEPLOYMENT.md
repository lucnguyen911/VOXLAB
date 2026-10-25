# Hướng Dẫn Triển Khai & Quản Trị Hệ Thống License VoxLab (Security v3)

Tài liệu này hướng dẫn kiến trúc và cách quản trị bảng bản quyền **VoxLab** trên Supabase (`MMO-TOOL-Manager`), đồng bộ 100% với chuẩn **Security v3** của `audio_licenses` và `video_licenses`.

---

## 1. Kiến trúc bảo mật (Security v3)

1. **Bảng đơn gọn sạch 10 cột (`public.voxlab_licenses`)**:
   - Đồng bộ hoàn toàn cấu trúc với `audio_licenses` và `video_licenses`: `id`, `license_key` (tự sinh `VOXLAB-XXXX-XXXX-XXXX-XXXX`), `is_active`, `max_devices`, `created_at`, `expired_at`, `customer_name`, `contact_info`, `note`, `device_hwids` (JSONB array).
2. **Row Level Security (RLS) & Khóa truy cập bảng trực tiếp**:
   - Bật RLS và thu hồi (`REVOKE ALL`) toàn bộ quyền đọc/ghi bảng `public.voxlab_licenses` khỏi role `anon` và `authenticated`.
   - Desktop client chỉ dùng `SUPABASE_URL` và `SUPABASE_ANON_KEY` (đọc từ `.env.local` lúc build/dev, không lưu cứng trong Git). Không bao giờ nhúng `service_role` key vào client.
3. **Xác thực nguyên tử qua RPC `public.activate_or_verify_voxlab_license_v3`**:
   - Thực thi với `SECURITY DEFINER`, `SET search_path = public, pg_temp` và khóa dòng `SELECT ... FOR UPDATE` chống race condition khi nhiều máy kích hoạt cùng lúc.
   - Hỗ trợ tự động nâng cấp định danh thiết bị cũ (`p_legacy_candidates` → `MIGRATED`) mà không tốn thêm slot thiết bị.
4. **Định danh phần cứng HWID v3 & Lưu trữ DPAPI cục bộ (`license.enc`)**:
   - Ưu tiên `SMBIOS UUID`, fallback sang `MachineGuid` (Win32 Registry API), lọc chuỗi OEM rác, băm một chiều `SHA-256` 64 ký tự hex (`HWID v3`) kèm `device_profile.enc` (`fallback_proof`).
   - Lưu cache cục bộ bằng **Windows DPAPI** (`CryptProtectData` + Entropy `VoxLab-License-v3`), ghi nguyên tử qua `MoveFileExW`.
   - Hỗ trợ **Offline Grace 3 ngày** khi rớt mạng/lỗi máy chủ 5xx, có kiểm tra chống quay ngược đồng hồ hệ thống và từ chối ngay không ân hạn nếu server đã khóa/hết hạn key.
   - Chặn bắt buộc ngay lúc khởi động ứng dụng (Mandatory Startup Gate) giống `Audio-Factory`.

---

## 2. Cấu hình môi trường (`.env.local`)

Tạo tệp `.env.local` tại thư mục gốc `Voxlab` (đã được `.gitignore` loại trừ khỏi Git) dựa trên `.env.example`:

```ini
VOXLAB_SUPABASE_URL=https://<project-ref>.supabase.co
VOXLAB_SUPABASE_ANON_KEY=<publishable-or-anon-key>
VOXLAB_ENFORCE_LICENSE=1
VITE_VOXLAB_ENFORCE_LICENSE=1
```

Khi chạy `npm run tauri dev` hoặc đóng gói `npx tauri build`, `src-tauri/build.rs` và Vite sẽ tự động nạp các biến từ `.env.local` mà không cần hard-code khóa vào mã nguồn.

---

## 3. Các lệnh SQL quản trị trên Supabase (`MMO-TOOL-Manager`)

### 3.1. Tạo License Key Vĩnh Viễn tự động (1 thiết bị)
```sql
INSERT INTO public.voxlab_licenses (customer_name, max_devices, is_active, expired_at, note)
VALUES ('Nguyễn Văn A', 1, true, NULL, 'Gói Vĩnh viễn')
RETURNING license_key, max_devices, expired_at;
```

### 3.2. Tạo License Key có thời hạn (ví dụ 30 ngày)
```sql
INSERT INTO public.voxlab_licenses (customer_name, max_devices, is_active, expired_at, note)
VALUES ('Khách hàng B', 1, true, NOW() + INTERVAL '30 days', 'Gói 30 ngày')
RETURNING license_key, max_devices, expired_at;
```

### 3.3. Reset thiết bị (HWID) khi khách đổi máy tính mới
```sql
SELECT public.admin_reset_voxlab_license_devices_v3('VOXLAB-XXXX-XXXX-XXXX-XXXX');
```

### 3.4. Khóa / Thu hồi License Key
```sql
UPDATE public.voxlab_licenses
SET is_active = false
WHERE license_key = 'VOXLAB-XXXX-XXXX-XXXX-XXXX';
```
