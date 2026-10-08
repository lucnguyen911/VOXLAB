# Danh Sách Công Việc: Cài Đặt TTS Nâng Cao Toàn Cục (TODO.md)

## Milestone 1: Backend Python Sidecar & TTS Adapters
- [x] **TASK-01**: Cập nhật `sidecar/voxlab_sidecar/tts/service.py` để nhận `advancedSettings` và chuyển tiếp an toàn vào `SynthesisRequest.extra`.
- [x] **TASK-02**: Cập nhật `sidecar/voxlab_sidecar/tts/omnivoice_adapter.py` để tiếp nhận `num_step`, `guidance_scale`, `denoise`, `position_temperature`, `class_temperature`, `postprocess_output` với giới hạn an toàn.
- [x] **TASK-03**: Cập nhật `sidecar/voxlab_sidecar/tts/chatterbox_adapter.py` để tiếp nhận `temperature`, `top_p`, `top_k`, `repetition_penalty` cho Chatterbox Turbo (loại bỏ cfg_weight/exaggeration không hỗ trợ).
- [x] **TASK-04**: Cập nhật `sidecar/voxlab_sidecar/tts/qwen_adapter.py` để tiếp nhận `temperature`, `top_p`, `top_k`, `repetition_penalty`, `do_sample`, `x_vector_only_mode`.
- [x] **TASK-05**: Viết unit test Python `sidecar/tests/test_tts_advanced.py` kiểm chứng adapter và service tiếp nhận, thẩm định và chuyển giao tham số.

## Milestone 2: Dịch Vụ Cài Đặt Toàn Cục & Kết Nối Tự Động
- [x] **TASK-06**: Tạo `src/services/ai/ttsAdvancedSettings.ts` (Types, Presets: Stable/Balanced/Expressive/Custom, Sanitize/Clamping, Storage bền vững App Data `settings/tts_advanced.json`, In-memory cache).
- [x] **TASK-07**: Tích hợp cấu hình nâng cao vào `src/services/ai/localAiServices.ts` (tự động gắn thông số theo engine nếu caller không truyền snapshot riêng) và `src/services/batch/batchRuntime.ts`.
- [x] **TASK-08**: Cập nhật `src/services/batch/executors/ttsExecutor.ts`, `dialogueExecutor.ts`, `dubbingExecutor.ts` để chụp snapshot cấu hình cố định tại đầu mỗi job.
- [x] **TASK-09**: Cập nhật `src/services/providers/unifiedSynthesis.ts` để đồng bộ cấu hình cho các màn hình đơn lẻ.
- [x] **TASK-10**: Viết unit test TypeScript `src/services/ai/__tests__/ttsAdvancedSettings.test.ts` và `ttsAdvancedPipeline.test.ts` kiểm chứng lưu trữ, khôi phục, snapshot isolation và đường truyền IPC.

## Milestone 3: Giao Diện Cài Đặt TTS Nâng Cao
- [x] **TASK-11**: Xây dựng UI khu vực "Cài đặt TTS nâng cao" trong `src/views/SettingsWorkspace.tsx` Tab Mô hình với 3 sub-tab (OmniVoice, Chatterbox Turbo, Qwen3-TTS 1.7B Base), các nút chọn Preset, Sliders/Switches, giải thích tiếng Việt, nút Khôi phục mặc định và nút Lưu cài đặt.

## Milestone 4: Kiểm Thử Toàn Diện & Nghiệm Thu
- [x] **TASK-12**: Chạy kiểm thử tự động toàn diện (Python unittest + Node test runner), kiểm tra kiểu TypeScript (`tsc --noEmit`), xác minh không lỗi lầm.
- [x] **TASK-13**: Báo cáo nghiệm thu chi tiết đầy đủ 5 nội dung bắt buộc.
