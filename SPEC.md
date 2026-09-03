# VoxLab — Product & Technical Specification (SPEC.md)

**Document Version**: 2.1.0 (Refined Specification)  
**Phase**: Phase 3 — Specification (GATE B)  
**Status**: Pending User Approval  
**Target Platform**: Windows 10/11 64-bit (x64)  
**Core Stack**: Tauri v2 (Rust) + React 19 + TypeScript + Vite  

---

## 1. Goal & Product Vision

VoxLab là ứng dụng desktop Windows local-first, chuyên biệt cho việc tạo giọng đọc kịch bản dài (Long-form TTS) với khả năng kiểm soát chất lượng chi tiết từng câu, tạo và quản lý mẫu giọng (Voice Cloning & Voice Library), cùng công cụ bóc băng âm thanh/video (ASR) độc lập, hoạt động 100% trên phần cứng máy tính người dùng mà không phụ thuộc vào cloud hay dịch vụ bên ngoài.

### Mục tiêu cốt lõi của phiên bản MVP:
1. **Long-form TTS Studio**: Cung cấp quy trình khép kín: Nhập kịch bản $\rightarrow$ Chuẩn hóa tất định an toàn $\rightarrow$ Tùy chọn AI hỗ trợ (sửa dấu câu, tối ưu, dịch có kiểm soát và đảo ngược được) $\rightarrow$ Phân đoạn thông minh theo profile model $\rightarrow$ Sinh giọng nói có cache từng câu $\rightarrow$ Ghép audio thành phẩm (WAV/MP3).
2. **Voice Clone & Voice Library**: Không gian tạo giọng mẫu riêng biệt từ reference audio ngắn và thư viện quản lý giọng đã lưu có gắn tag, tìm kiếm, cùng cầu nối trực tiếp sang TTS Studio.
3. **Standalone Transcription**: Nhập media $\rightarrow$ Bóc băng bằng Whisper-family local engine với nhận diện ngôn ngữ tự động $\rightarrow$ Xem plain text và timestamped segments $\rightarrow$ Xuất file `.txt` và `.srt` $\rightarrow$ Cầu nối *"Chuyển sang TTS"* để tạo voiceover mới mà không làm thay đổi transcript gốc.
4. **An toàn, Ổn định & Riêng tư**: Strict Local-Only (không cloud fallback, không telemetry); Worker crash không làm sập giao diện; thu hồi tài nguyên (VRAM/RAM) sạch sẽ khi hủy; bảo toàn văn bản gốc (Original Text Safety).

---

## 2. Target User & Use Cases

### 2.1 Đối tượng người dùng
- **Content Creators / Video Makers**: Cần tạo voiceover kịch bản dài, chất lượng cao, clone giọng đặc trưng, cần sửa lại các câu bị đọc vấp mà không phải sinh lại toàn bộ bài.
- **Audiobook Creators / Podcasters**: Cần đọc sách, truyện, tài liệu dài với giọng đọc tự nhiên, quản lý nhiều giọng nhân vật theo tags, có khoảng lặng phù hợp giữa các đoạn.
- **Researchers / Transcribers**: Cần bóc băng phỏng vấn, bài giảng, video ghi âm nội bộ để trích xuất text/subtitle hoàn toàn bảo mật tại máy.

### 2.2 Các kịch bản sử dụng chính (Use Cases)
- **UC-01 (Tạo Voiceover kịch bản dài)**: Người dùng nhập văn bản dài $\rightarrow$ Bấm Chuẩn hóa text $\rightarrow$ Bấm Chia chunk $\rightarrow$ Chọn Model & Giọng từ Library $\rightarrow$ Bấm Sinh toàn bộ $\rightarrow$ Nghe thử phát hiện câu #15 đọc vấp $\rightarrow$ Sửa lại chữ ở câu #15 $\rightarrow$ Bấm Retry riêng câu #15 $\rightarrow$ Bấm Ghép & Xuất file audio tổng.
- **UC-02 (Tạo và Tái sử dụng Voice Profile)**: Người dùng vào workspace *Voice Clone* $\rightarrow$ Nạp file âm thanh mẫu $\rightarrow$ Chọn model hỗ trợ clone $\rightarrow$ Nhập câu test và nghe thử preview $\rightarrow$ Đặt tên "Minh Documentary", gắn tags `[Nam, Kể chuyện]` $\rightarrow$ Bấm Lưu vào *Voice Library*. Tại Voice Library, bấm *"Use in TTS"* $\rightarrow$ Hệ thống chuyển sang TTS Studio và đặt giọng này làm giọng chính.
- **UC-03 (AI Hỗ trợ sửa dấu câu an toàn)**: Người dùng có đoạn text thiếu dấu câu $\rightarrow$ Bấm "AI Punctuation" $\rightarrow$ Hệ thống gửi prompt tới Local LLM $\rightarrow$ Hiện màn hình so sánh Before/After Diff $\rightarrow$ Kiểm tra guardrail từ vựng không bị thay đổi $\rightarrow$ Bấm "Chấp nhận" để cập nhật vào working text.
- **UC-04 (Bóc băng & Lồng tiếng lại - Re-voice)**: Người dùng nạp video bài giảng $\rightarrow$ Whisper tự động nhận diện ngôn ngữ và bóc băng ra text $\rightarrow$ Bấm "Chuyển sang TTS" $\rightarrow$ Văn bản được nạp sang TTS Studio làm kịch bản mới $\rightarrow$ Tạo giọng đọc mới.

---

## 3. High-Level Architecture & Boundaries

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                               REACT FRONTEND                                    │
│  - Presentation, UI State, Web Audio API Playback & Waveform Data In-Memory    │
│  - Zero shell calls, Zero direct model runtime calls, Zero raw FS operations   │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │ Tauri IPC (Typed Commands & Events)
┌──────────────────────────────────────▼──────────────────────────────────────────┐
│                           TAURI / RUST BACKEND LAYER                            │
│  - Process Supervisor & Worker Lifecycle Management (Start / Kill / Health)    │
│  - Hardware Detection (NVIDIA NVML / CUDA / VRAM / CPU cores / RAM)            │
│  - Job Queue Orchestrator (Safe-by-default, Concurrency = 1 in MVP)            │
│  - Local File I/O (Safe path resolution, Staging, Audio stitching via FFmpeg)  │
│  - SQLite Database Manager (Settings, Voice Profiles, Sessions/History)        │
└───────────────────┬─────────────────────────────────────────┬───────────────────┘
                    │ Documented & Versioned IPC Interface     │ HTTP Local Client
┌───────────────────▼─────────────────────┐ ┌─────────────────▼───────────────────┐
│       ISOLATED MODEL WORKERS            │ │        LOCAL LLM ENDPOINT           │
│  - Subprocess runtime (Python/C++)      │ │  - LM Studio / Local OpenAI API      │
│  - TTS Engine Adapter (Candidate set)   │ │  - Configurable URL (e.g. 127.0.0.1) │
│  - Whisper Engine Adapter (faster-wh.)  │ │  - Punctuation, Polish, Translation  │
│  - Capability & Version Handshake       │ │                                     │
└─────────────────────────────────────────┘ └─────────────────────────────────────┘
```

### Ranh giới kiến trúc & Nguyên tắc kết nối:
- **Frontend (React)**: Quản lý giao diện, trạng thái tương tác và playback Web Audio API in-memory. Tuyệt đối không chạy lệnh shell, không trực tiếp điều khiển runtime Python/C++, không thực hiện thao tác file system không giới hạn.
- **Backend (Tauri / Rust)**: Giữ toàn quyền điều phối tiến trình con, kiểm tra phần cứng, quản lý hàng đợi an toàn, truy xuất hệ thống file (đã sanitize đường dẫn) và quản trị cơ sở dữ liệu SQLite.
- **Model Worker Interface**:
  - Model runtimes chạy trong các tiến trình con riêng biệt được giám sát bởi Rust.
  - Giao tiếp giữa Rust và model worker phải có tài liệu (documented), có phiên bản (versioned), và có khả năng kiểm thử độc lập.
  - Mỗi worker khi khởi động phải thực hiện **Capability & Version Handshake**: Khai báo rõ các tính năng hỗ trợ (voice cloning, streaming, emotion/style, languages) và phiên bản giao thức. Nếu không tương thích, hệ thống báo lỗi tường minh, không để xảy ra silent failure.
  - *Lưu ý*: Giao thức truyền tải cụ thể (stdio JSON-RPC, localhost socket, v.v.) sẽ được xác định trong giai đoạn Model Feasibility và Plan, không khóa cứng tại SPEC.

---

## 4. Navigation & Workspace Specifications

Ứng dụng tuân thủ mô hình điều hướng phân tầng rõ ràng:
- **Left Navigation**: Chia tách thành **Primary Workspaces** (tác vụ chính) và **Utility** (công cụ & cài đặt).
- **Center Workspace**: Khu vực hiển thị và tương tác dữ liệu chính.
- **Right Contextual Inspector**: Bảng tùy chỉnh tham số phụ thuộc theo ngữ cảnh đối tượng đang chọn.
- **Bottom Job Bar**: Thanh tiến độ và điều khiển hàng đợi cố định dưới đáy.

### 4.1 Cấu trúc Navigation bên trái (Left Sidebar)
Sidebar hỗ trợ thu gọn (collapsible) để mở rộng không gian làm việc khi cần tập trung:
* **PRIMARY WORKSPACES**:
  1. `Text to Speech` (Không gian TTS kịch bản dài)
  2. `Voice Clone` (Không gian tạo giọng mẫu mới)
  3. `Voice Library` (Không gian quản lý và tái sử dụng giọng)
  4. `Transcription` (Không gian bóc băng âm thanh/video)
* **UTILITY**:
  5. `History` (Lịch sử các phiên xử lý gần đây)
  6. `Settings` (Cài đặt hệ thống toàn diện)

> **Ranh giới dứt khoát**: Không có khái niệm `Project` hoặc `Project Management` trong MVP. VoxLab MVP vận hành hoàn toàn dựa trên mô hình **Task/Session-based + History + Cache/Recovery**. Không thiết kế cây thư mục project, project asset manager hay project-level binding.

---

### 4.2 Chi tiết các Workspace chính

#### 4.2.1 Workspace 1: Text to Speech (Adaptive Workspace)
Tuân theo nguyên tắc: **Text to Speech = USE**. Không gánh trách nhiệm tạo clone voice phức tạp (đã chuyển sang Workspace Voice Clone).
* **Giai đoạn 1: Chuẩn bị Text (Text Preparation View)**:
  * Hiển thị song song: `Original Text` (luôn bảo toàn) và `Working Text` (văn bản đang biên tập).
  * Các nút hành động: `[Chuẩn hóa Text]`, `[AI Sửa dấu câu]`, `[AI Tối ưu]`, `[AI Dịch]`, `[Khôi phục bản gốc (Restore Original)]`.
  * Nút chuyển giai đoạn: `[Phân đoạn thông minh ➔]`.
* **Giai đoạn 2: Chunk Studio View**:
  * Thanh tổng quan: Tổng số chunk, ký tự, nút `[Sinh toàn bộ]`, `[Ghép & Xuất audio]`.
  * Danh sách thẻ Chunk (Chunk Cards):
    * Số thứ tự (`#001`), số ký tự.
    * Trạng thái: `Pending`, `Generating`, `Ready`, `Failed`, `Modified`.
    * Text câu (click để sửa).
    * Nút `[Nghe thử]`, nút `[Tạo lại riêng câu này]`.
    * Khoảng lặng sau câu (`Pause after: Auto` hoặc override ms).
* **Right Contextual Inspector**:
  * *Khi không chọn chunk*: Hiển thị cấu hình Global: Model TTS, Voice Selector (lấy nguồn từ Voice Library, có nút mở nhanh Library), Ngôn ngữ, Tốc độ (Speed), Sắc thái (Emotion/Style - nếu model hỗ trợ), Khoảng lặng mặc định.
  * *Khi chọn Chunk #17*: Hiển thị cấu hình riêng cho Chunk #17: Giọng đọc (`Kế thừa Global` hoặc override), Sắc thái (`Kế thừa Global` hoặc override), Khoảng lặng trước/sau câu #17, Nút `[Reset về mặc định Global]`.

#### 4.2.2 Workspace 2: Voice Clone (Dedicated Workspace)
Tuân theo nguyên tắc: **Voice Clone = CREATE**. Tách biệt hoàn toàn khỏi TTS Inspector.
* **Quy trình tạo Voice Profile**:
  1. **Nạp Reference Audio**: Dropzone kéo thả file âm thanh mẫu (.wav, .mp3...), kiểm tra tính hợp lệ và thời lượng tối thiểu.
  2. **Chọn Model hỗ trợ Clone**: Dropdown lọc chỉ các model có capability voice cloning.
  3. **Cấu hình tham số clone**: Hiển thị các tham số được model hỗ trợ (giao diện capability-aware; tham số không hỗ trợ sẽ bị ẩn hoặc disabled có giải thích rõ).
  4. **Nhập Test Text & Generate Preview**: Nhập câu mẫu ngắn, bấm sinh thử để kiểm tra chất lượng giọng clone trước khi lưu.
  5. **Nghe Preview**: Trình phát audio nhỏ nghe thử kết quả clone.
  6. **Đặt tên & Gắn Tag**:
     * Ô nhập Display Name (ví dụ: "Minh Documentary").
     * Ô nhập/chọn Tags (ví dụ: `[Nam]`, `[Kể chuyện]`, `[Trầm ấm]`).
  7. **Lưu Profile**: Bấm `[Lưu vào Voice Library]`, tạo thành một Voice Profile tái sử dụng được với định danh bền vững (stable identity).
* *Lưu ý*: Độ dài reference audio tối ưu và các siêu tham số suy luận (temperature, top_p, seed, CFG) được đánh dấu `TUNING REQUIRED`, không chốt cứng tại SPEC.

#### 4.2.3 Workspace 3: Voice Library (Dedicated Workspace)
Tuân theo nguyên tắc: **Voice Library = MANAGE**. Quản lý tập trung toàn bộ giọng đã lưu.
* **Chức năng bắt buộc (MVP)**:
  * **Danh sách giọng (Voice Cards/Rows)**: Hiển thị Display Name, Tags, Model tạo, Ngôn ngữ, Loại giọng (Clone / Preset).
  * **Nghe thử (Preview)**: Bấm nghe lại file audio preview đã lưu khi tạo profile.
  * **Tìm kiếm & Lọc (Search & Filter)**:
    * Ô tìm kiếm theo tên (Search by Name).
    * Bộ lọc theo Tag (Filter by Tag).
    * *(Tùy chọn hiển thị lọc theo Model / Ngôn ngữ nếu metadata có sẵn).*
  * **Quản trị Profile**:
    * Đổi tên (Rename) mà không làm đổi stable identity.
    * Thêm / Bớt / Sửa Tags.
    * Xóa giọng (Delete Voice) với cảnh báo an toàn (chi tiết tại mục 7.2).
  * **Cầu nối "Use in TTS"**: Bấm một chạm để chuyển ngay sang workspace Text to Speech và đặt profile này làm Active Voice của phiên làm việc.
* *Ranh giới MVP*: Không làm hệ thống quản lý thư mục đa tầng (folder hierarchy), không chia sẻ cloud, không marketplace.

#### 4.2.4 Workspace 4: Transcription (Standalone Workspace)
* Nạp file audio/video $\rightarrow$ Whisper local engine bóc băng với **Automatic Language Detection (MUST HAVE)**.
* Hiển thị kết quả linh hoạt: `Plain Text View` và `Segments View` (có timestamp `Start - End`).
* Nút xuất file: `[Xuất file .TXT]` và `[Xuất file .SRT]`.
* Nút *"Chuyển sang TTS"*: Đưa toàn bộ plain transcript text sang tab Text to Speech làm working text mới; transcript gốc giữ nguyên.

#### 4.2.5 Workspace 5: History (Utility)
* Hiển thị danh sách các phiên xử lý (sessions/tasks) gần đây kèm thời gian, tác vụ (TTS / Transcribe), số chunk, trạng thái.
* Hành động:
  * `[Mở lại (Reopen/Resume)]`: Nạp lại dữ liệu phiên nếu dữ liệu phiên và cache còn hợp lệ.
  * `[Mở thư mục output]`: Mở thư mục chứa file thành phẩm nếu file còn tồn tại.
  * `[Xóa lịch sử]`: Xóa bản ghi lịch sử khỏi danh sách (không tự động xóa file thành phẩm trên đĩa).

#### 4.2.6 Workspace 6: Settings (Utility — 7 Nhóm chức năng)
Bao gồm 7 nhóm cấu hình được phân định rõ ràng (chi tiết tại mục 8).

### 4.3 Bottom Job Bar (Thanh tiến độ cố định)
* Cố định ở chân cửa sổ:
  * Thông tin tác vụ: Model đang chạy, tiến độ hoàn thành (ví dụ: `Chunk 23/84 (27%)`).
  * Thanh tiến độ trực quan.
  * Nút `[Tạm dừng (Pause)]`, `[Hủy bỏ (Cancel)]`, `[Mở thư mục output]`.
  * Thông báo khi hoàn tất: `Đã sinh xong 84/84 chunks`.

---

## 5. Text Processing Pipeline Specification

```
[Văn bản gốc (Original Source)]
           │
           ▼ (Paste / Import)
[Deterministic Normalization] ──(Bảo vệ Protected Spans)
           │
           ▼
   [Working Text] <──────────────────────────────┐
     │          │                                │ (Reject AI Revision:
     │          ├──────────────┐                 │  quay lại Working Text)
     ▼          ▼              ▼                 │
[AI Punct.] [AI Optimize] [AI Translate]        │
     │          │              │                 │
     └──────────┴──────────────┴───► [AI Revision View]
                                            │
                                            ├──► [Accept] ──► Cập nhật Working Text
                                            └──► [Reject]
                                            
   * [Restore Original] ──► Khôi phục 100% về [Original Source] ban đầu
```

### 5.1 Deterministic Text Normalization
Chỉ thực hiện các biến đổi an toàn về mặt hình thức bằng thuật toán tất định, **không làm thay đổi semantic content**:
1. Unicode Normalization Form C (NFC) chuẩn cho tiếng Việt và tiếng Anh.
2. Tối ưu khoảng trắng: Gom các dấu cách liên tiếp thành 1, xóa khoảng trắng đầu dòng/cuối dòng.
3. Chuẩn hóa ngắt dòng: Tối đa 2 dấu xuống dòng liên tiếp.
4. Chuẩn hóa ngoặc kép chuẩn `""`, dấu gạch ngang chuẩn `-`.
5. Chuẩn hóa khoảng cách quanh dấu câu theo nguyên tắc **Bảo vệ Protected Spans**:
   * *Nguyên tắc thông thường*: Không có khoảng cách trước dấu câu (`,`, `.`, `!`, `?`, `;`, `:`), có 1 khoảng cách sau dấu câu.
   * *Bảo vệ Protected Spans (Không phá vỡ)*:
     * Số thập phân: `3.14`, `12,5`.
     * Mốc thời gian: `10:30`, `14:00:15`.
     * Tên miền & URL: `example.com`, `https://domain.vn/path`.
     * Địa chỉ Email: `user@example.com`.
     * Từ viết tắt & định danh: `TP.HCM`, `v2.0`, `127.0.0.1`, `file_01.wav`.
* *Ranh giới dứt khoát*: Không tự ý thêm dấu chấm/phẩy mới vào giữa câu; việc thêm dấu câu hoặc ngắt nghỉ ngữ nghĩa thuộc phạm vi của AI Punctuation.

### 5.2 AI Text Assistance & Guardrails
- **Cơ chế**: Gửi yêu cầu qua HTTP client tới OpenAI-compatible local endpoint do Rust làm trung gian.
- **AI Punctuation Contract**:
  - Yêu cầu: Khôi phục dấu câu và ngắt nghỉ mà **bảo toàn nguyên vẹn từ vựng (lexical content)**.
  - **Lexical Guardrail**: Hệ thống thực hiện so khớp từ vựng giữa văn bản đầu vào và kết quả AI trả về. Nếu phát hiện thay đổi ngoài phạm vi dấu câu $\rightarrow$ Gắn cờ cảnh báo (Lexical Change Flag), hiển thị chi tiết trong Diff View và ngăn chặn hành vi silent auto-apply.
- **AI Optimize for TTS & AI Translation**:
  - Optimize for TTS có thể thay đổi cấu trúc câu cho giọng đọc tự nhiên $\rightarrow$ Mặc định bắt buộc Review/Diff trước khi áp dụng.
  - Translation giữ source text và translated text riêng biệt $\rightarrow$ Mặc định bắt buộc Review/Accept trước khi đưa sang TTS.
- **Auto-apply Policy**: Cho phép người dùng bật Auto-apply riêng theo từng thao tác trong Settings (mặc định luôn là *Review before Apply*). Khi bật Auto-apply, văn bản gốc vẫn được bảo toàn và có thể khôi phục (Restore Original).

### 5.3 Semantics phân biệt giữa Revert và Restore
- **Reject AI Revision**: Hủy bỏ kết quả của thao tác AI vừa chạy, quay về trạng thái `Working Text` ngay trước đó.
- **Restore Original**: Hủy bỏ toàn bộ mọi sửa đổi, đưa văn bản quay trở lại 100% trạng thái `Original Source` ban đầu.
- *(Hai hành vi này được biểu diễn bằng 2 trạng thái và nút bấm riêng biệt, không gộp làm một)*.

### 5.4 Smart Chunking (Phân đoạn thông minh)
Phân đoạn văn bản theo thứ tự ưu tiên giảm dần:
1. **Ưu tiên 1 (Section / Paragraph)**: Ranh giới đoạn văn (2 dấu xuống dòng liên tiếp).
2. **Ưu tiên 2 (Complete Sentence)**: Ranh giới kết thúc câu (`.`, `!`, `?`, `\n`) không thuộc protected spans.
3. **Ưu tiên 3 (Clause / Secondary Punctuation)**: Ranh giới vế câu (`,`, `;`, `:`, `—`) khi câu quá dài vượt ngưỡng target của model.
4. **Ưu tiên 4 (Safe Fallback)**: Cắt tại khoảng trắng gần nhất khi câu không có dấu ngắt phụ và chạm ngưỡng trần an toàn của model.
- **Bảo vệ Protected Spans**: Không bao giờ cắt ngang một số thập phân, URL, email, từ viết tắt hay timestamp.
- **Model Profile Awareness**: Ngưỡng độ dài chunk (min, target, max) được cấu hình theo từng profile model TTS cụ thể, không áp đặt một giới hạn chung. Các giá trị này được đánh dấu `TUNING REQUIRED`.

---

## 6. TTS Generation, Caching & Resilience

### 6.1 Chunk Generation & Progressive Availability
- Hệ thống xử lý hàng đợi tuần tự (Concurrency = 1 trong MVP).
- **Chunk-level Progressive Availability**: Ngay khi một chunk sinh xong:
  - Cập nhật trạng thái thẻ chunk trên UI thành `Ready`.
  - Kích hoạt nút nghe thử (Preview) ngay cho chunk đó.
  - Không bắt buộc người dùng phải chờ toàn bộ bài đọc sinh xong mới được nghe.
- *Lưu ý*: Không yêu cầu True Model Streaming (token/frame streaming trong khi inference) ở mức model.

### 6.2 Stale Cache Invalidation Rule
- Khi người dùng chỉnh sửa nội dung text của một chunk đã có audio:
  - File audio cũ trong cache của chunk đó ngay lập tức bị coi là **Stale / Invalid** đối với nội dung text mới.
  - Trạng thái chunk chuyển sang `Modified` (hoặc `Needs Regeneration`).
  - Hệ thống **tuyệt đối không âm thầm sử dụng audio cũ** cho nội dung text mới khi bấm Ghép audio tổng.

### 6.3 Audio Caching & Basic Interrupted-Session Recovery
- **Audio Caching**: Audio của từng chunk được lưu tạm vào thư mục cache của session: `%APPDATA%/VoxLab/cache/sessions/<session_id>/chunks/`.
- **Chunk Resilience**: Khi một chunk bị lỗi hoặc người dùng bấm Cancel, các chunk đã sinh thành công trước đó được bảo toàn 100%. Sửa câu lỗi và bấm Retry chỉ chạy đúng câu đó, không sinh lại toàn bài.
- **Basic Interrupted-Session Recovery (MVP Target)**:
  - Metadata session và hash của từng chunk text được ghi nhận vào SQLite.
  - Khi ứng dụng bị tắt hoặc khởi động lại: Nếu session data và các file cache audio tương ứng vẫn còn hợp lệ, hệ thống nhận diện lại trạng thái `Ready` cho các chunk đã có, cho phép người dùng tiếp tục quy trình mà không phải chạy lại từ đầu.

### 6.4 Audio Stitching (Ghép âm thanh thành phẩm)
- Sử dụng FFmpeg cục bộ để nối các chunk audio hợp lệ theo đúng thứ tự.
- **Pause Mode = Auto (Mặc định sản phẩm)**:
  - Tự động chèn khoảng lặng giữa các chunk dựa trên cấu trúc văn bản: ngắt đoạn (paragraph boundary) có khoảng lặng dài hơn ngắt câu (sentence boundary).
  - Cho phép người dùng ghi đè (override) khoảng lặng riêng cho từng chunk tại Inspector.
  - *Lưu ý*: Độ dài khoảng lặng cụ thể (ví dụ candidate thử nghiệm ~400ms) là `TUNING REQUIRED`, không chốt cứng thành production default.
- Định dạng xuất: `.wav` (chất lượng cao) hoặc `.mp3` (nén gọn).

---

## 7. Voice Profile & Voice Library Lifecycle

### 7.1 Reusable Voice Profile & Stable Identity
- Mỗi Voice Profile được tạo ra có một **Stable Identity (ID duy nhất)** không đổi trong suốt vòng đời.
- **Tính bất biến của Identity**:
  - Đổi tên (Rename) không làm thay đổi ID.
  - Thêm, bớt, sửa Tags không làm thay đổi ID.
  - Các phiên làm việc cũ (Sessions/History) tham chiếu đến voice bằng Stable ID, không tham chiếu bằng Display Name.
- **Model Compatibility**:
  - Profile lưu trữ rõ model/runtime mà nó tương thích. Không giả định một profile tạo cho Model A có thể dùng trực tiếp cho Model B nếu không qua kiểm tra tương thích.
- **Vòng đời tài sản độc lập**: File audio thành phẩm đã sinh (generated outputs) có vòng đời hoàn toàn độc lập với Voice Profile; xóa profile không được làm mất các file audio đã xuất.

### 7.2 Delete Voice Safety
- Xóa Voice Profile là hành vi có tính phá hủy (**Destructive Action**) và **bắt buộc phải có hộp thoại xác nhận (Confirmation Dialog)**.
- **Cảnh báo liên kết**: Nếu Voice Profile đang được tham chiếu bởi các session trong lịch sử, hộp thoại phải cảnh báo rõ: *"Giọng này đang được dùng trong các phiên cũ. Nếu xóa, bạn sẽ không thể regenerate lại các câu bằng giọng này trong tương lai"*.
- **Quy tắc bảo toàn audio**: Xóa Voice Profile **tuyệt đối không tự động xóa** các file audio chunk đã sinh hoặc các file WAV/MP3 đã xuất ra ổ cứng.
- Không cho phép silent destructive delete.

### 7.3 "Use in TTS" Bridge
- Tại Voice Library, mỗi Voice Card có hành động `[Use in TTS]`.
- **Hành vi**:
  - Chuyển không gian làm việc sang `Text to Speech`.
  - Đặt Voice Profile được chọn làm Active/Global Voice cho phiên TTS hiện tại.
  - Không bắt người dùng phải vào TTS tìm lại thủ công trong dropdown.

---

## 8. Settings Specification (7 Nhóm chức năng)

### 8.1 General
- **UI Language**: Tiếng Việt / English.
- **Appearance**: System / Light / Dark.
- **Restore / Remember last session**: Tùy chọn tự động nạp lại phiên làm việc gần nhất khi mở app (Bật / Tắt).
- **Remember layout state**: Ghi nhớ trạng thái thu gọn của sidebar/inspector.
- **Destructive Confirmation**: Bắt buộc bật xác nhận trước các thao tác xóa (Clear cache, Clear history, Delete voice).

### 8.2 Text to Speech
- **Default TTS Model**: Auto / Last Used / Danh sách model khả dụng.
- **Default Voice**: Chọn giọng mặc định từ Voice Library.
- **Default Language**: Tiếng Việt / Tiếng Anh.
- **Default Output Format**: WAV / MP3.
- **Default Pause Mode**: Auto.
- *Ranh giới an toàn*: Không expose các tham số kỹ thuật runtime chưa benchmark (hardcoded chunk size, worker count, CUDA flags, unload timeout, VRAM threshold) ra màn hình settings chung của người dùng phổ thông.

### 8.3 AI Text (Local LLM)
- **Local Endpoint URL**: Ô nhập địa chỉ OpenAI-compatible endpoint (ví dụ: `http://127.0.0.1:1234/v1`).
- **Nút Test Connection**: Kiểm tra kết nối tới endpoint và hiển thị trạng thái kết nối.
- **Model Selection**: Chọn tên model AI text khi endpoint trả về danh sách model.
- **Per-operation Policy**: Cấu hình chế độ áp dụng riêng cho từng thao tác:
  - *AI Punctuation*: `Review before Apply` (Mặc định) hoặc `Auto Apply`.
  - *AI Optimize for TTS*: `Review before Apply` (Mặc định) hoặc `Auto Apply`.
  - *AI Translation*: `Review before Apply` (Mặc định) hoặc `Auto Apply`.
- *Quy tắc an toàn*: Dù bật Auto Apply, hệ thống vẫn phải bảo toàn bản gốc (Original Source), lưu bản revision để có thể xem lại và cho phép Revert; không âm thầm sửa đổi nội dung.

### 8.4 Transcription
- **Default Language**: `Auto Detect` (Mặc định), Tiếng Việt, Tiếng Anh.
- **Default Whisper Model**: Auto/Recommended hoặc chọn kích thước cụ thể.
- **Device**: Auto / CPU / CUDA (tùy phần cứng).
- **Default Export Format**: TXT / SRT.

### 8.5 Storage & Cache
- **Default Output Folder**: Thư mục mặc định để lưu file âm thanh/văn bản xuất ra.
- **Cache Location**: Đường dẫn thư mục lưu trữ cache tạm thời.
- **Current Cache Usage**: Hiển thị dung lượng cache đang sử dụng (MB/GB).
- **Thao tác dọn dẹp phân định rạch ròi**:
  - `[Clear History]`: Chỉ xóa danh sách lịch sử tác vụ trong SQLite; không xóa cache, không xóa file thành phẩm.
  - `[Clear Cache]`: Chỉ dọn dẹp các file audio tạm/chunk dở dang cũ; không xóa file đã xuất ra thư mục output.
  - `[Delete Generated Output]`: Thao tác trực tiếp trên file đích do người dùng chủ động quản lý.
- **Low Disk-Space Warning**: Cảnh báo khi ổ đĩa chứa thư mục làm việc còn dưới 2 GB.

### 8.6 System & Hardware
- Hiển thị thông tin chẩn đoán phần cứng (chỉ đọc):
  - CPU & Số nhân / luồng.
  - Dung lượng RAM tổng và khả dụng.
  - Tên GPU NVIDIA, Dung lượng VRAM tổng và khả dụng.
  - Trạng thái CUDA availability & phiên bản driver.
  - Trạng thái FFmpeg (sẵn sàng / phiên bản).
  - Trạng thái sẵn sàng của Model Workers.
- Nút hành động: `[Run System Check]` để kiểm tra lại toàn bộ môi trường.
- *Ranh giới an toàn*: Không cho phép người dùng tự chỉnh cờ CUDA hay worker threads phức tạp tại màn hình này.

### 8.7 About & Diagnostics
- Thông tin phiên bản ứng dụng (App Version), build info.
- Nút `[Open Log Folder]` để mở thư mục chứa file log.
- Nút `[Copy System Information]` để sao chép thông tin máy hỗ trợ báo lỗi.
- Nút `[Reset Settings]`: Khôi phục cài đặt về mặc định (có xác nhận; **tuyệt đối không xóa Voice Library, không xóa file output và không xóa session data**).

---

## 9. Error Handling, Process Lifecycle & Cancellation Semantics

### 9.1 Cơ chế Pause Queue & Cancel Job
- **Pause Queue**:
  - Khi bấm Pause, hàng đợi **ngay lập tức không khởi chạy chunk tiếp theo**.
  - Đối với chunk đang chạy dở dang: Chờ chunk đó hoàn tất an toàn hoặc gửi tín hiệu ngắt an toàn nếu runtime hỗ trợ; không làm hỏng dữ liệu.
- **Cancel Job**:
  - Gửi tín hiệu dừng ngay lập tức tới tiến trình worker.
  - Hàng đợi dừng toàn bộ các tác vụ còn lại.
  - Tiến trình worker thực hiện dọn dẹp (cleanup): Giải phóng RAM/VRAM, đóng các file handle, không để lại tiến trình mồ côi (no orphan processes). Tài nguyên không tiếp tục bị chiếm giữ sau khi hoàn tất dọn dẹp.
  - Toàn bộ các chunk đã sinh xong trước thời điểm Cancel được bảo toàn trạng thái `Ready`.

### 9.2 Bảng xử lý sự cố hệ thống

| Tình huống lỗi | Hành vi ứng xử của hệ thống | Trải nghiệm người dùng |
| :--- | :--- | :--- |
| **Model Worker bị Crash (OOM / Exception)** | Rust supervisor phát hiện tiến trình con thoát bất thường; **UI window hoàn toàn không bị ảnh hưởng**. | Chunk đang chạy đánh dấu `Failed`; hiển thị lỗi cụ thể; worker tự khởi động lại sạch sẽ; cho phép bấm `Retry`. |
| **Local LLM chưa bật khi gọi AI Action** | Rust kiểm tra timeout kết nối HTTP (sau 3s); bắt lỗi connection refused. | Hiển thị thông báo: *"Không thể kết nối tới Local LLM tại URL đã cấu hình. Vui lòng bật LM Studio và thử lại"*; không ảnh hưởng quy trình TTS. |
| **File Reference Audio không hợp lệ** | Kiểm tra định dạng và độ dài file âm thanh mẫu khi import vào Voice Clone. | Báo lỗi trực quan: *"File mẫu không hợp lệ hoặc quá ngắn"*; vô hiệu hóa nút sinh preview tới khi nạp file hợp lệ. |
| **Xung đột phiên bản / Capability của Worker** | Handshake khởi động worker phát hiện thiếu capability hoặc version không khớp. | Báo lỗi tường minh (fail explicitly): *"Model worker không hỗ trợ tính năng yêu cầu"*; không để xảy ra silent failure. |

---

## 10. Security, Privacy & Integrity Specification

- **Strict Local-Only**: 100% các chức năng cốt lõi (TTS, ASR, text processing, voice cloning) diễn ra hoàn toàn offline trên máy tính người dùng.
- **Zero Outbound Telemetry**: Tuyệt đối không gửi dữ liệu sử dụng, kịch bản, âm thanh hay telemetry ra internet.
- **IPC Path Sanitization**: Mọi đường dẫn file truyền qua Tauri IPC đều được chuẩn hóa và kiểm tra (Path Traversal Protection) ở tầng Rust trước khi truy xuất.
- **Shell Injection Prevention**: Tuyệt đối không truyền chuỗi văn bản người dùng vào shell; mọi lệnh gọi FFmpeg hoặc subprocess đều sử dụng mảng đối số tách rời (`std::process::Command::args`).
- **Resource Integrity**: Mọi tác vụ tải tài nguyên do người dùng kích hoạt (nếu có sau này) bắt buộc phải sử dụng file tạm staging (`.download`) và xác thực checksum/hash trước khi kích hoạt; lỗi tải không được làm hỏng tài nguyên hợp lệ có sẵn.

---

## 11. TUNING REQUIRED (Các tham số chưa chốt bằng lý thuyết)

Bắt buộc phải qua benchmark thực tế sau bước Model Feasibility mới được cố định giá trị:

| Tham số | Giá trị thử nghiệm ban đầu (Dev Baseline) | Tiêu chí benchmark để chốt |
| :--- | :--- | :--- |
| **Text Chunk Size (Độ dài phân đoạn)** | Phụ thuộc theo từng profile model TTS cụ thể | Đo độ tự nhiên của giọng đọc, tỷ lệ vấp từ và thời gian inference |
| **Model Unload Idle Timeout** | ~120 giây sau khi hàng đợi rảnh | Cân đối giữa việc giữ VRAM sẵn sàng và giải phóng tài nguyên cho hệ thống |
| **Silence / Pause Duration mặc định** | ~400 mili-giây (cho ngắt câu) | Đánh giá độ tự nhiên và nhịp điệu của audio sau khi ghép nối |
| **Queue Concurrency (Số luồng sinh)** | 1 (Safe Sequential) | Thử nghiệm trên máy GPU mạnh (RTX 5070 Ti) xem có thể tăng an toàn không |
| **Inference Parameters (Temp, Top_p, CFG)** | Giá trị mặc định theo tài liệu của từng model candidate | Đo chất lượng âm thanh tiếng Việt và tiếng Anh |
| **Reference Audio Length (Thời lượng mẫu clone)** | Tùy theo model clone được chọn | Đánh giá độ giống giọng và tốc độ nạp của từng model |

---

## 12. Scope Definition (Phạm vi sản phẩm)

### 12.1 IN SCOPE (Nằm trong MVP)
* Desktop shell Windows 10/11 x64 (Tauri v2 + React 19 + TypeScript).
* 4 Workspace chính: `Text to Speech`, `Voice Clone`, `Voice Library`, `Transcription`.
* 2 Workspace tiện ích: `History`, `Settings`.
* TTS Model Set bao phủ chất lượng cho cả **Tiếng Việt** và **Tiếng Anh**.
* Voice Cloning / Reference Audio (ít nhất 1 model hỗ trợ trong MVP model set).
* Smart Chunking theo profile model, bảo vệ protected spans (số thập phân, URL, email, viết tắt).
* Hybrid Chunk Studio (nghe thử từng câu, sửa text, retry câu lỗi, pause override).
* Audio caching từng câu, quy tắc stale cache khi sửa text, và basic interrupted-session recovery (MVP target).
* Ghép nối audio xuất file WAV và MP3.
* Quản lý Voice Profile: stable identity, gắn tags, tìm kiếm theo tên, lọc theo tag, rename, delete an toàn, "Use in TTS".
* Chuẩn hóa text tất định an toàn; AI Punctuation có lexical guardrail; AI Optimize; AI Translation; Original text safety với Restore Original và Reject AI Revision riêng biệt.
* Bóc băng âm thanh/video bằng Whisper local với Automatic Language Detection; xuất TXT/SRT; nút "Chuyển sang TTS".
* Cài đặt 7 nhóm chức năng; SQLite local lưu trữ có schema versioning.
* Phân định rạch ròi: Clear History $\neq$ Clear Cache $\neq$ Delete Output.

### 12.2 OUT OF SCOPE (Dứt khoát KHÔNG làm trong MVP)
* Không Project entity, không project hierarchy, không project asset manager.
* Không Built-in Model Store / Downloader Manager phức tạp.
* Không Cloud API fallback, không cloud voice sharing, không user account.
* Không Trình biên tập timeline waveform/subtitle chuyên sâu (không kéo thả timeline mili-giây).
* Không Timing-preserving automatic video dubbing.
* Không Voice Marketplace, không AI auto-tagging cho giọng.
* Không TTS hội thoại đa nhân vật tự động (multi-speaker dialogue auto-assignment).
* Không Direct SRT-to-TTS workflow tự động.
* Không Licensing infrastructure phức tạp (không activation server, không machine binding, không expiry lock).

---

## 13. Observable & Verifiable Acceptance Criteria

### AC-01: Navigation & Shell Layout
- [ ] Giao diện khởi động hiển thị đầy đủ 6 mục điều hướng bên trái: `Text to Speech`, `Voice Clone`, `Voice Library`, `Transcription`, `History`, `Settings`.
- [ ] Bấm chuyển đổi qua lại giữa 6 workspace diễn ra bình thường, không xảy ra lỗi trắng màn hình hay crash ứng dụng.
- [ ] Nút thu gọn sidebar hoạt động đúng: khi thu gọn, bề rộng sidebar giảm xuống và không gian cho Center Workspace mở rộng tương ứng.
- [ ] Chuyển đổi ngôn ngữ hiển thị giao diện giữa `VN` và `EN` cập nhật toàn bộ nhãn văn bản trên giao diện ngay lập tức.
- [ ] Chuyển đổi Appearance giữa `Light` và `Dark` cập nhật chủ đề màu sắc của giao diện ngay lập tức.

### AC-02: Chuẩn hóa tất định & Bảo vệ Protected Spans
- [ ] Nạp đoạn văn bản chứa Unicode tổ hợp và khoảng trắng thừa $\rightarrow$ Bấm Chuẩn hóa $\rightarrow$ Văn bản chuyển thành Unicode NFC dựng sẵn, các khoảng trắng thừa bị loại bỏ.
- [ ] Nạp đoạn văn bản chứa các chuỗi được bảo vệ: `3.14`, `10:30`, `TP.HCM`, `v2.0`, `127.0.0.1`, `https://example.com`, `test@email.com` $\rightarrow$ Bấm Chuẩn hóa $\rightarrow$ Các chuỗi này giữ nguyên vẹn 100%, không bị chèn dấu cách sai lệch (không bị tách thành `3. 14` hay `10: 30`).

### AC-03: AI Text Assistance, Guardrail & Revision Semantics
- [ ] Chạy AI Punctuation với đoạn văn bản thiếu dấu câu $\rightarrow$ Giao diện hiển thị modal Diff Before/After so sánh sự khác biệt.
- [ ] Giả lập trường hợp LLM tự ý thêm/bớt từ ngữ trong văn bản $\rightarrow$ Hệ thống hiển thị cảnh báo vi phạm từ vựng (Lexical Change Warning) trên giao diện Diff và vô hiệu hóa chế độ tự động áp dụng.
- [ ] Sau khi chạy một thao tác AI $\rightarrow$ Bấm `[Reject AI Revision]` $\rightarrow$ Văn bản quay trở lại trạng thái `Working Text` trước khi chạy thao tác đó.
- [ ] Chạy liên tiếp nhiều thao tác $\rightarrow$ Bấm `[Restore Original]` $\rightarrow$ Văn bản quay trở lại 100% nội dung `Original Source` ban đầu.
- [ ] Khi chưa bật AI hoặc không kết nối Local LLM $\rightarrow$ Bấm nút tạo audio $\rightarrow$ Hệ thống sử dụng trực tiếp text hiện tại, không phát sinh bất kỳ yêu cầu mạng nào tới LLM.

### AC-04: Smart Chunking & Invalidation Cache
- [ ] Kịch bản dài được phân đoạn theo đúng thứ tự ưu tiên: Đoạn văn $\rightarrow$ Câu hoàn chỉnh $\rightarrow$ Vế câu; không có chunk nào bị cắt ngang giữa một protected span.
- [ ] Sinh audio thành công cho Chunk #001 $\rightarrow$ Chunk #001 hiển thị trạng thái `Ready` và nghe thử được audio.
- [ ] Chỉnh sửa một ký tự trong text của Chunk #001 $\rightarrow$ Trạng thái của Chunk #001 chuyển sang `Modified`, audio cũ bị đánh dấu là stale/invalid và không được sử dụng khi bấm Ghép audio tổng.

### AC-05: TTS Generation & Audio Resilience
- [ ] Tạo bài đọc gồm nhiều chunk bằng tiếng Việt $\rightarrow$ Âm thanh phát âm chuẩn tiếng Việt.
- [ ] Tạo bài đọc bằng tiếng Anh $\rightarrow$ Âm thanh phát âm chuẩn tiếng Anh.
- [ ] Trong khi đang sinh chunk #005 $\rightarrow$ Ngắt tiến trình worker bằng Task Manager $\rightarrow$ Ứng dụng chính không bị sập (no UI crash); Chunk #005 chuyển trạng thái `Failed`; cho phép bấm Retry riêng chunk #005.
- [ ] Đang sinh bài đọc dài $\rightarrow$ Bấm `[Cancel]` $\rightarrow$ Hàng đợi dừng lại; các chunk đã hoàn thành trước thời điểm Cancel được giữ nguyên trên giao diện và nghe thử được bình thường; tài nguyên tiến trình con được giải phóng.
- [ ] Bấm `[Ghép & Xuất audio]` $\rightarrow$ File `.wav` hoặc `.mp3` được tạo ra trong thư mục output, chứa toàn bộ nội dung âm thanh của các chunk theo đúng thứ tự và có khoảng lặng phân tách giữa các câu.

### AC-06: Voice Clone & Voice Library
- [ ] Nạp file âm thanh mẫu `.wav` hợp lệ vào workspace Voice Clone $\rightarrow$ Nhập test text $\rightarrow$ Bấm Generate Preview $\rightarrow$ Nghe được file audio preview giọng clone.
- [ ] Nạp file âm thanh hỏng hoặc dung lượng 0 byte $\rightarrow$ Giao diện hiển thị thông báo lỗi file không hợp lệ và nút sinh preview bị vô hiệu hóa.
- [ ] Nhập tên "Voice Test", gắn tags `[Nam, Kể chuyện]` $\rightarrow$ Bấm Lưu $\rightarrow$ Voice Profile xuất hiện ngay lập tức trong danh sách của workspace *Voice Library*.
- [ ] Tại Voice Library: Nhập từ khóa tìm kiếm theo tên $\rightarrow$ Danh sách lọc chính xác voice cần tìm.
- [ ] Tại Voice Library: Chọn lọc theo Tag $\rightarrow$ Danh sách chỉ hiển thị các voice có chứa tag đó.
- [ ] Đổi tên (Rename) Voice Profile từ "Voice A" thành "Voice B" $\rightarrow$ Thao tác thành công, ID của voice trong cơ sở dữ liệu giữ nguyên không đổi.
- [ ] Tại Voice Library: Bấm `[Use in TTS]` trên một voice profile $\rightarrow$ Ứng dụng tự động chuyển sang workspace Text to Speech và đặt profile này làm Active Voice.
- [ ] Bấm xóa một Voice Profile $\rightarrow$ Hệ thống hiển thị hộp thoại xác nhận cảnh báo; bấm xác nhận xóa $\rightarrow$ Profile biến mất khỏi Library nhưng các file audio đã sinh trước đó trong ổ cứng không bị xóa.

### AC-07: Standalone Transcription
- [ ] Nạp file âm thanh tiếng Việt vào workspace Transcription $\rightarrow$ Bật Auto Detect $\rightarrow$ Hệ thống tự động nhận diện ngôn ngữ tiếng Việt và bóc băng ra văn bản tiếng Việt.
- [ ] Nạp file media tiếng Anh $\rightarrow$ Bóc băng ra văn bản tiếng Anh chính xác.
- [ ] Bấm `[Xuất file .TXT]` $\rightarrow$ Tạo file `.txt` chứa toàn bộ nội dung văn bản.
- [ ] Bấm `[Xuất file .SRT]` $\rightarrow$ Tạo file phụ đề `.srt` hợp lệ với các mốc thời gian `00:00:00,000 --> 00:00:00,000`.
- [ ] Bấm `[Chuyển sang TTS]` $\rightarrow$ Ứng dụng chuyển sang workspace Text to Speech, toàn bộ plain transcript text được đưa vào khung làm việc của TTS, transcript gốc tại Transcription giữ nguyên không đổi.

### AC-08: Settings & Data Separation
- [ ] Thay đổi các cấu hình trong Settings (ngôn ngữ, theme, thư mục output) $\rightarrow$ Khởi động lại ứng dụng $\rightarrow$ Các cấu hình đã thay đổi được lưu trữ bền vững và áp dụng lại chính xác.
- [ ] Bấm `[Clear History]` $\rightarrow$ Danh sách trong workspace History bị xóa sạch; các file trong thư mục cache và các file audio đã xuất trong thư mục output không bị xóa.
- [ ] Bấm `[Clear Cache]` $\rightarrow$ Các file tạm trong thư mục cache bị xóa; danh sách trong History và các file audio trong thư mục output không bị xóa.
- [ ] Bấm `[Reset Settings]` $\rightarrow$ Các tùy chọn cấu hình quay về mặc định ban đầu; Voice Library, lịch sử phiên và các file audio thành phẩm không bị xóa.

### AC-09: Offline Integrity & Performance Baseline
- [ ] Ngắt toàn bộ kết nối mạng internet (tắt Wi-Fi / rút dây mạng) $\rightarrow$ Thực hiện toàn bộ quy trình: Chuẩn hóa text $\rightarrow$ Chia chunk $\rightarrow$ TTS $\rightarrow$ Ghép audio $\rightarrow$ Bóc băng media $\rightarrow$ Mọi chức năng hoạt động bình thường, không xuất hiện bất kỳ lỗi mạng nào.
- [ ] Không có bất kỳ gói tin mạng nào được gửi ra internet trong suốt quá trình sử dụng core features (Zero Telemetry).

---

## 14. User Decisions Required (Các điểm cần quyết định trước khi Plan)

Hiện tại toàn bộ các ranh giới kiến trúc và nghiệp vụ của MVP đã được đặc tả hoàn chỉnh. Chỉ còn **2 câu hỏi chính sách sản phẩm** để User xác nhận có muốn đưa vào MVP hay để lại cho các giai đoạn sau:

1. **Licensing & Key Activation**:
   * *Đề xuất hiện tại*: Đã loại bỏ hoàn toàn UI nhập Key và License badge khỏi giao diện chính của MVP để giữ ứng dụng gọn gàng, không phát sinh code activation server phức tạp.
   * *Xác nhận của bạn*: Đồng ý đưa Licensing vào mục `LATER` (để tính sau MVP), hay bạn muốn có cơ chế kích hoạt key offline/online cụ thể ngay trong MVP?
2. **Model Download Workflow**:
   * *Đề xuất hiện tại*: Không xây dựng Model Manager / Downloader phức tạp trong MVP; người dùng tải model và đặt vào thư mục `models/` theo hướng dẫn, hoặc ứng dụng chỉ kiểm tra model sẵn có.
   * *Xác nhận của bạn*: Đồng ý với hướng tiếp cận gọn nhẹ này cho MVP (để Model Manager lại sau), hay muốn có giao diện tải model trực tiếp trong ứng dụng ngay từ MVP?

---

### KẾT LUẬN

Bản đặc tả kỹ thuật `SPEC.md` v2.1.0 đã giải quyết triệt để toàn bộ 25 yêu cầu từ mục A đến Y: tách riêng Voice Clone và Voice Library, chuẩn hóa 7 nhóm Settings, tinh chỉnh Smart Chunking với Protected Spans, nâng cấp AI Guardrail, loại bỏ hoàn toàn các giả định Project Management phức tạp, và cung cấp bộ Acceptance Criteria hoàn toàn có thể kiểm chứng bằng quan sát thực nghiệm.

# **READY FOR GATE B USER REVIEW**
*(Đang dừng tại GATE B theo AGENT_WORKFLOW.txt. Xin mời bạn xem xét và phê duyệt).*
