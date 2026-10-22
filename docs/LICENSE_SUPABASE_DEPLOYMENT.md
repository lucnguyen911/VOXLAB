# Hướng Dẫn Triển Khai & Quản Trị Hệ Thống License VoxLab trên Supabase

Tài liệu này hướng dẫn thiết lập cơ sở dữ liệu bản quyền cho **VoxLab** trên Supabase theo kiến trúc bảo mật tham chiếu từ `Audio-Factory` và đặc tả `SPEC-settings.md` (Mục 9).

---

## 1. Kiến trúc bảo mật

1. **Client chỉ giữ `SUPABASE_URL` và `SUPABASE_ANON_KEY` (Public Anon Key)**:
   - Tuyệt đối **không** nhúng `service_role` key vào mã nguồn Rust, React hay biến môi trường phía ứng dụng desktop.
2. **Row Level Security (RLS) khóa toàn bộ bảng**:
   - Hai bảng `public.licenses` và `public.license_devices` bật RLS và thu hồi (`REVOKE ALL`) toàn bộ quyền `SELECT / INSERT / UPDATE / DELETE` từ role `anon` và `authenticated`.
   - Người dùng cuối dù trích xuất được `SUPABASE_ANON_KEY` cũng không thể đọc danh sách key, không thể tự thêm key hoặc xóa thiết bị.
3. **Mọi thao tác đi qua hàm RPC duy nhất `public.activate_or_verify_license`**:
   - Chạy với `SECURITY DEFINER` và `SET search_path = public`.
   - Sử dụng khóa dòng `SELECT ... FOR UPDATE` để chống race condition khi nhiều thiết bị kích hoạt cùng một mã đồng thời.
4. **Lưu trữ cục bộ bằng Windows DPAPI (`license.enc`)**:
   - Mã hóa bằng `CryptProtectData` gắn với tài khoản Windows hiện tại.
   - Ghi tệp nguyên tử (`MoveFileExW` với `MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH`), không bao giờ xóa `license.enc` cũ trước khi tệp mới ghi xong.
   - Ràng buộc cứng với định danh phần cứng `HWID v1` (`SMBIOS UUID` hoặc `MachineGuid`, từ chối các chuỗi placeholder OEM và không dùng mã cố định dùng chung).

---

## 2. Các bước triển khai trên Supabase

1. Đăng nhập [Supabase Dashboard](https://supabase.com/dashboard) và chọn project dành cho VoxLab (khuyến nghị tách project riêng cho VoxLab, hoặc dùng chung project với cột `product_code = 'VOXLAB'`).
2. Mở **SQL Editor** $\rightarrow$ **New Query**.
3. Sao chép toàn bộ nội dung tệp [`sql/voxlab_license_setup.sql`](../sql/voxlab_license_setup.sql) và nhấn **Run**.
4. Vào **Project Settings** $\rightarrow$ **API** để lấy:
   - `Project URL` $\rightarrow$ cấu hình vào biến môi trường `VOXLAB_SUPABASE_URL`
   - `anon` `public` key $\rightarrow$ cấu hình vào biến môi trường `VOXLAB_SUPABASE_ANON_KEY`

---

## 3. Cấu hình biến môi trường khi chạy & đóng gói VoxLab

Trước khi chạy hoặc build bản cài thử nghiệm/thương mại:

```powershell
$env:VOXLAB_SUPABASE_URL = "https://<project-ref>.supabase.co"
$env:VOXLAB_SUPABASE_ANON_KEY = "<anon-public-key>"

# Tùy chọn (Sau khi phê duyệt Gate E để bật khóa thương mại bắt buộc):
$env:VOXLAB_ENFORCE_LICENSE = "1"
$env:VITE_VOXLAB_ENFORCE_LICENSE = "1"
```

---

## 4. Các lệnh SQL quản trị thường dùng

### 4.1. Tạo mã bản quyền vĩnh viễn (1 thiết bị)
```sql
INSERT INTO public.licenses (
    license_key,
    product_code,
    license_type,
    status,
    max_devices,
    expires_at,
    customer_note
) VALUES (
    'VOXL-PRO1-2026-ABCD',
    'VOXLAB',
    'Commercial Pro License',
    'active',
    1,
    NULL,
    'Khách hàng Nguyễn Văn A'
);
```

### 4.2. Tạo mã bản quyền có thời hạn (ví dụ 30 ngày)
```sql
INSERT INTO public.licenses (
    license_key,
    product_code,
    license_type,
    status,
    max_devices,
    expires_at,
    customer_note
) VALUES (
    'VOXL-TRIAL-30D-0001',
    'VOXLAB',
    'Trial 30 Days',
    'active',
    1,
    NOW() + INTERVAL '30 days',
    'Khách hàng dùng thử 30 ngày'
);
```

### 4.3. Đặt lại thiết bị (Reset HWID) khi khách đổi máy tính
```sql
DELETE FROM public.license_devices
WHERE license_id = (
    SELECT id FROM public.licenses WHERE license_key = 'VOXL-PRO1-2026-ABCD'
);
```

### 4.4. Vô hiệu hóa / thu hồi mã bản quyền
```sql
UPDATE public.licenses
SET status = 'disabled', updated_at = NOW()
WHERE license_key = 'VOXL-PRO1-2026-ABCD';
```
