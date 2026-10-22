# Hướng Dẫn Đóng Gói Bản Cài Thử Nghiệm Windows (VoxLab Trial Build)

Tài liệu này mô tả cấu trúc đóng gói, cách biên dịch Frontend + Rust Tauri + Python Sidecar và danh sách kiểm tra trên máy sạch Windows.

---

## 1. Cấu trúc thư mục khi đóng gói

Khi triển khai bản cài đặt hoặc bản Portable trên Windows, `src-tauri/src/ai/sidecar.rs` (`resolve_packaged_runtime_from_dir`) tự động dò tìm Sidecar theo thứ tự ưu tiên sau:

1. **PyInstaller `--onedir` (Khuyến nghị cho PyTorch / CUDA / ONNX)**:
   - `<Thư mục cài đặt>\sidecar\voxlab-sidecar-core\voxlab-sidecar-core.exe`
   - `<Thư mục cài đặt>\sidecar\voxlab-sidecar-chatterbox\voxlab-sidecar-chatterbox.exe`
   - `<Thư mục cài đặt>\sidecar\voxlab-sidecar-qwen\voxlab-sidecar-qwen.exe`
   - *(Hoặc nằm trong `<Thư mục cài đặt>\resources\sidecar\...` khi đóng gói qua Tauri resources)*.
2. **Môi trường Python độc lập đi kèm (`Portable Venv`)**:
   - `<Thư mục cài đặt>\sidecar\.venv\Scripts\python.exe`
   - `<Thư mục cài đặt>\sidecar\.venv-chatterbox\Scripts\python.exe`
   - `<Thư mục cài đặt>\sidecar\.venv-qwen\Scripts\python.exe`
3. **Executable đơn lẻ (`--onefile`) cùng thư mục `voxlab.exe`**:
   - `<Thư mục cài đặt>\voxlab-sidecar-<runtime>.exe`

Mọi tiến trình Sidecar đều được truyền tham số `--runtime <core|chatterbox|qwen>` và khởi chạy ẩn cửa sổ console (`CREATE_NO_WINDOW`).

---

## 2. Thư mục dữ liệu người dùng và bảo mật (`%APPDATA%\com.voxlab.app`)

Ứng dụng lưu trữ toàn bộ dữ liệu người dùng và kho khóa mã hóa tại `%APPDATA%\com.voxlab.app`:

- `license.enc`: Bộ nhớ đệm bản quyền mã hóa bằng Windows DPAPI (`CryptProtectData`), ghi nguyên tử qua `MoveFileExW`.
- `gemini_keys.enc`: Kho khóa API Gemini mã hóa bằng Windows DPAPI.
- `history.json`: Lịch sử tác vụ đồng bộ qua hàng đợi tuần tự.
- `models\`: Thư mục chứa trọng số mô hình AI cục bộ (`OmniVoice`, `Chatterbox`, `Qwen-TTS`, `faster-whisper`).

---

## 3. Quy trình Build Bản Thử Nghiệm Windows

### Bước 1: Kiểm tra TypeScript, Frontend Build và Rust Tests
```powershell
npx tsc --noEmit
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

### Bước 2: Đóng gói các Runtime Sidecar (Tùy chọn cho bản cài đầy đủ)
```powershell
powershell -ExecutionPolicy Bypass -File .\sidecar\build_sidecars.ps1
```

### Bước 3: Đóng gói ứng dụng Tauri Windows (`.exe` / NSIS / MSI)
```powershell
npx tauri build
```
Tệp thực thi sau khi build nằm tại:
- `src-tauri\target\release\voxlab.exe`
- Bộ cài đặt NSIS/MSI nằm tại: `src-tauri\target\release\bundle\`

---

## 4. Danh sách kiểm tra trên máy sạch (Clean Machine Checklist)

- [ ] Mở `voxlab.exe` không báo lỗi thiếu DLL hoặc lỗi khởi tạo kho khóa `gemini_keys.enc`.
- [ ] Vào Cài đặt $\rightarrow$ Bản quyền: hiển thị đúng trạng thái kích hoạt, mã đã che (`VOXL-****-****-XXXX`), loại bản quyền và hạn dùng.
- [ ] Vào Cài đặt $\rightarrow$ Dịch thuật: thêm/sửa/xóa Gemini API Key, đóng/mở lại ứng dụng và vào thẳng tab **Lồng tiếng** hoặc **Batch** — khóa Gemini được nạp tự động.
- [ ] Kiểm tra kết nối máy chủ nội bộ (LM Studio / Ollama): khi máy chủ tắt, ứng dụng báo lỗi rõ ràng và **không** tự động gửi dữ liệu lên Google Translate.
- [ ] Chạy thử Lồng tiếng ở cả 2 chế độ:
  - `Bám sát phụ đề gốc (source_sync)`
  - `Thuyết minh tự do (free_narration)` (Xuất được kịch bản TXT đã dịch và tạo được SRT căn chỉnh theo audio mới).
