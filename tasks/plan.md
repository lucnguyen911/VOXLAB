# Kế Hoạch Triển Khai: Cài Đặt TTS Nâng Cao Toàn Cục (Global Advanced TTS Settings)

## 1. Mục Tiêu
Triển khai hệ thống **Cài đặt TTS nâng cao dùng chung toàn ứng dụng VoxLab** cho ba mô hình:
- OmniVoice
- Chatterbox Turbo
- Qwen3-TTS 1.7B Base

Cấu hình được thiết lập tại **Cài đặt → Mô hình → Cài đặt TTS nâng cao**, lưu bền vững trong App Data (`settings/tts_advanced.json`) và tự động áp dụng cho tất cả chức năng (TTS, Hội thoại, Batch, Dubbing, Voice Clone). Không yêu cầu người dùng thiết lập lại trong từng màn hình.

---

## 2. Kiến Trúc & Luồng Dữ Liệu

```
[SettingsWorkspace.tsx] (Cài đặt → Mô hình)
       │ (Lưu cấu hình)
       ▼
[ttsAdvancedSettings.ts] (Single Source of Truth, lưu App Data: settings/tts_advanced.json)
       │
       ├─────────────────────────────────┬─────────────────────────────────┐
       ▼                                 ▼                                 ▼
[LocalAiServices.ts]          [Batch Executors]                 [unifiedSynthesis.ts]
 (synthesize method)           (tts, dialogue, dubbing)          (TTS, Dialogue workspaces)
       │                       (đóng băng snapshot đầu job)                │
       └─────────────────────────────────┬─────────────────────────────────┘
                                         ▼
                               [Tauri IPC / Rust]
                                         │
                                         ▼
                           [Python Sidecar: TtsService]
                                         │
            ┌────────────────────────────┼────────────────────────────┐
            ▼                            ▼                            ▼
  [OmniVoiceAdapter]           [ChatterboxAdapter]           [QwenTtsAdapter]
  - num_step                   - temperature                 - temperature
  - guidance_scale             - top_p                       - top_p
  - denoise                    - top_k                       - top_k
  - position_temperature       - repetition_penalty          - repetition_penalty
  - class_temperature                                        - do_sample
  - postprocess_output                                       - x_vector_only_mode
            │                            │                            │
            ▼                            ▼                            ▼
     OmniVoice.generate        ChatterboxTurboTTS.generate   Qwen3TTS.generate_voice_clone
```

---

## 3. Chi Tiết Thông Số Từng Mô Hình

### 3.1. OmniVoice
- `num_step` (int, default: 32, range: 4 - 128)
- `guidance_scale` (float, default: 2.0, range: 1.0 - 10.0)
- `denoise` (bool, default: True)
- `position_temperature` (float, default: 5.0, range: 0.0 - 20.0)
- `class_temperature` (float, default: 0.0, range: 0.0 - 5.0)
- `postprocess_output` (bool, default: True)
- **Presets**:
  - *Ổn định*: `num_step=40`, `guidance_scale=2.5`, `denoise=true`, `position_temperature=3.0`, `class_temperature=0.0`, `postprocess_output=true`
  - *Cân bằng*: `num_step=32`, `guidance_scale=2.0`, `denoise=true`, `position_temperature=5.0`, `class_temperature=0.0`, `postprocess_output=true`
  - *Biểu cảm*: `num_step=32`, `guidance_scale=1.8`, `denoise=true`, `position_temperature=6.0`, `class_temperature=0.2`, `postprocess_output=true`

### 3.2. Chatterbox Turbo
- `temperature` (float, default: 0.8, range: 0.1 - 2.0)
- `top_p` (float, default: 0.95, range: 0.1 - 1.0)
- `top_k` (int, default: 1000, range: 10 - 2000)
- `repetition_penalty` (float, default: 1.2, range: 1.0 - 2.0)
- **Presets**:
  - *Ổn định*: `temperature=0.6`, `top_p=0.90`, `top_k=500`, `repetition_penalty=1.3`
  - *Cân bằng*: `temperature=0.8`, `top_p=0.95`, `top_k=1000`, `repetition_penalty=1.2`
  - *Biểu cảm*: `temperature=0.95`, `top_p=0.98`, `top_k=1500`, `repetition_penalty=1.15`

### 3.3. Qwen3-TTS 1.7B Base
- `temperature` (float, default: 0.9, range: 0.1 - 2.0)
- `top_p` (float, default: 1.0, range: 0.1 - 1.0)
- `top_k` (int, default: 50, range: 1 - 200)
- `repetition_penalty` (float, default: 1.05, range: 1.0 - 2.0)
- `do_sample` (bool, default: True)
- `x_vector_only_mode` (bool, default: False)
- **Presets**:
  - *Ổn định*: `temperature=0.7`, `top_p=0.95`, `top_k=30`, `repetition_penalty=1.15`, `do_sample=true`, `x_vector_only_mode=false`
  - *Cân bằng*: `temperature=0.9`, `top_p=1.0`, `top_k=50`, `repetition_penalty=1.05`, `do_sample=true`, `x_vector_only_mode=false`
  - *Biểu cảm*: `temperature=1.0`, `top_p=1.0`, `top_k=70`, `repetition_penalty=1.02`, `do_sample=true`, `x_vector_only_mode=false`

---

## 4. Các Giai Đoạn Triển Khai (Milestones)

- **Milestone 1: Backend Python Sidecar & Adapters**
  - Cập nhật `TtsService.synthesize` tiếp nhận `advancedSettings`.
  - Cập nhật `OmniVoiceAdapter`, `ChatterboxAdapter`, `QwenTtsAdapter` truyền đúng tham số thực tế.
  - Viết unit tests kiểm thử Python sidecar.

- **Milestone 2: Dịch Vụ Cài Đặt Toàn Cục & Áp Dụng Tự Động (Frontend / Core)**
  - Tạo `src/services/ai/ttsAdvancedSettings.ts` (kiểu dữ liệu, presets, sanitize, load/save App Data).
  - Kết nối vào `LocalAiServices.ts` và `batchRuntime.ts`.
  - Cập nhật các executor Batch (`ttsExecutor`, `dialogueExecutor`, `dubbingExecutor`) chụp snapshot cố định khi bắt đầu job.
  - Cập nhật `unifiedSynthesis.ts`.
  - Viết unit tests cho `ttsAdvancedSettings` và đường truyền tham số.

- **Milestone 3: Giao Diện Cài Đặt TTS Nâng Cao**
  - Trong `SettingsWorkspace.tsx` Tab 2 (Mô hình), thêm thẻ "Cài đặt TTS nâng cao".
  - 3 tab nhỏ cho 3 mô hình, lựa chọn preset (Ổn định, Cân bằng, Biểu cảm, Tùy chỉnh).
  - Thanh trượt, nút gạt, tooltip tiếng Việt, nút Khôi phục mặc định và Lưu cài đặt.
  - Giữ nguyên cấu trúc điều hướng Chung – Nhà cung cấp AI – Mô hình.

- **Milestone 4: Kiểm Thử Toàn Diện & Nghiệm Thu**
  - Chạy toàn bộ test suites TypeScript và Python.
  - Kiểm tra tsc compilation.
  - Tổng hợp báo cáo nghiệm thu theo các tiêu chí của người dùng.
