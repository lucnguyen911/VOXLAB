# VoxLab — Product & Technical Specification (SPEC.md)

**Document Version**: 2.3.0 (Final Consistency Pass)  
**Phase**: Phase 3 — Specification (GATE B)  
**Status**: Pending User Approval  
**Target Platform**: Windows 10/11 64-bit (x64)  
**Core Stack**: Tauri v2 (Rust) + React 19 + TypeScript + Vite  

---

## 1. Goal & Product Vision

VoxLab là ứng dụng desktop Windows được thiết kế theo kiến trúc **Local-First Core + Explicit Optional Online Providers**, chuyên biệt cho việc tạo giọng đọc kịch bản dài (Long-form TTS) với khả năng kiểm soát chất lượng chi tiết từng câu, tạo và quản lý mẫu giọng (Voice Cloning & Voice Library), cùng công cụ bóc băng âm thanh/video (ASR) độc lập.

### 1.1 Nguyên tắc bảo mật & Quyền riêng tư (Privacy Model)
- **Local-First Core (Cốt lõi Cục bộ)**: Toàn bộ các tính năng cốt lõi (Local TTS models, Local Voice Cloning, faster-whisper Transcription, Chuẩn hóa text tất định, Local LLM qua LM Studio/local endpoint, và tài sản Voice Library cục bộ) hoạt động **100% offline** khi các model và tài nguyên cục bộ đã sẵn sàng.
- **Explicit Optional Online Providers (Nhà cung cấp Trực tuyến Tùy chọn)**: 
  - Ứng dụng hỗ trợ kết nối tùy chọn tới **Online Voice Providers** (ứng viên chính thức: Microsoft, Google...) và **Cloud Translation Providers** (Google Gemini API...).
  - **Cam kết MVP đối với Online Voice Provider**: Kiến trúc Online Voice Provider là **IN SCOPE**. MVP cam kết tích hợp **ít nhất một nhà cung cấp Online Voice chính thức / có tài liệu (official/documented provider)** NẾU provider đó vượt qua kiểm chứng về kỹ thuật, tính sẵn sàng của API, Điều khoản dịch vụ (Terms of Service) và bản quyền/phân phối. Nếu không có provider chính thức nào vượt qua thẩm định trước ngày phát hành, tính năng online voice sẽ được đánh dấu tạm hoãn (deferred); **tuyệt đối không sử dụng các endpoint không chính thức (như CapCut / Edge-TTS reverse-engineered) để đối phó Acceptance Criteria**.
- **Quy tắc bắt buộc đối với Online Providers**:
  1. **Không âm thầm kết nối (No Silent Requests)**: Người dùng phải chủ động chọn provider online; hệ thống cảnh báo rõ ràng rằng văn bản sẽ được gửi tới dịch vụ bên ngoài.
  2. **Không tự động chuyển vùng (No Automatic Cloud Fallback)**: Lỗi mạng hoặc lỗi của provider local tuyệt đối không tự ý fallback sang cloud.
  3. **Cô lập lỗi mạng (Failure Isolation)**: Lỗi mạng của provider online không làm ảnh hưởng đến luồng làm việc của các voice và model local.
  4. **Zero Telemetry**: Tuyệt đối không thu thập, không theo dõi và không gửi bất kỳ dữ liệu sử dụng, kịch bản, âm thanh hay telemetry nào ra ngoài internet.
  5. **Bảo mật thông tin xác thực**: API key và credentials không bao giờ lưu dưới dạng plaintext trong SQLite mà phải sử dụng cơ chế lưu trữ bảo mật của hệ điều hành (Windows Credential Manager / DPAPI hoặc cơ chế tương đương).

---

## 2. Target User & Use Cases

### 2.1 Đối tượng người dùng
- **Content Creators / Video Makers**: Cần tạo voiceover kịch bản dài chất lượng cao, clone giọng đặc trưng, chỉnh sửa câu đọc vấp mà không phải sinh lại toàn bộ bài.
- **Audiobook Creators / Podcasters**: Cần đọc sách, truyện, tài liệu dài với giọng đọc tự nhiên, quản lý nhiều giọng nhân vật theo tags, có khoảng lặng phù hợp giữa các đoạn.
- **Researchers / Transcribers**: Cần bóc băng phỏng vấn, bài giảng, video ghi âm nội bộ để trích xuất text/subtitle hoàn toàn bảo mật tại máy.

### 2.2 Các kịch bản sử dụng chính (Use Cases)
- **UC-01 (Tạo Voiceover kịch bản dài)**: Người dùng nhập văn bản $\rightarrow$ Chuẩn hóa text $\rightarrow$ Chia chunk $\rightarrow$ Chọn Model & Giọng $\rightarrow$ Sinh toàn bộ $\rightarrow$ Nghe thử phát hiện câu #15 đọc vấp $\rightarrow$ Sửa text câu #15 $\rightarrow$ Retry riêng câu #15 $\rightarrow$ Ghép & Xuất audio tổng.
- **UC-02 (Tạo và Tái sử dụng Voice Profile)**: Vào workspace *Voice Clone* $\rightarrow$ Nạp file mẫu $\rightarrow$ Chọn model hỗ trợ clone $\rightarrow$ Thử nghiệm preview $\rightarrow$ Đặt tên, gắn tags $\rightarrow$ Lưu vào *Voice Library*. Tại Voice Library, bấm *"Use in TTS"* $\rightarrow$ Chuyển sang TTS Studio và đặt giọng này làm active voice.
- **UC-03 (AI Hỗ trợ sửa dấu câu an toàn)**: Đoạn text thiếu dấu câu $\rightarrow$ Bấm "AI Punctuation" $\rightarrow$ Local LLM qua LM Studio xử lý $\rightarrow$ Hiện màn hình Diff Before/After $\rightarrow$ Kiểm tra guardrail từ vựng $\rightarrow$ Bấm "Chấp nhận" để cập nhật vào working text.
- **UC-04 (Bóc băng & Lồng tiếng lại - Re-voice)**: Nạp video vào *Transcription* $\rightarrow$ faster-whisper tự động nhận diện ngôn ngữ và bóc băng ra text $\rightarrow$ Bấm "Chuyển sang TTS" $\rightarrow$ Nạp sang TTS Studio làm kịch bản mới $\rightarrow$ (Tùy chọn dịch sang ngôn ngữ khác) $\rightarrow$ Sinh voiceover mới.

---

## 3. High-Level Architecture & Storage Boundaries

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
│  - Secure Credential Storage Bridge (Windows DPAPI / OS Credential Store)      │
│  - Safe Data Root Migration Orchestrator (Copy -> Verify -> Activate/Rollback) │
└──────────────┬───────────────────────────────┬───────────────────────────┬──────┘
               │ Documented IPC Interface      │ Local HTTP                │ HTTPS
┌──────────────▼──────────────┐ ┌──────────────▼─────────────┐ ┌───────────▼──────┐
│   ISOLATED MODEL WORKERS    │ │    LOCAL LLM PROVIDER      │ │  OPTIONAL ONLINE │
│  - TTS Engine Worker        │ │  - LM Studio / Local OAI   │ │  - Online Voices │
│  - faster-whisper Worker    │ │  - Configurable URL        │ │  - Gemini Trans. │
│  - Capability Handshake     │ │  - GGUF/VRAM managed by LMS│ │  - Explicit Auth │
└─────────────────────────────┘ └────────────────────────────┘ └──────────────────┘
```

### 3.1 Phân định 4 loại Đường dẫn & Quy trình Migration an toàn
Hệ thống phân định rạch ròi 4 loại đường dẫn, không gộp chung và không bắt buộc lưu ở ổ C:
1. **App Installation Path**: Thư mục cài đặt ứng dụng (ví dụ: `C:\Program Files\VoxLab`). Đây là thư mục chỉ đọc (read-only), **tuyệt đối không ghi dữ liệu người dùng thay đổi (mutable data)** vào đây.
2. **Configurable App Data Root**: Thư mục lưu trữ dữ liệu ứng dụng do người dùng cấu hình (Mặc định: Windows user data; Người dùng có thể đổi sang ổ khác như `D:\VoxLabData`). Chứa: cơ sở dữ liệu `voxlab.db`, cache, sessions, managed voice assets, log files.
   * **Quy trình Di chuyển dữ liệu an toàn (Safe Data Root Migration)**:
     - Khi người dùng thay đổi Data Root và tại vị trí cũ đã có dữ liệu VoxLab tồn tại, hệ thống bắt buộc phải hiển thị phương án chuyển dữ liệu hiện có sang vị trí mới. **Tuyệt đối không âm thầm bỏ rơi (silent abandon)** database, sessions, Voice Library và managed assets ở thư mục cũ.
     - Quy trình thực thi theo nguyên tắc: **Root cũ $\rightarrow$ Sao chép dữ liệu (Copy) $\rightarrow$ Kiểm chứng toàn vẹn (Verify) $\rightarrow$ Kích hoạt Root mới (Activate)**.
     - **Cơ chế Rollback**: Nếu quá trình sao chép hoặc kiểm chứng thất bại, hệ thống hủy thao tác, báo lỗi rõ ràng và tiếp tục sử dụng Data Root cũ.
     - **Bảo toàn dữ liệu cũ**: Tuyệt đối không xóa dữ liệu hợp lệ ở vị trí cũ trước khi quá trình chuyển đổi sang vị trí mới được kiểm chứng thành công 100%.
     - Bộ nhớ đệm (Cache) có thể được chuyển giao hoặc tạo lại (rebuild) sạch sẽ, hành vi này được ghi nhận rõ ràng.
3. **Configurable Model Paths (Độc lập cho TTS và Transcription)**:
   * **`TTS Model Path`**: Thư mục lưu trữ các model TTS (ví dụ: `D:\AI\Models\TTS`).
   * **`Transcription Model Path`**: Thư mục lưu trữ các model faster-whisper (ví dụ: `D:\AI\Models\ASR`).
   * *Mục đích*: Cho phép chia sẻ thư mục model với các công cụ AI khác trên máy, tránh trùng lặp dung lượng ổ cứng.
4. **Output Path**: Thư mục đích do người dùng chỉ định để lưu file âm thanh/văn bản hoàn chỉnh xuất ra.

### 3.2 Ranh giới quản lý Local LLM (LM Studio làm Provider)
- **VoxLab KHÔNG**: Tải file model LLM, không quản lý file GGUF, không load file `.gguf`, không trực tiếp quản lý VRAM/offload/context của LLM, không yêu cầu người dùng chọn thư mục LLM trong VoxLab.
- **Ranh giới**: `LLM Model Management = OUTSIDE VOXLAB` và `Local LLM Connection Configuration = IN SCOPE`.
- **Cơ chế**: VoxLab kết nối qua HTTP tới OpenAI-compatible endpoint của LM Studio (hoặc provider tương đương), kiểm tra kết nối (`Test Connection`), tự động truy vấn danh sách model khả dụng qua API để hiển thị dropdown cho người dùng chọn. Trạng thái kết nối hiển thị rõ ràng: *Connected*, *Not Connected*, *No Model Available*, *Model Ready*, *Provider Error*.

---

## 4. Navigation & Workspace Specifications

### 4.1 Cấu trúc Navigation bên trái (Left Sidebar)
Sidebar hỗ trợ thu gọn (collapsible) với 6 không gian làm việc:
* **PRIMARY WORKSPACES**:
  1. `Text to Speech` (Không gian TTS kịch bản dài)
  2. `Voice Clone` (Không gian tạo giọng mẫu mới)
  3. `Voice Library` (Không gian quản lý và tái sử dụng giọng)
  4. `Transcription` (Không gian bóc băng âm thanh/video)
* **UTILITY**:
  5. `History` (Lịch sử các phiên xử lý gần đây)
  6. `Settings` (Cài đặt hệ thống toàn diện)

> **Ranh giới dứt khoát**: Không có `Project Management` trong MVP. Mô hình làm việc là **Task/Session-based + History + Cache/Recovery**.

---

### 4.2 Chi tiết các Workspace

#### 4.2.1 Workspace 1: Text to Speech (Adaptive Workspace)
*Nguyên tắc: Text to Speech = USE*.
- **Multilingual-first + Capability-driven**: Danh sách ngôn ngữ (Language) hiển thị phụ thuộc hoàn toàn vào năng lực (capabilities) mà model TTS được chọn khai báo qua handshake (ví dụ: OmniVoice, Qwen TTS, Chatterbox hỗ trợ ngôn ngữ nào thì UI chỉ hiển thị ngôn ngữ đó). Không khóa cứng toàn bộ app vào enum `vi/en`. Tiếng Việt và Tiếng Anh là 2 ngôn ngữ bắt buộc phải kiểm chứng trong release validation.
- **Giai đoạn 1: Chuẩn bị Text (Text Preparation View)**:
  - Hiển thị song song: `Original Text` (bảo toàn) và `Working Text`.
  - Nút hành động: `[Chuẩn hóa Text]`, `[AI Sửa dấu câu]`, `[AI Tối ưu]`, `[AI Dịch]`, `[Khôi phục bản gốc (Restore Original)]`.
  - Nút chuyển: `[Phân đoạn thông minh ➔]`.
- **Giai đoạn 2: Chunk Studio View**:
  - Danh sách thẻ câu (Chunk Cards): Trạng thái (`Pending`, `Generating`, `Ready`, `Failed`, `Modified`), Text câu, nút `[Nghe thử]`, nút `[Tạo lại riêng câu này]`, `Pause after: Auto` (hoặc override ms).
- **Right Contextual Inspector**:
  - *Global Context*: Chọn Model TTS, Voice Selector (nguồn từ Voice Library), Ngôn ngữ theo model, Tốc độ (Speed), Sắc thái (Emotion/Style - nếu model hỗ trợ), Khoảng lặng mặc định.
  - *Chunk Context*: Cho phép câu được chọn ghi đè giọng đọc, cảm xúc, khoảng lặng riêng, hoặc bấm `[Kế thừa Global]`.

#### 4.2.2 Workspace 2: Voice Clone (Dedicated Workspace)
*Nguyên tắc: Voice Clone = CREATE*.
- **Đa ngôn ngữ hướng năng lực (Multilingual + Capability-Driven)**:
  - Model clone được chọn khai báo các năng lực ngôn ngữ và chế độ hoạt động (modes) qua handshake.
  - Giao diện chỉ hiển thị các ngôn ngữ/chế độ thực sự được model hỗ trợ; không tự động giả định một Voice Profile clone ra có thể nói được mọi ngôn ngữ mà model gốc hỗ trợ.
  - Tính năng cross-language voice cloning (nói ngôn ngữ khác với file mẫu) chỉ được hiển thị nếu Model Feasibility xác nhận model/runtime hỗ trợ an toàn.
  - Voice Profile lưu trữ metadata tương thích cần thiết; sự kết hợp không được hỗ trợ phải báo lỗi tường minh (fail explicitly), không âm thầm fallback.
- **Quy trình tạo Voice Profile**:
  1. **Nạp Reference Audio**: Kéo thả file âm thanh mẫu (.wav, .mp3...), kiểm tra tính hợp lệ và thời lượng.
  2. **Chọn Model hỗ trợ Clone**: Dropdown lọc chỉ các model có capability voice cloning.
  3. **Cấu hình tham số clone**: Chỉ hiển thị các tham số có ý nghĩa thực tế với người dùng và được model hỗ trợ (capability-aware; không tự ý đổ toàn bộ sampling flags kỹ thuật ra UI nếu chưa qua benchmark).
  4. **Nhập Test Text & Generate Preview**: Nhập câu test, bấm sinh thử để nghe kiểm tra chất lượng giọng clone.
  5. **Nghe Preview**: Trình phát audio nghe thử kết quả clone.
  6. **Đặt tên & Gắn Tag**: Nhập Display Name, nhập/chọn Tags (ví dụ: `[Nam]`, `[Trầm ấm]`).
  7. **Lưu Profile**: Bấm `[Lưu vào Voice Library]`.
- **Quản lý Reference Assets bền vững (Managed Assets)**:
  - Khi lưu Voice Profile, VoxLab tự động sao chép/quản lý file âm thanh mẫu vào thư mục dữ liệu quản lý (`managed voice assets` trong Data Root).
  - Sau khi lưu, người dùng có thể di chuyển hoặc xóa file âm thanh gốc ban đầu mà **Voice Profile đã lưu vẫn hoạt động bình thường**.

#### 4.2.3 Workspace 3: Voice Library (Dedicated Workspace)
*Nguyên tắc: Voice Library = MANAGE*.
- **Bộ lọc nguồn (Source Filter)**:
  - `All` (Tất cả)
  - `Local / My Voices` (Các giọng clone do người dùng tạo)
  - `Preset Local Voices` (Các giọng mẫu có sẵn của model local)
  - `Online Provider Voices` (Giọng trực tuyến: Microsoft, Google...). Giọng online bắt buộc phải gắn nhãn rõ ràng là **ONLINE**, không hiển thị mập mờ như giọng local.
  - *(Ghi chú: CapCut / Edge-TTS hoặc các endpoint không chính thức thuộc diện `FEASIBILITY / LEGAL / TERMS VALIDATION REQUIRED`, tuyệt đối không đưa vào làm dependency sản xuất nếu chưa được thẩm định).*
- **Chức năng quản trị**:
  - Danh sách giọng kèm metadata: Tên, Tags, Model, Ngôn ngữ, Loại giọng.
  - Tìm kiếm theo tên (Search by Name) và Lọc theo Tag (Filter by Tag).
  - Đổi tên (Rename) và Sửa Tags mà **không làm thay đổi Stable Identity**.
  - **Xóa an toàn (Delete Voice Safety)**: Yêu cầu xác nhận (confirmation dialog); nếu giọng đang được tham chiếu bởi các session cũ thì phải cảnh báo trước; xóa voice profile **tuyệt đối không tự động xóa** các file audio chunk hoặc WAV/MP3 đã sinh trước đó.
  - **Cầu nối `[Use in TTS]`**: Bấm một chạm để chuyển sang tab Text to Speech và đặt profile này làm active voice.

#### 4.2.4 Workspace 4: Transcription (Standalone Workspace)
- **Engine cố định cho MVP**: **`faster-whisper`**.
- **Model Set cố định**:
  - `Medium`
  - `Large V3`
  - `Large V3 Turbo`
  - `Auto` (Tự động phát hiện cấu hình phần cứng CPU/RAM/VRAM và trạng thái model đã cài để chọn model tương thích, an toàn nhất; ngưỡng phần cứng cụ thể là `TUNING REQUIRED`).
- **Ngôn ngữ (Language)**: Hỗ trợ `Auto Detect` (Tự động nhận diện - **MUST HAVE**) và danh sách toàn bộ các ngôn ngữ được runtime faster-whisper hỗ trợ.
- **Xem & Xuất**: Xem dạng `Plain Text` hoặc `Segments View` (có timestamp). Xuất file `.txt` và `.srt`.
- **Cầu nối `[Chuyển sang TTS]`**: Đưa toàn bộ text bóc băng sang TTS Studio làm kịch bản mới, giữ nguyên transcript gốc.

#### 4.2.5 Workspace 5: History (Utility)
- Danh sách các phiên xử lý (sessions) gần đây kèm thời gian, tác vụ, trạng thái.
- Hành động: `[Reopen/Resume]`, `[Mở thư mục output]`, `[Xóa lịch sử]` (chỉ xóa bản ghi metadata, không xóa file thành phẩm trên đĩa).

#### 4.2.6 Workspace 6: Settings (Utility — 9 Nhóm chức năng chi tiết tại Mục 8)

### 4.3 Bottom Job Bar
- Cố định dưới chân app: Model đang chạy, tiến độ chunk (ví dụ `Chunk 23/84 - 27%`), thanh tiến độ, nút `[Tạm dừng (Pause)]`, `[Hủy bỏ (Cancel)]`, `[Mở thư mục output]`.

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

### 5.1 Deterministic Text Normalization & Protected Spans
Chỉ thực hiện các biến đổi an toàn về hình thức, không làm thay đổi semantic content:
1. Unicode Normalization Form C (NFC) chuẩn cho tiếng Việt và tiếng Anh.
2. Gom các khoảng trắng liên tiếp thành 1; chuẩn hóa khoảng trắng đầu/cuối dòng; tối đa 2 dấu ngắt dòng liên tiếp.
3. Chuẩn hóa ngoặc kép chuẩn `""`, dấu gạch ngang chuẩn `-`.
4. **Bảo vệ Protected Spans (Tuyệt đối không chèn khoảng cách làm vỡ cấu trúc)**:
   * Số thập phân: `3.14`, `12,5`.
   * Mốc thời gian: `10:30`, `14:00:15`.
   * Tên miền & URL: `example.com`, `https://domain.vn/path`.
   * Địa chỉ Email: `user@example.com`.
   * Từ viết tắt & định danh: `TP.HCM`, `v2.0`, `127.0.0.1`, `file_01.wav`.

### 5.2 AI Text Assistance, Guardrails & Translation Provider Architecture
- **AI Punctuation**: Khôi phục dấu câu bảo toàn nguyên vẹn từ vựng. **Lexical Guardrail** tự động phát hiện mọi thay đổi từ ngữ ngoài phạm vi dấu câu $\rightarrow$ Cảnh báo đỏ trên Diff View và chặn chế độ tự động áp dụng.
- **AI Optimize for TTS**: Tối ưu ngắt nghỉ cho kịch bản đọc, có chính sách áp dụng riêng.
- **Translation Provider Architecture**:
  - Kiến trúc dạng generic provider hỗ trợ:
    1. **Local LLM**: Qua LM Studio / OpenAI-compatible endpoint.
    2. **Optional Cloud Provider**: Hỗ trợ ứng viên ban đầu là **Google Gemini API**.
  - *Quy tắc Cloud Translation*: Khi người dùng chọn provider cloud, giao diện thông báo rõ văn bản sẽ được gửi tới dịch vụ ngoài; không tự động gửi nếu người dùng chưa bấm thao tác; không tự động fallback từ Local sang Cloud khi gặp lỗi.
- **Chính sách áp dụng độc lập cho từng tác vụ AI (Per-Operation Apply Policy)**:
  - Cả 3 tác vụ AI (`AI Punctuation`, `AI Optimize for TTS`, `AI Translation`) đều có cấu hình độc lập:
    - **`Review before Apply` (MẶC ĐỊNH)**: Bắt buộc mở màn hình Diff/So sánh để người dùng kiểm tra trước khi áp dụng.
    - **`Auto Apply` (Tùy chọn)**: Tự động ghi đè vào Working Text sau khi xử lý xong.
    - *Ràng buộc an toàn*: Khi bật `Auto Apply`, hệ thống **vẫn bảo toàn 100% bản gốc (Original Source)**, ghi nhận nhật ký sửa đổi (revision) cho phép xem lại và có thể khôi phục (`Restore Original` hoặc `Reject Revision`); tuyệt đối không trở thành silent modification.
- **Semantics phân biệt**:
  - `Reject AI Revision`: Quay về trạng thái `Working Text` ngay trước khi gọi AI.
  - `Restore Original`: Khôi phục 100% về `Original Source` ban đầu.

### 5.3 Smart Chunking (Phân đoạn thông minh)
- Phân đoạn theo thứ tự ưu tiên: *Đoạn văn $\rightarrow$ Câu hoàn chỉnh $\rightarrow$ Vế câu $\rightarrow$ Fallback an toàn*.
- Tuyệt đối không cắt ngang giữa các Protected Spans.
- Ngưỡng độ dài chunk được cấu hình theo từng Model Profile cụ thể (được đánh dấu `TUNING REQUIRED`).

---

## 6. TTS Generation, Caching & Resilience

### 6.1 Chunk Generation & Stale Cache Invalidation
- Xử lý hàng đợi tuần tự (Concurrency = 1 trong MVP).
- **Chunk-level Progressive Availability**: Chunk nào sinh xong thì hiển thị trạng thái `Ready` và nghe thử được ngay.
- **Stale Cache Invalidation**: Khi text của một chunk đã có audio bị chỉnh sửa, file audio cũ trong cache lập tức bị đánh dấu là **Stale / Invalid** đối với text mới; chunk chuyển trạng thái `Modified`; hệ thống **tuyệt đối không âm thầm sử dụng audio cũ** khi bấm Ghép audio tổng.

### 6.2 Basic Interrupted-Session Recovery (MVP Target)
- Tính năng này là **`MVP TARGET subject to safe feasibility`**.
- **Cơ chế thực thi**:
  1. Mỗi chunk audio sinh thành công được lưu trữ bền vững kèm theo metadata chi tiết (chỉ số chunk, hash nội dung văn bản, ID voice profile sử dụng, định danh model) vào cơ sở dữ liệu SQLite trong Data Root.
  2. Khi ứng dụng bị khởi động lại (restart) hoặc gặp sự cố crash đột ngột: dữ liệu của các chunk đã hoàn thành hợp lệ trước đó **không bị mất**.
  3. Khi người dùng mở lại hoặc khôi phục phiên (reopen/resume session): hệ thống tự động đối chiếu các file cache âm thanh trên đĩa với metadata được lưu trong session.
  4. Các chunk có cache âm thanh toàn vẹn và khớp chính xác với hash văn bản sẽ được **phục hồi trạng thái `Ready`**.
  5. Các chunk bị thiếu file cache, bị sửa đổi nội dung text, hoặc không khớp hash sẽ chuyển về trạng thái cần sinh (`Modified` / `Pending` / `Failed`), **tuyệt đối không được xem là Ready**.
  6. Người dùng có thể tiếp tục tiến trình để sinh nốt các chunk còn thiếu mà **không phải sinh lại các chunk đã hoàn thành hợp lệ**.

### 6.3 Bounded Cancel & Safe Pause Semantics
- **Pause Queue**: Hàng đợi lập tức không bắt đầu chunk tiếp theo. Chunk đang chạy dở dang được hoàn tất an toàn hoặc ngắt an toàn nếu runtime hỗ trợ.
- **Cancel Job**:
  - Ngừng ngay lập tức việc nạp job tiếp theo.
  - Gửi tín hiệu hủy tới worker; hỗ trợ cooperative cancellation nếu runtime cho phép, hoặc controlled termination/restart sạch sẽ.
  - Các chunk đã hoàn thành trước thời điểm Cancel được bảo toàn 100%.
  - Tiến trình worker thực hiện dọn dẹp (cleanup), đóng file handle, giải phóng RAM/VRAM, không để lại tiến trình mồ côi (no orphan processes).

### 6.4 Audio Stitching (Ghép âm thanh thành phẩm)
- Ghép nối qua FFmpeg cục bộ.
- **Pause Mode = Auto (Mặc định)**: Tự động chèn khoảng lặng giữa các câu dựa trên cấu trúc văn bản (đoạn văn ngắt dài hơn câu; giá trị thử nghiệm ban đầu ~400ms là `TUNING REQUIRED`). Cho phép ghi đè khoảng lặng riêng từng chunk tại Inspector.
- Xuất file `.wav` hoặc `.mp3`.

---

## 7. Model Lifecycle & Provisioning

### 7.1 Model Storage & Discovery / Rescan
- **Cấu hình đường dẫn độc lập**:
  - `TTS Model Path`: Nơi lưu trữ các model TTS (ví dụ: `D:\AI\Models\TTS`).
  - `Transcription Model Path`: Nơi lưu trữ các model faster-whisper (ví dụ: `D:\AI\Models\ASR`).
- **Model Discovery**: Khi khởi động hoặc khi người dùng thay đổi đường dẫn, VoxLab tự động quét (scan) thư mục để nhận diện các model tương thích đã có sẵn.
  - Các trạng thái model: `Installed / Valid / Ready`, `Missing`, `Invalid / Incomplete`, `Incompatible`.
  - Nếu model tương thích đã có sẵn trên máy: Tái sử dụng trực tiếp, **không tải lại và không sao chép sang AppData**.
  - Có nút hành động: `[Rescan / Refresh Models]` để quét lại khi người dùng vừa copy thêm model vào thư mục.
  - Khi thay đổi Model Path: Chỉ quét đường dẫn mới, không tự ý di chuyển (move) hay xóa file ở đường dẫn cũ.

### 7.2 Minimal User-Initiated Model Provisioning & Integrity Validation
- **Phạm vi áp dụng**: Chỉ áp dụng cho **TTS Models** và **faster-whisper Models**. Tuyệt đối không tải Local LLM models (do LM Studio tự quản lý).
- **Quy trình tải an toàn (User-Initiated Download)**:
  - Khi model còn thiếu (`Missing`), giao diện hiển thị nút `[Download]`.
  - Điểm lưu file tải về: Nằm trực tiếp trong thư mục `TTS Model Path` hoặc `Transcription Model Path` tương ứng đang được cấu hình.
  - **Quy tắc xác thực tính toàn vẹn (Integrity Validation Consistency)**:
    - File tải về được lưu tạm dưới dạng staging (`.download`), có thanh tiến độ (%), hỗ trợ Cancel và Retry, kiểm tra dung lượng đĩa trống trước khi tải.
    - **Chỉ chuyển sang trạng thái `Ready` sau khi vượt qua kiểm chứng tính toàn vẹn phù hợp**:
      - Sử dụng mã băm tin cậy (trusted checksum/hash SHA256) khi nguồn cung cấp/provider có hỗ trợ.
      - Nếu nguồn không cung cấp checksum, hệ thống bắt buộc sử dụng cơ chế xác thực mạnh nhất mà định dạng hỗ trợ (kiểm tra dung lượng file theo manifest, xác thực cấu trúc file header hoặc parse thử model weights).
      - Các file tải bị lỗi, dở dang hoặc sai lệch cấu trúc **tuyệt đối không được kích hoạt sang trạng thái `Ready`**.
- *Ranh giới*: Không tự động tải ngầm khi chưa có lệnh của người dùng; không làm model store hay rating marketplace phức tạp.

---

## 8. Settings Specification (9 Nhóm chức năng)

1. **General**: UI Language (VN/EN), Appearance (System/Light/Dark), Tự động mở lại phiên gần nhất, Ghi nhớ trạng thái giao diện, Bắt buộc xác nhận trước các thao tác xóa (Destructive Confirmation).
2. **Text to Speech**: Default TTS Model (Auto/Last Used/danh sách model), Default Voice, Default Language theo model, Default Output Format (WAV/MP3), Default Pause Mode (Auto).
3. **AI Text (Local LLM)**:
   - Server URL (ví dụ: `http://127.0.0.1:1234/v1`), Nút `Test Connection`.
   - Danh sách model tự động phát hiện qua API, chọn qua dropdown.
   - Trạng thái kết nối: *Connected*, *Not Connected*, *No Model Available*, *Model Ready*, *Provider Error*.
   - Cấu hình Per-operation Policy: AI Punctuation và AI Optimize (`Review before Apply` mặc định hoặc `Auto Apply`).
4. **Translation**:
   - Chọn Translation Provider: `Local LLM` hoặc `Google Gemini API` (Optional Cloud).
   - Ngôn ngữ nguồn (Source Language) và Ngôn ngữ đích (Target Language).
   - Ô nhập Gemini API Key (lưu bảo mật qua OS Credential Storage).
   - Cảnh báo rõ ràng việc gửi dữ liệu ra ngoài khi dùng Cloud Provider.
   - Cấu hình Per-operation Policy: `Review before Apply` (Mặc định) hoặc `Auto Apply`.
5. **Transcription**:
   - Default Language: `Auto Detect` (Mặc định) hoặc chọn trong danh sách faster-whisper.
   - Default Model: `Auto` (Khuyến nghị phần cứng), `Medium`, `Large V3`, `Large V3 Turbo`.
   - Device: `Auto`, `CUDA`, `CPU`.
   - Default Export: `TXT`, `SRT`.
6. **Models & Runtime**:
   - `TTS Model Path` kèm nút `[Browse]` và `[Rescan]`.
   - `Transcription Model Path` kèm nút `[Browse]` và `[Rescan]`.
   - Bảng trạng thái các model TTS và faster-whisper kèm nút `[Download]` cho model còn thiếu.
7. **Storage & Cache**:
   - `Configurable App Data Root`: Đường dẫn thư mục dữ liệu ứng dụng kèm nút `[Browse]` để chuyển sang ổ đĩa khác (ví dụ: `D:\VoxLabData`). Hỗ trợ quy trình Safe Migration (Copy $\rightarrow$ Verify $\rightarrow$ Activate/Rollback).
   - `Default Output Folder`: Thư mục lưu file xuất ra.
   - `Cache Location & Usage`: Hiển thị dung lượng bộ nhớ tạm đang dùng.
   - **Thao tác dọn dẹp phân định rạch ròi**:
     - `[Clear History]`: Chỉ xóa lịch sử task trong SQLite; không xóa cache, không xóa file xuất.
     - `[Clear Cache]`: Chỉ xóa các file audio tạm; không xóa file đã xuất ra thư mục output.
     - `[Delete Output]`: Người dùng tự quản lý trên file đích.
   - **Kiểm tra dung lượng đĩa động (Dynamic Free-Space Validation)**: Kiểm tra dung lượng đĩa trống trước mỗi thao tác tải model/sinh audio; cảnh báo nếu không đủ khoảng an toàn (safety margins là `TUNING REQUIRED`).
8. **System & Hardware**:
   - Hiển thị thông tin chẩn đoán: CPU, RAM, Tên GPU, VRAM khả dụng, Trạng thái CUDA, FFmpeg version, Trạng thái sẵn sàng của Model Workers.
   - Nút `[Run System Check]` để kiểm tra lại toàn bộ môi trường.
9. **About & Diagnostics**:
   - Thông tin phiên bản, Build info, nút `[Open Log Folder]`, nút `[Copy System Information]`.
   - Nút `[Reset Settings]` (khôi phục cài đặt về mặc định có xác nhận; không xóa Voice Library, không xóa file output, không xóa session data).

---

## 9. TUNING REQUIRED (Các tham số cần benchmark thực tế)

Bắt buộc phải qua benchmark thực tế trong bước Model Feasibility mới được cố định giá trị:

| Tham số | Giá trị thử nghiệm ban đầu (Dev Baseline) | Tiêu chí benchmark để chốt |
| :--- | :--- | :--- |
| **Text Chunk Size (Độ dài phân đoạn)** | Phụ thuộc theo từng profile model TTS cụ thể | Đo độ tự nhiên của giọng, tỷ lệ đọc vấp và thời gian inference |
| **Model Unload Idle Timeout** | ~120 giây sau khi hàng đợi rảnh | Cân đối giữa việc giữ VRAM sẵn sàng và giải phóng tài nguyên cho hệ thống |
| **Silence / Pause Duration mặc định** | ~400 mili-giây (cho ngắt câu) | Đánh giá độ tự nhiên và nhịp điệu của audio sau khi ghép nối |
| **Queue Concurrency (Số luồng sinh)** | 1 (Safe Sequential) | Thử nghiệm trên máy GPU mạnh (RTX 5070 Ti) xem có thể tăng an toàn không |
| **Ngưỡng phần cứng cho Auto Whisper** | Phụ thuộc dung lượng VRAM thực tế | Đảm bảo model được chọn chạy ổn định, không bị OOM |
| **Inference Parameters (Temp, Top_p, CFG)** | Giá trị mặc định theo tài liệu của từng model candidate | Đánh giá độ ổn định và chất lượng âm thanh |
| **Reference Audio Length (Thời lượng mẫu clone)** | Tùy theo model clone được chọn | Đánh giá độ giống giọng và tốc độ nạp của từng model |
| **Dung lượng đĩa an toàn tối thiểu (Free Space Margin)** | Tùy dung lượng model hoặc tác vụ sinh audio | Đảm bảo không bị lỗi đầy đĩa giữa chừng |

---

## 10. Scope Definition (Phạm vi sản phẩm)

### 10.1 IN SCOPE (Nằm trong MVP)
* Desktop shell Windows 10/11 x64 (Tauri v2 + React 19 + TypeScript).
* 4 Workspace chính: `Text to Speech`, `Voice Clone`, `Voice Library`, `Transcription`.
* 2 Workspace tiện ích: `History`, `Settings` (9 nhóm chức năng).
* Kiến trúc **Local-First Core + Explicit Optional Online Providers**.
* Cam kết tích hợp ít nhất một official Online Voice Provider nếu vượt qua thẩm định kỹ thuật/pháp lý.
* Configurable App Data Root với quy trình **Safe Data Migration** (Copy $\rightarrow$ Verify $\rightarrow$ Activate/Rollback).
* Configurable Model Paths độc lập cho TTS và Transcription.
* Model Discovery, Rescan và tái sử dụng model tương thích có sẵn.
* Minimal User-Initiated Download cho TTS Models và faster-whisper Models (có staging, progress, cancel, integrity validation).
* faster-whisper Engine với các model: `Medium`, `Large V3`, `Large V3 Turbo`, và `Auto`.
* Giao diện đa ngôn ngữ theo năng lực thực tế của model (Capability-Driven Multilingual UI); Tiếng Việt và Tiếng Anh là 2 ngôn ngữ kiểm chứng bắt buộc.
* Voice Cloning với reference audio được quản lý bền vững (Managed Assets) trong App Data Root.
* Voice Library quản lý danh sách, tìm kiếm tên, lọc theo tag, lọc theo nguồn (Local / Online), rename bền vững, delete an toàn, và "Use in TTS".
* Local LLM kết nối tới LM Studio / OpenAI-compatible endpoint (LM Studio tự quản lý GGUF/VRAM).
* Generic Translation Provider: Hỗ trợ Local LLM và Optional Cloud Provider (Google Gemini API) với chính sách Per-Operation Apply Policy (`Review before Apply` / `Auto Apply`).
* Chuẩn hóa text tất định bảo vệ Protected Spans; AI Punctuation có Lexical Guardrail; AI Optimize; Text Revision Semantics (Reject AI Revision vs Restore Original).
* Smart Chunking theo profile model; Hybrid Chunk Studio; Caching từng câu; Invalidation Stale Cache khi sửa text; Bounded Cancel & Safe Pause; **Basic Interrupted-Session Recovery (MVP target)**.
* Ghép nối audio xuất file WAV và MP3 qua FFmpeg.
* Phân định rạch ròi: Clear History $\neq$ Clear Cache $\neq$ Delete Output.

### 10.2 OUT OF SCOPE (Dứt khoát KHÔNG làm trong MVP)
* Không Project entity, không project hierarchy, không project asset manager.
* Không Full Model Marketplace / Store (không bình luận, đánh giá, auto-update ngầm).
* Không Quản lý file GGUF hay tải model LLM trực tiếp trong VoxLab.
* Không Cloud User Account, không Cloud Voice Sync.
* Không Trình biên tập timeline waveform/subtitle chuyên sâu (không kéo thả timeline mili-giây).
* Không Timing-preserving automatic video dubbing.
* Không Voice Marketplace công cộng, không AI auto-tagging.
* Không TTS hội thoại đa nhân vật tự động gán giọng.
* Không Direct SRT-to-TTS workflow tự động.
* Không Licensing / Key Activation infrastructure trong MVP.
* Không cam kết sử dụng CapCut / Edge-TTS hoặc các endpoint không chính thức trong MVP nếu chưa qua kiểm chứng pháp lý/điều khoản dịch vụ (`FEASIBILITY / LEGAL / TERMS VALIDATION REQUIRED`).

---

## 11. Observable & Verifiable Acceptance Criteria

*(Ghi chú: Toàn bộ tiêu chí nghiệm thu functional đều được xác minh bằng kết quả quan sát nhị phân; các số đo chất lượng như WER, CER, naturalness, voice similarity thuộc phạm vi của Model Feasibility / Quality Validation).*

### AC-01: Navigation & Shell Layout
- [ ] Giao diện khởi động hiển thị đầy đủ 6 mục điều hướng: `Text to Speech`, `Voice Clone`, `Voice Library`, `Transcription`, `History`, `Settings`.
- [ ] Bấm chuyển đổi giữa 6 workspace diễn ra bình thường, không gây lỗi render hay crash ứng dụng.
- [ ] Nút thu gọn sidebar hoạt động: khi thu gọn, bề rộng sidebar giảm xuống và Center Workspace mở rộng tương ứng.
- [ ] Chuyển đổi ngôn ngữ giao diện `VN` / `EN` cập nhật toàn bộ nhãn văn bản ngay lập tức.
- [ ] Chuyển đổi Appearance (`System` / `Light` / `Dark`) cập nhật chủ đề màu sắc ngay lập tức.

### AC-02: Chuẩn hóa tất định & Bảo vệ Protected Spans
- [ ] Nạp đoạn văn bản chứa Unicode tổ hợp và khoảng trắng thừa $\rightarrow$ Bấm Chuẩn hóa $\rightarrow$ Văn bản chuyển thành Unicode NFC, khoảng trắng thừa bị loại bỏ.
- [ ] Nạp văn bản chứa các chuỗi: `3.14`, `10:30`, `TP.HCM`, `v2.0`, `127.0.0.1`, `https://example.com`, `user@email.com` $\rightarrow$ Bấm Chuẩn hóa $\rightarrow$ Các chuỗi này giữ nguyên vẹn 100%, không bị chèn dấu cách làm vỡ định dạng.

### AC-03: AI Text Assistance, Guardrail & Revision Semantics
- [ ] Kết nối LM Studio thành công $\rightarrow$ Giao diện hiển thị trạng thái `Connected` và nạp danh sách model vào dropdown.
- [ ] Chạy AI Punctuation với văn bản thiếu dấu câu $\rightarrow$ Giao diện hiển thị Diff Before/After so sánh sự khác biệt.
- [ ] Giả lập LLM thay đổi từ ngữ ngoài dấu câu $\rightarrow$ Hệ thống hiển thị cảnh báo vi phạm từ vựng (Lexical Change Warning) trên giao diện Diff và vô hiệu hóa chế độ tự động áp dụng.
- [ ] Sau khi chạy một thao tác AI $\rightarrow$ Bấm `[Reject AI Revision]` $\rightarrow$ Văn bản quay lại trạng thái `Working Text` ngay trước khi gọi AI.
- [ ] Chạy nhiều thao tác liên tiếp $\rightarrow$ Bấm `[Restore Original]` $\rightarrow$ Văn bản quay lại 100% nội dung `Original Source` ban đầu.
- [ ] Khi chưa kết nối LLM hoặc chưa bật AI $\rightarrow$ Bấm sinh audio $\rightarrow$ Hệ thống sử dụng trực tiếp text hiện tại, không gửi request mạng nào tới LLM.

### AC-04: Smart Chunking & Invalidation Cache
- [ ] Kịch bản dài được phân đoạn theo thứ tự ưu tiên: Đoạn văn $\rightarrow$ Câu hoàn chỉnh $\rightarrow$ Vế câu; không có chunk nào bị cắt ngang giữa một protected span.
- [ ] Sinh audio thành công cho Chunk #001 $\rightarrow$ Chunk #001 hiển thị trạng thái `Ready` và nghe thử được audio.
- [ ] Sửa một ký tự trong text của Chunk #001 $\rightarrow$ Trạng thái của Chunk #001 chuyển sang `Modified`, audio cũ bị đánh dấu là stale/invalid và không được sử dụng khi bấm Ghép audio tổng.

### AC-05: TTS Generation & Bounded Cancellation
- [ ] Tạo bài đọc gồm nhiều chunk bằng tiếng Việt $\rightarrow$ Hệ thống hoàn tất quy trình và xuất ra file audio hợp lệ, phát được (playable non-empty audio).
- [ ] Tạo bài đọc bằng tiếng Anh $\rightarrow$ Hệ thống hoàn tất quy trình và xuất ra file audio hợp lệ, phát được.
- [ ] Đang sinh chunk #005 $\rightarrow$ Ngắt tiến trình worker bằng Task Manager $\rightarrow$ Giao diện chính không bị sập (no UI crash); Chunk #005 chuyển trạng thái `Failed`; cho phép bấm Retry riêng chunk #005.
- [ ] Đang sinh bài dài $\rightarrow$ Bấm `[Cancel]` $\rightarrow$ Hàng đợi dừng nạp chunk tiếp theo; các chunk đã xong trước đó được giữ nguyên trạng thái `Ready`; tiến trình con được thu hồi tài nguyên sạch sẽ (no orphan process).
- [ ] Bấm `[Ghép & Xuất audio]` $\rightarrow$ File `.wav` hoặc `.mp3` được tạo ra trong thư mục output, chứa toàn bộ âm thanh của các chunk theo thứ tự và có khoảng lặng phân tách.

### AC-06: Voice Clone & Multilingual Capabilities
- [ ] Nạp file `.wav` hợp lệ vào Voice Clone $\rightarrow$ Dropdown ngôn ngữ chỉ hiển thị các ngôn ngữ/chế độ mà model clone được chọn thực sự hỗ trợ.
- [ ] Nhập test text $\rightarrow$ Bấm Generate Preview $\rightarrow$ File preview audio được sinh và phát được bình thường.
- [ ] Nạp file hỏng hoặc 0 byte $\rightarrow$ Giao diện báo lỗi file không hợp lệ, nút Generate Preview bị vô hiệu hóa.
- [ ] Đặt tên "Voice Test", gắn tags $\rightarrow$ Bấm Lưu $\rightarrow$ Voice Profile xuất hiện trong *Voice Library*; file âm thanh mẫu được sao chép vào thư mục dữ liệu quản trị của VoxLab.
- [ ] Xóa file âm thanh gốc ban đầu trên máy người dùng $\rightarrow$ Voice Profile trong Voice Library vẫn phát được preview và sử dụng bình thường trong TTS.
- [ ] Đổi tên profile từ "Voice A" thành "Voice B" $\rightarrow$ Tên mới được cập nhật, Stable ID trong cơ sở dữ liệu giữ nguyên không đổi.
- [ ] Xóa một Voice Profile $\rightarrow$ Xuất hiện hộp thoại xác nhận cảnh báo; bấm xác nhận $\rightarrow$ Profile biến mất khỏi Library nhưng các file audio đã sinh trước đó trong ổ cứng không bị xóa.

### AC-07: Voice Library, Online Voices & "Use in TTS"
- [ ] Tại Voice Library: Bộ lọc Source hiển thị đầy đủ các tùy chọn `All`, `Local`, `Online`.
- [ ] Nếu có Online Voice Provider hợp lệ được kích hoạt, các giọng này bắt buộc hiển thị huy hiệu `ONLINE`.
- [ ] Khi ngắt kết nối mạng $\rightarrow$ Các giọng Online báo lỗi mạng rõ ràng, trong khi các giọng Local vẫn hoạt động bình thường, không bị ảnh hưởng.
- [ ] Bấm `[Use in TTS]` trên một profile $\rightarrow$ Ứng dụng tự động chuyển sang tab Text to Speech và đặt profile này làm Active Voice của phiên.

### AC-08: Standalone Transcription & faster-whisper
- [ ] Nạp file âm thanh tiếng Việt vào Transcription $\rightarrow$ Bật `Auto Detect` $\rightarrow$ faster-whisper tự động nhận diện ngôn ngữ tiếng Việt (metadata trả về đúng `vi`) và bóc băng ra transcript có cấu trúc, không rỗng.
- [ ] Nạp file âm thanh tiếng Anh $\rightarrow$ faster-whisper hoàn thành quy trình và xuất ra transcript có cấu trúc hợp lệ, không rỗng, chứa đúng các mốc thời gian chuẩn.
- [ ] Tùy chọn Model `Auto` tự động chọn kích thước model tương thích phần cứng theo cấu hình, không gây lỗi OOM và thực thi bóc băng thành công.
- [ ] Bấm `[Xuất file .TXT]` $\rightarrow$ Tạo file `.txt` chứa toàn bộ văn bản.
- [ ] Bấm `[Xuất file .SRT]` $\rightarrow$ Tạo file phụ đề `.srt` hợp lệ với các mốc thời gian chuẩn `00:00:00,000 --> 00:00:00,000`.
- [ ] Bấm `[Chuyển sang TTS]` $\rightarrow$ Văn bản được nạp sang tab Text to Speech làm working text mới; transcript gốc tại tab Transcription giữ nguyên.

### AC-09: Model Discovery, User-Initiated Download & Integrity
- [ ] Tại Settings $\rightarrow$ Đổi `TTS Model Path` sang thư mục tùy chọn $\rightarrow$ Khởi động lại app $\rightarrow$ Đường dẫn mới được lưu bền vững; các model có sẵn trong thư mục đó được nhận diện mà không cần tải lại.
- [ ] Tại Settings $\rightarrow$ Bấm `[Rescan]` $\rightarrow$ Danh sách model cập nhật ngay lập tức nếu có file model mới được copy thủ công vào thư mục.
- [ ] Model faster-whisper ở trạng thái `Missing` $\rightarrow$ Bấm `[Download]` $\rightarrow$ File tải về được lưu tạm dưới dạng `.download` trong đúng thư mục đã cấu hình, có thanh tiến độ (%).
- [ ] Trong khi đang tải model $\rightarrow$ Bấm `[Cancel]` $\rightarrow$ Tiến trình tải dừng lại, file tải dở dang được dọn dẹp sạch sẽ, không tạo ra trạng thái model hợp lệ giả mạo.
- [ ] Quá trình tải hoàn tất $\rightarrow$ Hệ thống thực hiện kiểm chứng tính toàn vẹn (bằng SHA256 checksum nếu nguồn cung cấp, hoặc kiểm tra cấu trúc file/header mạnh nhất) $\rightarrow$ Chỉ chuyển sang `Ready` sau khi xác thực hợp lệ; file tải bị lỗi/hỏng không bao giờ trở thành `Ready`.

### AC-10: Translation Providers & Per-Operation Policy
- [ ] Chọn Translation Provider là `Local LLM` $\rightarrow$ Thao tác dịch hoàn thành qua endpoint cục bộ mà không phát sinh kết nối internet.
- [ ] Chọn Translation Provider là `Google Gemini API` $\rightarrow$ Giao diện hiển thị thông báo rõ ràng rằng văn bản sẽ được gửi ra bên ngoài.
- [ ] Nhập Gemini API Key $\rightarrow$ Key được lưu bảo mật qua OS Credential Storage, không xuất hiện dưới dạng plaintext trong file SQLite `voxlab.db`.
- [ ] Giả lập mất mạng khi dịch bằng Cloud Provider $\rightarrow$ Hệ thống báo lỗi mạng rõ ràng, tuyệt đối không tự ý chuyển ngầm sang Local LLM nếu người dùng không yêu cầu.
- [ ] Khi cấu hình Translation là `Review before Apply` (mặc định) $\rightarrow$ Dịch xong bắt buộc mở Diff View để xem xét. Khi bật `Auto Apply` $\rightarrow$ Văn bản dịch được tự động ghi vào Working Text, nhưng bản Original Source vẫn được bảo toàn và có thể bấm `[Restore Original]`.

### AC-11: Configurable Data Root, Safe Migration & Data Separation
- [ ] Đổi `Configurable App Data Root` từ thư mục mặc định sang vị trí mới (ví dụ: `C:\Users\...\AppData` sang `D:\VoxLabData`) khi đã có dữ liệu cũ $\rightarrow$ Ứng dụng hiển thị hộp thoại chuyển dữ liệu (Migration Dialog).
- [ ] Bấm xác nhận chuyển $\rightarrow$ Hệ thống thực hiện sao chép toàn bộ database, sessions, Voice Library và managed assets sang vị trí mới, kiểm chứng tính toàn vẹn, và kích hoạt đường dẫn mới.
- [ ] Giả lập lỗi trong quá trình di chuyển (ví dụ: ổ đĩa đích bị đầy) $\rightarrow$ Hệ thống rollback an toàn, giữ nguyên Data Root cũ và không làm mất bất kỳ dữ liệu nào ở vị trí cũ.
- [ ] Bấm `[Clear History]` $\rightarrow$ Danh sách trong History bị xóa; cache và file thành phẩm trong output folder giữ nguyên.
- [ ] Bấm `[Clear Cache]` $\rightarrow$ Các file audio tạm trong thư mục cache bị xóa; History và output folder giữ nguyên.
- [ ] Bấm `[Reset Settings]` $\rightarrow$ Cài đặt quay về mặc định có xác nhận; Voice Library, session history và file output không bị xóa.

### AC-12: Offline Core Integrity & Zero Telemetry
- [ ] Ngắt hoàn toàn kết nối internet (tắt Wi-Fi / rút dây mạng) $\rightarrow$ Thực hiện toàn bộ chu trình cốt lõi: Chuẩn hóa text, Chia chunk, TTS bằng model local, Ghép audio, Bóc băng bằng faster-whisper local, Dịch bằng Local LLM $\rightarrow$ Mọi chức năng cốt lõi chạy bình thường, không phát sinh bất kỳ thông báo lỗi mạng nào.
- [ ] Không có bất kỳ gói tin telemetry hay dữ liệu người dùng nào được gửi ra internet trong toàn bộ quá trình sử dụng các tính năng local.

### AC-13: Basic Interrupted-Session Recovery (MVP Target)
- [ ] Tạo bài đọc gồm 20 chunk, sinh thành công 10 chunk đầu tiên $\rightarrow$ Tắt ứng dụng hoặc ép ngắt tiến trình (Task Manager) $\rightarrow$ Mở lại ứng dụng và chọn Reopen/Resume phiên đó.
- [ ] Hệ thống kiểm tra cache và metadata $\rightarrow$ 10 chunk đã sinh thành công được khôi phục trạng thái `Ready` và nghe thử được ngay lập tức.
- [ ] Người dùng bấm Sinh tiếp $\rightarrow$ Hệ thống chỉ sinh tiếp từ chunk #11 đến #20 mà không sinh lại 10 chunk đầu tiên; sau khi hoàn thành bấm Ghép audio tạo ra file hoàn chỉnh 20 chunk.

---

### KẾT LUẬN & DỪNG GATE B

Tài liệu `SPEC.md` v2.3.0 đã hoàn thành **Final Consistency Pass**, giải quyết triệt để cả 8 yêu cầu tinh chỉnh của bạn:
1. Đã có quy trình **Safe Data Root Migration** an toàn (Copy $\rightarrow$ Verify $\rightarrow$ Activate/Rollback) kèm AC-11.
2. Đã khôi phục chi tiết quy trình **Basic Interrupted-Session Recovery** kèm AC-13.
3. Đã khôi phục chính sách độc lập **Review before Apply / Auto Apply** cho Translation kèm AC-10.
4. Đã đặc tả năng lực **Voice Clone Multilingual + Capability-driven** kèm AC-06.
5. Đã loại bỏ 100% từ ngữ cảm tính chủ quan khỏi Acceptance Criteria (AC-08 chuyển sang tiêu chí nhị phân kiểm chứng được).
6. Đã chuẩn hóa quy trình **Integrity Validation** (dùng trusted checksum nếu nguồn hỗ trợ; nếu không dùng cơ chế xác thực mạnh nhất theo định dạng; lỗi không bao giờ chuyển sang Ready) kèm AC-09.
7. Đã chốt **Online Voice Provider Commitment** (cam kết ít nhất 1 official provider nếu vượt qua thẩm định; loại bỏ endpoint lậu; defer nếu không đạt).
8. Toàn bộ các yêu cầu nền tảng đã duyệt đều được bảo toàn nguyên vẹn 100%.

Không còn bất kỳ blocker hay điểm mơ hồ nào cản trở việc chuyển sang Phase 4 (Plan).

# **READY FOR GATE B USER REVIEW**
*(Đang dừng tại GATE B theo AGENT_WORKFLOW.txt. Xin mời bạn xem xét và đưa ra quyết định phê duyệt chính thức).*
