# Kế Hoạch Phát Hành, Kiểm Định Production & Phục Hồi Sự Cố (`RELEASE.md`)

**Sản phẩm**: VoxLab Desktop (`com.voxlab.app`)  
**Phiên bản**: `1.0.0` (Commercial GA — Zero-Python AI Bootstrap, Security v3.1 & Acoustic Cohesion v3.8)  
**Nền tảng mục tiêu**: Windows 10 / 11 64-bit (`x86_64-pc-windows-msvc`)  

---

## 1. Cấu Trúc Đóng Gói Phát Hành (Release Artifacts)

1. **Tệp thực thi chính (Hardened Rust Tauri Host)**:
   - Đường dẫn build: `src-tauri/target/release/voxlab.exe`
   - Cấu hình bảo mật: Strip symbols (`strip = "symbols"`), LTO (`lto = true`), `panic = "abort"`, mã hóa chuỗi đa hình lúc biên dịch (`build.rs` + `security/obf.rs`), khóa toàn bộ biến môi trường bypass ở chế độ Release.
2. **Các cụm Python AI Sidecar đóng gói độc lập (`--onedir`, bọc PyArmor)**:
   - `src-tauri/target/release/sidecar/voxlab-sidecar-core/voxlab-sidecar-core.exe` (ASR `faster-whisper`, OmniVoice, Edge-TTS `7.3.1`, Audio Assembly, Post-QC).
   - `src-tauri/target/release/sidecar/voxlab-sidecar-chatterbox/voxlab-sidecar-chatterbox.exe` (Chatterbox Turbo TTS).
   - `src-tauri/target/release/sidecar/voxlab-sidecar-qwen/voxlab-sidecar-qwen.exe` (Qwen3-TTS 1.7B).
   - Toàn bộ 15 module bảo mật/giao thức/engine bắt buộc đều được mã hóa bằng **PyArmor** và yêu cầu bắt tay xác thực 2 chiều `HMAC-SHA256` (`system.authenticate`) với tiến trình cha `voxlab.exe`.
3. **Bộ cài đặt phân phối Windows (Installers)**:
   - **NSIS Setup**: `src-tauri/target/release/bundle/nsis/VoxLab_1.0.0_x64-setup.exe`
   - **WiX MSI**: `src-tauri/target/release/bundle/msi/VoxLab_1.0.0_x64_en-US.msi`

---

## 2. Ranh Giới Bảo Toàn Dữ Liệu Khi Cài Đặt / Nâng Cấp / Gỡ Cài Đặt

Tuân thủ Mục 3.3 của `SPEC.md`:
- **Thư mục cài đặt ứng dụng (`%LOCALAPPDATA%\VoxLab` hoặc `C:\Program Files\VoxLab`)**:
  - Chỉ chứa `voxlab.exe`, thư mục `sidecar/` và tài nguyên tĩnh. Được phép ghi đè khi nâng cấp phiên bản.
- **Thư mục dữ liệu người dùng (`%APPDATA%\com.voxlab.app`) — BẮT BUỘC BẢO TOÀN 100%**:
  - `license.enc` & `device_profile.enc` (bộ nhớ đệm bản quyền DPAPI + HMAC).
  - `gemini_keys.enc` (kho khóa API Gemini mã hóa DPAPI + HMAC).
  - `voices/samples/` & `voices/cloned/` (tài sản giọng mẫu Local & giọng Clone của người dùng).
  - `models/` (các mô hình AI `faster-whisper`, `omnivoice`, `chatterbox_turbo`, `qwen_tts_1_7b` đã tải về).
  - `history/` & cấu hình người dùng.
  - Quá trình cài đè bản mới (Upgrade) tuyệt đối không xóa hoặc reset bất kỳ tệp nào trong `%APPDATA%\com.voxlab.app`.

---

## 3. Kế Hoạch Rollback & Phục Hồi Sự Cố (Rollback / Recovery Plan)

### 3.1 Điều Kiện Kích Hoạt Rollback (Trigger Conditions)
- Phát hiện lỗi khởi động (`Startup Crash`) hoặc lỗi xác thực Sidecar (`SIDECAR_SPAWN_FAILED` / `UNAUTHORIZED_HOST`) trên máy người dùng cuối.
- Phát hiện lỗi tương thích DPAPI vault hoặc lỗi hồi quy nghiêm trọng trong quá trình xuất Master Audio WAV / SRT.

### 3.2 Quy Trình Rollback Về Phiên Bản Trước (< 5 phút)
1. **Phía Phân phối**:
   - Thu hồi gói cài đặt bị ảnh hưởng và phát hành lại bộ cài đặt ổn định liền kề trước đó (`VoxLab_<prev>_x64-setup.exe`).
   - Do cấu trúc tệp trong `%APPDATA%\com.voxlab.app` (`license.enc`, `gemini_keys.enc`, `models/`, `voices/`) giữ tương thích ngược 100%, người dùng cài lại bản trước không bị mất bản quyền, không phải nhập lại Gemini API Key và không phải tải lại model AI.
2. **Phía Mã nguồn (Git)**:
   - Thực hiện `git revert <commit-sha>` trên nhánh phát hành, chạy lại bộ kiểm thử (`tsc --noEmit`, 913 Frontend tests, 222 Python tests, 35 Rust tests) và đóng gói lại qua `sidecar/build_sidecars.ps1` + `npx tauri build`.

### 3.3 Phục Hồi Khi Xung Đột VRAM Hoặc Hỏng Cache Cục Bộ
- **Tranh chấp VRAM (GPU OOM khi chạy TTS + ASR)**: Hệ thống tự động giải phóng model trên GPU (`torch.cuda.empty_cache()`) và chuyển ASR hậu kiểm sang `CPU (int8)` mà không làm gián đoạn phiên làm việc.
- **Hỏng tệp tạm trong `scratch/`**: Thư mục `%APPDATA%\com.voxlab.app\scratch` hoàn toàn tách biệt với dữ liệu bền vững; có thể xóa sạch thông qua mục **Cài đặt → Lưu trữ & Bộ nhớ đệm → Xóa bộ nhớ đệm** mà không ảnh hưởng đến Lịch sử, Voice Library hay file đã xuất.
