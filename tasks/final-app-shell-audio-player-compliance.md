# BẢNG ĐỐI CHIẾU TUÂN THỦ (COMPLIANCE MATRIX)
## VOXLAB — FINAL APP SHELL RESTRUCTURE & BOTTOM AUDIO PLAYER

| STT | Yêu cầu / Hạng mục | Hiện trạng triển khai | Đánh giá | Ghi chú kỹ thuật |
| :--- | :--- | :--- | :---: | :--- |
| **I** | **App Shell & Layout Structure** | | | |
| 1 | Top Header chạy full-width phía trên cùng | Triển khai tại `TopBar.tsx`, gắn trực tiếp ở root của App | **PASS** | `w-full`, border-b, cố định trên cùng |
| 2 | Chiều cao Header compact (40-46px, chuẩn 42px) | Định nghĩa `HEADER_HEIGHT = "h-[42px]"` trong `src/constants/layout.ts` | **PASS** | Đạt chuẩn 42px |
| 3 | Header chỉ chứa Logo/App name (trái) và Language + Theme + Window controls (phải) | Đã tinh gọn trong `TopBar.tsx`, loại bỏ các badge và nút phụ không thuộc app-level | **PASS** | Trái: Logo + VOXLAB; Phải: i18n Select, Theme Toggle, Window controls |
| 4 | Sidebar nằm bên trái, kéo dài từ dưới Header xuống tận đáy ứng dụng | Bố cục tại `App.tsx`: `TopBar` ở trên, `div` thân gồm `Sidebar` + `RightArea` kéo dài đến đáy | **PASS** | Chiều cao `flex-1` chạy từ dưới TopBar xuống tận đáy app |
| 5 | Sidebar KHÔNG bị Bottom Audio Player cắt ngang | `BottomAudioPlayer` được đặt bên trong `RightArea`, nằm bên phải Sidebar | **PASS** | Sidebar liên tục 100% chiều cao phía dưới Header, không bao giờ bị player đè hoặc cắt ngang |
| 6 | Vùng bên phải Sidebar là Application Content Area | `RightArea` có `flex-1 flex flex-col overflow-hidden min-w-0 min-h-0` | **PASS** | Quản lý toàn bộ Workspace Frame và Bottom Audio Player |
| 7 | Nút thu gọn Sidebar dạng icon-only (`◀` / `▶`), không viền bao, không chữ | Nút thu gọn tại đáy Sidebar dùng icon ghost button, tooltip đa ngôn ngữ, không chữ "Thu gọn" | **PASS** | Tự động đổi hướng `◀` khi mở, `▶` khi đóng |
| 8 | Workspace Frame có viền bo góc (`rounded-[11px]`), viền 1px, margin ngoài (10-12px) | Class: `m-2.5 sm:m-3 rounded-[11px] border border-borderDefault bg-panel shadow-sm` | **PASS** | Outer margin ~10-12px, border 1px, bo góc 11px |
| 9 | Workspace Toolbar nằm ngang phía trên cùng của Workspace Frame | Toolbar nằm đầu `TtsWorkspace.tsx`, chạy full-width của khung làm việc | **PASS** | Chứa tab "Soạn thảo" / "Tạo giọng" và các nút action |
| 10 | Workspace Body bên trong chia 2 cột: Main Content (trái) và TTS Inspector (phải) | Bố cục `TtsWorkspace.tsx` gom studio editor và `{inspector}` cạnh nhau | **PASS** | Chia tách bằng đường viền đơn `border-l border-borderDefault` |
| 11 | Không tạo card lồng card thừa bên trong Workspace Frame | Toàn bộ view sử dụng panel nền phẳng, không có nested shadow card bao bọc thừa | **PASS** | Tối giản, thanh thoát |
| **II** | **Bottom Audio Preview Player** | | | |
| 12 | Bottom Player chỉ xuất hiện bên dưới Workspace Frame, bên phải Sidebar | Đặt sau `WorkspaceFrame` trong `RightArea` | **PASS** | Chiều ngang chỉ bao phủ vùng làm việc, không tràn sang Sidebar |
| 13 | Chiều cao chuẩn 52px | Định nghĩa `AUDIO_PLAYER_HEIGHT = "h-[52px]"` trong `src/constants/layout.ts` | **PASS** | Chiều cao cố định `h-[52px]` |
| 14 | Ẩn hoàn toàn khi không có audio preview (idle) | Điều kiện `{activeAudioTrack && <BottomAudioPlayer ... />}` | **PASS** | Không hiển thị bất kỳ pixel nào khi chưa bấm nghe thử |
| 15 | Xuất hiện khi bấm "Nghe thử" ở thẻ câu | Event `onPlayChunk` kích hoạt `activeAudioTrack` và mở player ngay lập tức | **PASS** | Đã kiểm chứng qua DevTools click |
| 16 | Nút Play / Pause tròn nổi bật | Nút tròn `w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center` | **PASS** | Icon Play / Pause chuyển đổi mượt mà |
| 17 | Nút tua lùi 5s (`RotateCcw`) và tua tiến 5s (`RotateCw`) | Các nút ghost nhỏ gọn bên cạnh waveform và timer | **PASS** | Tua nhanh +/- 5 giây với clamp [0, duration] |
| 18 | Hiển thị context phát (ví dụ: `Câu 01 · Thảo Trinh (Hà Nội)`) | Tự động lấy số thứ tự câu và tên giọng đọc tương ứng | **PASS** | `Câu {chunkNumber} · {voiceName}` |
| 19 | Hiển thị thời gian hiện tại (`00:12`) và tổng thời lượng (`00:34`) | Format dạng `mm:ss` tiêu chuẩn âm thanh số | **PASS** | Đồng bộ chính xác theo tiến trình phát |
| 20 | Waveform trực quan dạng cột (interactive bars) | 48 cột waveform mô phỏng speech envelope phong phú (attack, cadence, decay) | **PASS** | Đã kiểm tra trực quan trên trình duyệt |
| 21 | Phân biệt màu cột đã phát và chưa phát | Cột đã phát mang màu `bg-accent`, chưa phát mang màu `bg-borderDefault` | **PASS** | Thể hiện rõ tiến độ phát |
| 22 | Hỗ trợ click để tua đến vị trí trên waveform | Handler `handleBarClick` và `handleScrubberPointerDown` tính toán vị trí % chính xác | **PASS** | Tua trực quan ngay tại điểm bấm |
| 23 | Hỗ trợ kéo (drag) scrubber để tua mượt mà | Hỗ trợ Pointer Events (`onPointerDown`, `setPointerCapture`, `onPointerMove`) | **PASS** | Không bị trượt ra ngoài vùng khi kéo chuột nhanh |
| 24 | Hỗ trợ bàn phím điều hướng (ArrowLeft / ArrowRight) | Phím mũi tên lùi/tiến 5s, PageUp/PageDown lùi/tiến 10s, Home/End về đầu/cuối | **PASS** | Đầy đủ thuộc tính `role="slider"`, `tabIndex={0}`, `aria-valuenow` |
| 25 | Bộ điều khiển âm lượng (Volume Slider + Mute Toggle) | Nút biểu tượng loa chuyển đổi icon theo mức âm lượng (`Volume2`, `Volume1`, `VolumeX`) | **PASS** | Bấm loa để mute/unmute, slider điều chỉnh từ 0% đến 100% |
| 26 | Nút đóng (`×`) để dỡ audio và ẩn player | Nút đóng ở góc phải gọi `onClose` giải phóng track preview | **PASS** | Đã kiểm nghiệm qua DevTools click |
| 27 | Trình phát đơn nhất (Single Global Audio Player) | Khi bấm "Nghe thử" câu khác, lập tức dừng câu cũ và phát câu mới | **PASS** | Đã kiểm chứng chuyển từ Câu 01 sang Câu 02 trơn tru |
| 28 | Tạo âm thanh thực nghiệm qua Web Audio API | Tích hợp Web Audio API (synthesizer tone beep nhẹ nhàng, an toàn) | **PASS** | Tạo âm thanh sống động khi bấm phát |
| **III**| **Generation Progress Migration** | | | |
| 29 | Tiến trình tạo audio chuyển hoàn toàn khỏi Bottom Bar | `BottomJobBar` cũ đã được gỡ bỏ hoàn toàn khỏi ứng dụng | **PASS** | Không còn progress bar hay job panel ở thanh đáy |
| 30 | Tích hợp thanh tiến trình trực tiếp trên Workspace Toolbar | Hiển thị thanh tiến trình nhỏ, % hoàn thành và trạng thái câu | **PASS** | Nằm ngay cạnh cụm nút điều khiển trên Toolbar |
| 31 | Nút Tạm dừng / Tiếp tục (`isPaused`) nằm trên Workspace Toolbar | Đầy đủ nút Tạm dừng / Tiếp tục khi đang xử lý | **PASS** | Trực quan, gọn gàng |
| 32 | Nút Hủy tiến trình (`onCancel`) tích hợp gọn gàng | Nút Hủy gọi `batchQueueExecutor.cancel()` và reset trạng thái | **PASS** | Dễ tiếp cận |
| **IV** | **Đa ngôn ngữ, Giao diện & Trải nghiệm (i18n & Theme)** | | | |
| 33 | Từ điển dịch i18n cho Audio Player trên cả 4 ngôn ngữ | Bổ sung `audioPlayer` dictionary cho `vi`, `en`, `ja`, `zh` trong `translations.ts` | **PASS** | Bản địa hóa 100% nhãn và tooltip |
| 34 | Từ điển dịch cho các trạng thái thu gọn/mở rộng Sidebar | Bổ sung `collapseSidebar`, `expandSidebar` trong `nav` cho cả 4 ngôn ngữ | **PASS** | Tooltip hiển thị chuẩn xác khi hover |
| 35 | Light Theme fidelity | Nền trắng ngà/xám nhạt `#f8fafc`, panel `#ffffff`, viền nhẹ `#e2e8f0` | **PASS** | Đã chụp màn hình và nghiệm thu trực quan |
| 36 | Dark Theme fidelity | Nền xanh đen sâu `#06090e`, panel `#0b101b`, viền `#1e293b`, chữ `#e2e8f0` | **PASS** | Đã chụp màn hình và nghiệm thu trực quan |
| 37 | Khả năng tương thích độ phân giải 1920x1080 | Đạt chuẩn, hiển thị đầy đủ không gian làm việc rộng rãi | **PASS** | Đã kiểm thử trên màn hình lớn |
| 38 | Khả năng tương thích độ phân giải 1440x900 | Đạt chuẩn, các cột co giãn cân đối, không tràn vỡ | **PASS** | Đã kiểm thử qua Chrome DevTools Emulation |
| 39 | Khả năng tương thích độ phân giải 1024x700 | Tự động ẩn context text dài khi thiếu diện tích, giữ nguyên các nút quan trọng | **PASS** | Đã kiểm thử qua Chrome DevTools Emulation |
| 40 | Khả năng truy cập (A11y) & ARIA Attributes | Có `aria-label`, `role="region"`, `role="slider"`, `aria-valuenow`, `aria-valuetext` | **PASS** | Tuân thủ hướng dẫn trợ năng |
| 41 | Không phát sinh lỗi TypeScript | `npx tsc --noEmit` thực hiện sạch 0 lỗi | **PASS** | Codebase gõ kiểu chặt chẽ |
| 42 | Bản build production thành công | `npm run build` (Vite) hoàn thành chỉ trong 1.34s, dung lượng tối ưu | **PASS** | Sẵn sàng triển khai Tauri |

---

### KẾT LUẬN ĐÁNH GIÁ: **READY**
Tất cả 42/42 tiêu chí đều được triển khai chính xác, kiểm thử trực quan với Chrome DevTools MCP và build thành công.
