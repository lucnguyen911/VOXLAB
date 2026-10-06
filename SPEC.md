# VoxLab — Product & Technical Specification (SPEC.md)

**Document Version**: 2.5.3 (Approved Specification: Final ASR Speed Remap, Memory Model, Configurable Performance Architecture)
**Phase**: Phase 4 — Implementation Plan (/plan)
**Status**: APPROVED AT GATE B — PLANNING IN PROGRESS
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

## 3. High-Level Architecture, Storage Boundaries & Lifecycle

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
│  - App Update Manager & Ordered Schema Migrations ($N \rightarrow N+1$)        │
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

### 3.3 Vòng đời Cập nhật Ứng dụng & Tương thích Dữ liệu Bền vững (Application Update & Persistent Data Compatibility)
- **Nguyên tắc cốt lõi**: Cập nhật phiên bản ứng dụng VoxLab **TUYỆT ĐỐI KHÔNG ĐƯỢC XÓA HOẶC RESET DỮ LIỆU CỦA NGƯỜI DÙNG** (Updating VoxLab MUST NOT delete or reset existing user data).
- **Phân định đối tượng thay thế khi Update**:
  - *Được phép thay thế (MAY REPLACE)*: File thực thi ứng dụng (`voxlab.exe`), tài nguyên giao diện frontend (`dist/`), runtime/backend đi kèm, bundled worker scripts, các file tĩnh bất biến của app.
  - *Bắt buộc bảo toàn nguyên vẹn (MUST PRESERVE)*: Cơ sở dữ liệu SQLite (`voxlab.db`), toàn bộ cài đặt (settings), metadata các phiên và lịch sử (sessions/history), các Voice Profiles, toàn bộ tài sản âm thanh mẫu được quản lý (managed reference assets), cấu hình đường dẫn (`Configured Data Root`, `TTS Model Path`, `Transcription Model Path`, `Output Path`), các model TTS đã tải, các model faster-whisper đã tải, các file âm thanh/văn bản người dùng đã xuất, và thông tin xác thực bảo mật (credentials).
  - Quá trình cập nhật tuyệt đối không được đối xử như một lần cài mới (clean install) trừ khi người dùng chủ động yêu cầu xóa sạch dữ liệu khi gỡ cài đặt.
- **Cơ chế Định vị Data Root khi Cập nhật / Khởi động (Bootstrap Data Root Discovery)**:
  - Do người dùng có thể cấu hình App Data Root ở ổ đĩa tùy chọn ngoài mặc định (ví dụ `D:\VoxLabData`), bản binary mới sau khi cập nhật phải có cơ chế bootstrap bền vững (stable bootstrap mechanism qua file cấu hình nhẹ tại vị trí người dùng chuẩn của OS hoặc registry) để tự động nhận diện lại đúng Data Root đang hoạt động.
  - Nếu không thể tự động định vị Data Root: **Tuyệt đối không âm thầm khởi tạo môi trường rỗng mới** (khiến người dùng tưởng bị mất dữ liệu). Hệ thống bắt buộc phải hiển thị giao diện phục hồi: *"Không tìm thấy thư mục dữ liệu cũ, vui lòng chọn lại đường dẫn Data Root hiện có (Locate Existing Data Root)"*.
- **Versioned Persistent Data & Ordered Schema Migrations**:
  - Cơ sở dữ liệu SQLite bắt buộc có cơ chế quản lý phiên bản schema tường minh (`PRAGMA user_version` hoặc bảng `schema_version`).
  - Khi phiên bản VoxLab mới yêu cầu cấu trúc schema mới:
    - *Quy trình an toàn*: **Schema cũ $\rightarrow$ Sao lưu có thể phục hồi (Recoverable Backup) $\rightarrow$ Chạy các migrations theo thứ tự tuần tự ($N \rightarrow N+1 \rightarrow N+2$) $\rightarrow$ Kiểm chứng toàn vẹn (Validation) $\rightarrow$ Kích hoạt schema mới**.
    - Tuyệt đối không xóa hay ghi đè hủy hoại cơ sở dữ liệu. Migrations phải có tính tất định (deterministic) và có phiên bản.
  - **Xử lý sự cố Migration (Migration Failure Recovery)**: Nếu quá trình migration gặp lỗi:
    - Lập tức dừng lại, phục hồi lại dữ liệu cũ từ bản backup, không xóa bản backup.
    - Tuyệt đối không âm thầm khởi tạo một file database trống thay thế.
    - Báo lỗi nâng cấp tường minh kèm thông tin chẩn đoán.
    - Việc cài đặt file thực thi mới thành công chưa đủ để coi là update thành công; bắt buộc phải vượt qua bước xác thực tương thích dữ liệu trong lần khởi động đầu tiên (First-launch data compatibility verification).
- **Tách biệt Dữ liệu Bền vững và Bộ nhớ đệm Tái tạo được (Cache Compatibility)**:
  - Phân định rạch ròi giữa dữ liệu bền vững (DB, sessions, Voice Profiles, managed assets, settings) và cache tạm có thể tái tạo (temporary chunk cache, waveform data, chỉ mục tạm).
  - Nếu định dạng cache bị thay đổi giữa các phiên bản phần mềm: Cache có thể bị vô hiệu hóa hoặc xây dựng lại (rebuild) an toàn.
  - Tuyệt đối không xóa file xuất, file nguồn, voice assets hay thư mục model dưới danh nghĩa "dọn dẹp cache".
- **Ranh giới độc lập giữa Cập nhật Ứng dụng và Cập nhật Model (Model Update Boundary)**:
  - Cập nhật phiên bản VoxLab **tuyệt đối không tự động ghi đè hoặc xóa** các file model TTS và ASR.
  - Cập nhật app và cập nhật model là 2 vòng đời hoàn toàn độc lập.
  - Nếu phiên bản mới yêu cầu hoặc khuyến nghị revision model mới: hệ thống phát hiện tương thích, thông báo cho người dùng, người dùng chủ động kích hoạt tải model mới (có staging + validation). Tuyệt đối không tải lại hay xóa model tương thích đã có chỉ vì phiên bản app thay đổi.
- **An toàn khi Hạ cấp Phiên bản (Downgrade Safety)**:
  - Nếu một phiên bản VoxLab cũ hơn cố gắng mở cơ sở dữ liệu có schema phiên bản mới hơn: hệ thống **báo lỗi không tương thích tường minh (fail explicitly)**, **tuyệt đối không ghi/thay đổi database**, và thông báo cho người dùng rằng dữ liệu này yêu cầu phiên bản VoxLab mới hơn. (Không yêu cầu migration hạ cấp tự động trong MVP).

---

## 4. Navigation & Workspace Specifications

### 4.1 Cấu trúc Navigation bên trái (Left Sidebar)
Sidebar hỗ trợ thu gọn (collapsible) với 7 không gian làm việc phân tầng rành mạch:
* **PRIMARY WORKSPACES**:
  1. `Text to Speech` (Không gian TTS kịch bản dài)
  2. `Voice Clone` (Không gian tạo giọng mẫu mới)
  3. `Voice Library` (Không gian quản lý và tái sử dụng giọng)
  4. `Phụ đề` (Không gian bóc băng ASR & tối ưu phụ đề chuyên biệt — Single Responsibility)
  5. `Dịch & Lồng tiếng` (Không gian dịch nội dung & sản xuất audio lồng tiếng — Dedicated Dubbing Workspace)
* **UTILITY**:
  6. `History` (Lịch sử các phiên xử lý gần đây)
  7. `Settings` (Cài đặt hạ tầng & provider tập trung — Infrastructure Only)

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
- **Chức năng quản trị**:
  - Danh sách giọng kèm metadata: Tên, Tags, Model, Ngôn ngữ, Loại giọng.
  - Tìm kiếm theo tên (Search by Name) và Lọc theo Tag (Filter by Tag).
  - Đổi tên (Rename) và Sửa Tags mà **không làm thay đổi Stable Identity**.
  - **Xóa an toàn (Delete Voice Safety)**: Yêu cầu xác nhận (confirmation dialog); nếu giọng đang được tham chiếu bởi các session cũ thì phải cảnh báo trước; xóa voice profile **tuyệt đối không tự động xóa** các file audio chunk hoặc WAV/MP3 đã sinh trước đó.
  - **Cầu nối `[Use in TTS]`**: Bấm một chạm để chuyển sang tab Text to Speech và đặt profile này làm active voice.

#### 4.2.4 Workspace 4: Phụ đề (Single Responsibility Subtitle Workspace)
*Nguyên tắc: Phụ đề = SPEECH TO SUBTITLE ONLY*.
- **Mục tiêu duy nhất**: Nhận diện âm thanh/video $\rightarrow$ Phân tích protected spans $\rightarrow$ Bóc băng ASR (faster-whisper) $\rightarrow$ Tối ưu hóa cue subtitle $\rightarrow$ Chỉnh sửa văn bản cue $\rightarrow$ Xuất SRT/TXT.
- **Loại bỏ hoàn toàn**: Không chứa bất kỳ cấu hình dịch thuật nào (không có Ngôn ngữ dịch, Model dịch, Gemini, DeepSeek, LM Studio translation, API keys).
- **Right Panel cố định: "CÀI ĐẶT PHỤ ĐỀ"**:
  - Gồm 2 nhóm rõ rệt:
    1. **Nhóm Nhận diện**:
       - Ngôn ngữ âm thanh (`audioLanguage`): Tự động nhận diện (auto) hoặc chọn ngôn ngữ cụ thể.
       - Mô hình Whisper (`whisperModel`): large-v3-turbo, large-v3, medium.
       - Tốc độ giọng nói (`speechSpeed`): 1.0x (Bình thường), 0.9x (Giọng nhanh), 0.8x (Giọng rất nhanh).
       - Tốc độ xử lý (`processingSpeed`): auto, 1x, 2x, 4x, 8x.
       - *Quy tắc Invalidation*: Khi thay đổi bất kỳ setting nào trong nhóm này sau khi đã có kết quả $\rightarrow$ Invalidate kết quả ASR cũ, chuyển sang trạng thái yêu cầu nhận diện lại.
    2. **Nhóm Hiển thị**:
       - Tỷ lệ khung hình (`aspectRatio`): 16:9 (Ngang), 9:16 (Dọc), 1:1 (Vuông).
       - Số dòng phụ đề (`maxLines`): 1 dòng, 2 dòng.
       - *Quy tắc Invalidation*: Khi thay đổi tỷ lệ khung hình hoặc số dòng $\rightarrow$ Tái tối ưu lại cue từ mảng word timestamps có sẵn trong bộ nhớ. **Tuyệt đối không chạy lại Whisper ASR**.
- **Cầu nối Handoff**:
  - Nút hành động tại Top Header: **`[Chuyển sang Dịch & Lồng tiếng ➔]`** (thay thế nút "Chuyển sang TTS" cũ).
  - Xuất ra một **Immutable Handoff Snapshot** chứa toàn bộ cues gốc kèm timestamps và metadata media sang tab `dubbing`.

#### 4.2.5 Workspace 5: Dịch & Lồng tiếng (Dedicated Dubbing Workspace)
*Nguyên tắc: Dịch & Lồng tiếng = TRANSLATE & DUB SUBTITLE TIMELINE*.
- **Đầu vào (Input)**:
  - Handoff snapshot trực tiếp từ tab Phụ đề.
  - Hoặc nhập file phụ đề có sẵn (.SRT / .VTT) từ máy tính.
- **Tiêu thụ Provider (Consumer Pattern)**:
  - Chọn Provider đã cấu hình trong Settings (Google, LM Studio, Gemini, DeepSeek, Custom).
  - Chọn Ngôn ngữ đích.
  - Nếu Provider chưa cấu hình API Key hoặc Local server offline: Hiển thị badge trạng thái kèm nút `[Cấu hình trong Settings]` (deep-link). Không nhập API Key trực tiếp tại đây.
- **Quy trình Review/Edit bắt buộc (Side-by-Side Review Grid)**:
  - Cột trái: Cue gốc (Original Cue) — Read-only, kèm timestamps và thời lượng khả dụng.
  - Cột phải: Cue dịch (Translated Cue) — Inline editable, hiển thị trạng thái sinh audio, thời lượng audio đã tạo, và badge cảnh báo overflow/collision nếu có.
- **Lồng tiếng (Dubbing Execution)**:
  - Chọn 1 giọng đọc chung (Single Voice) từ Voice Library / Voice Clone.
  - Hàng đợi sinh audio từng câu qua `BatchConcurrencyQueue` (hỗ trợ Concurrency, Pause, Resume, Cancel).
  - Áp dụng WSOLA time-stretch co giãn nhẹ tối đa 15–20% ($1.20\times$) nếu audio dài hơn cue gốc mà không làm méo cao độ giọng.
  - Tách bạch Source Subtitle Timeline (bất biến) và Dubbing Audio Timeline (neo tại start time, tính toán overflow metadata, **không ripple-shift các cue phía sau**).
- **Đầu ra (Output)**:
  - Xuất file Audio lồng tiếng hoàn chỉnh (`.wav`) ghép nối chuẩn xác theo timeline.
  - Xuất file Phụ đề đã dịch (`.srt`) kế thừa 100% timestamps của source subtitle.

#### 4.2.6 Workspace 6: History (Utility)
- Danh sách các phiên xử lý (sessions) gần đây kèm thời gian, tác vụ, trạng thái.
- Hành động: `[Reopen/Resume]`, `[Mở thư mục output]`, `[Xóa lịch sử]` (chỉ xóa bản ghi metadata, không xóa file thành phẩm trên đĩa).

#### 4.2.7 Workspace 7: Settings (Utility — Cấu hình hạ tầng tập trung)
- Quản lý hạ tầng: Endpoint LM Studio, Gemini API Key, DeepSeek credentials, connection state.
- Loại bỏ hoàn toàn trang `Settings > Phụ đề` trùng lặp; tự động migrate settings cũ sang schema mới an toàn.

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
1. Unicode Normalization Form C (NFC) chuẩn hóa ký tự sang dạng dựng sẵn (precomposed characters), áp dụng thống nhất đa ngôn ngữ.
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
* **Application Update & Persistent Data Compatibility**:
  * Tách biệt đối tượng thay thế (app binary, assets) và đối tượng bảo toàn (DB, settings, profiles, assets, models, outputs).
  * Bootstrap Data Root Discovery tự động nhận diện Data Root đã cấu hình khi cập nhật app hoặc mở giao diện phục hồi nếu mất dấu.
  * Versioned Persistent Data & Ordered Schema Migrations ($N \rightarrow N+1 \rightarrow N+2$) có backup phục hồi và kiểm chứng tương thích khi khởi động lần đầu.
  * Tách biệt dữ liệu bền vững và cache tạm tái tạo được.
  * Độc lập vòng đời giữa cập nhật app và cập nhật model.
  * Cơ chế Downgrade Safety ngăn ngừa hỏng database khi mở bằng bản cũ.
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
* Không yêu cầu automatic downgrade migration cho schema database (chỉ yêu cầu fail an toàn, không làm hỏng dữ liệu).

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

### AC-14: Application Update & Persistent Data Preservation
- [ ] Cài đặt VoxLab phiên bản N, tạo cấu hình: đổi theme, chỉnh TTS Model Path và Transcription Model Path sang ổ D, đổi Data Root sang `D:\VoxLabData`, tạo một Voice Profile kèm reference audio, chạy 1 session TTS và xuất file `.wav`.
- [ ] Nâng cấp ứng dụng lên phiên bản N+1 (thay thế binary executable/assets).
- [ ] Khởi động lần đầu phiên bản N+1: Bootstrap Data Root Discovery tự động nhận diện chính xác `D:\VoxLabData`; nếu phiên bản N+1 yêu cầu DB schema mới, hệ thống tự động chạy ordered migration thành công; toàn bộ Voice Profiles đã lưu hiển thị đầy đủ và phát được preview; History/Sessions cũ được giữ nguyên; cấu hình settings và model paths giữ nguyên; các model TTS và faster-whisper trong thư mục đã cấu hình được nhận diện và tái sử dụng trực tiếp mà không tải lại; file audio đã xuất trong thư mục output giữ nguyên vẹn 100%.

### AC-15: Migration Failure Recovery, Cache Invalidation & Downgrade Safety
- [ ] Giả lập lỗi trong quá trình thực thi DB migration khi update lên phiên bản mới: Hệ thống tự động rollback phục hồi lại database cũ từ bản backup, không xóa bản backup, không tự ý kích hoạt một database rỗng thay thế, và hiển thị thông báo lỗi nâng cấp rõ ràng cho người dùng.
- [ ] Giả lập định dạng cache cũ không tương thích giữa 2 phiên bản phần mềm: Hệ thống tự động vô hiệu hóa/rebuild cache mà không xóa hoặc làm hỏng database, Voice Profiles, file output hoặc thư mục model.
- [ ] Sử dụng phiên bản VoxLab cũ để mở database đã được nâng cấp lên schema mới hơn: Ứng dụng từ chối mở, hiển thị lỗi không tương thích phiên bản, và không thực hiện bất kỳ thao tác ghi đè hay thay đổi nào lên database.

---

## 16. Phân định Trách nhiệm: Subtitle Single-Responsibility, Dedicated Dubbing Workspace & Settings Separation

### 16.1 Domain & Data Models

Hệ thống định nghĩa các kiểu dữ liệu lõi với ranh giới trách nhiệm và tính bất biến nghiêm ngặt:

#### 16.1.1 `OriginalCue` (Source Subtitle Unit)
```typescript
export interface OriginalCue {
  index: number;         // 1-based sequential cue index
  startSec: number;      // Start timestamp on source timeline (seconds, 3 decimal precision)
  endSec: number;        // End timestamp on source timeline (seconds, 3 decimal precision)
  text: string;          // Source transcript text (read-only in Dubbing workspace)
}
```

#### 16.1.2 `TranslatedCue` (Review & Edit Unit)
```typescript
export interface TranslatedCue {
  index: number;         // Identical to OriginalCue.index
  startSec: number;      // STRICTLY EQUAL to OriginalCue.startSec (Source Subtitle Timeline)
  endSec: number;        // STRICTLY EQUAL to OriginalCue.endSec (Source Subtitle Timeline)
  originalText: string;  // Reference to source text for side-by-side display
  text: string;          // Editable translated text (user can revise inline)
  isEdited?: boolean;    // Flag indicating manual user edit after AI translation
}
```

#### 16.1.3 `DubAudioSegment` (Audio Synthesis & Fitting Unit)
```typescript
export interface DubAudioSegment {
  cueIndex: number;          // Mapped cue index
  audioUrl?: string;         // Blob URL or cached WAV path of raw TTS audio
  rawDurationSec: number;    // Raw TTS audio duration
  targetDurationSec: number; // Available duration on source timeline (endSec - startSec)
  fittedAudioUrl?: string;   // Processed audio after WSOLA time-stretch (if stretched)
  fittedDurationSec: number; // Final duration after WSOLA (or raw if no stretch)
  speedFactor: number;       // WSOLA speed ratio applied (e.g. 1.0 to 1.20)
  audioStartSec: number;     // Absolute audio start on dub timeline (= OriginalCue.startSec)
  audioEndSec: number;       // Absolute audio end on dub timeline (= audioStartSec + fittedDurationSec)
  status: "idle" | "generating" | "ready" | "failed" | "modified";
  errorMessage?: string;
}
```

#### 16.1.4 `TimingOverflowMetadata` (Collision & Overflow Detection)
```typescript
export interface TimingOverflowMetadata {
  cueIndex: number;
  hasOverflow: boolean;          // true if audioEndSec > OriginalCue.endSec
  overflowSec: number;           // audioEndSec - OriginalCue.endSec (positive = overflow)
  hasCollision: boolean;         // true if audioEndSec > nextOriginalCue.startSec
  collisionWithIndex?: number;   // index of subsequent cue that overlaps
  collisionSec: number;          // overlap amount in seconds
  warningLevel: "none" | "overflow_only" | "collision_danger";
}
```

#### 16.1.5 `DubbingProjectSession` (State Management & Persistence)
```typescript
export interface DubbingProjectSession {
  id: string;
  sourceMediaName?: string;
  sourceDurationSec?: number;
  originalCues: OriginalCue[];
  translatedCues: TranslatedCue[];
  audioSegments: Record<number, DubAudioSegment>;
  overflowAnalysis: Record<number, TimingOverflowMetadata>;
  sourceLang: string;
  targetLang: string;
  selectedProviderId: string;
  selectedVoiceId: string;
  overallStatus: "draft" | "translated" | "dubbing" | "completed";
  createdAt: number;
  updatedAt: number;
}
```

### 16.2 Hai Trục Thời Gian, Ngữ Nghĩa Co Giãn Tốc Độ (WSOLA Semantics) & Chính Sách Xuất Audio

Hệ thống phân định rạch ròi giữa 2 trục thời gian độc lập:

1. **Source Subtitle Timeline (Trục thời gian Phụ đề Gốc)**:
   - **Tính chất**: Bất biến (`IMMUTABLE`).
   - `startSec` và `endSec` của mọi `OriginalCue` và `TranslatedCue` đại diện cho timeline của video/audio gốc.
   - **Quy tắc Xuất SRT**: Khi xuất file phụ đề đã dịch (`.srt`), hệ thống **BẮT BUỘC** sử dụng `TranslatedCue.startSec` và `TranslatedCue.endSec`. Tuyệt đối không xê dịch mốc thời gian của phụ đề theo thời lượng audio lồng tiếng.
2. **Dubbing Audio Timeline (Trục thời gian Âm thanh Lồng tiếng)**:
   - **Tính chất**: Neo tại điểm bắt đầu (`audioStartSec = OriginalCue.startSec`).
   - Thời lượng khả dụng của cue trên timeline gốc: `availableDuration = OriginalCue.endSec - OriginalCue.startSec`.
3. **Ngữ Nghĩa Hệ Số Tăng Tốc WSOLA (WSOLA Speedup Factor Semantics)**:
   - Thuật toán WSOLA áp dụng hàm `timeStretchAudioBuffer(inputBuffer, speedFactor)` trong [`src/services/subtitle/timing.ts`](file:///f:/Source%20Code%20Tool/Voxlab/src/services/subtitle/timing.ts):
     - `speedFactor` là hệ số tăng tốc (speedup factor).
     - Giới hạn trần tối đa bảo toàn tự nhiên giọng nói: `MAX_DUB_SPEEDUP = 1.20` (tăng tốc tối đa 20%, tương đương thời lượng giảm xuống còn $\frac{\text{rawDuration}}{1.20} \approx 83.33\%$).
     - Thời lượng tối thiểu sau khi ép tốc độ: `minimumFittedDuration = rawDuration / 1.20`.
   - **Quy tắc xác định `speedFactor` và `fittedDurationSec`**:
     - Nếu $\text{rawDuration} \le \text{availableDuration}$:
       $$\text{speedFactor} = 1.0 \quad \text{(Không co giãn âm thanh, giữ nguyên 100% tự nhiên)}$$
       $$\text{fittedDurationSec} = \text{rawDuration}$$
     - Nếu $\text{rawDuration} > \text{availableDuration}$:
       $$\text{speedFactor} = \min\left(\frac{\text{rawDuration}}{\text{availableDuration}}, 1.20\right)$$
       $$\text{fittedDurationSec} = \frac{\text{rawDuration}}{\text{speedFactor}}$$
     - Nếu $\frac{\text{rawDuration}}{1.20} > \text{availableDuration}$: Audio sau khi tăng tốc tối đa $1.20\times$ vẫn dài hơn cue gốc $\rightarrow$ chuyển sang đánh giá va chạm trên timeline.
4. **Phân loại Trạng thái Thời lượng & Chính sách Xuất Audio**:
   - Mốc kết thúc âm thanh trên dubbing timeline: `audioEndSec = OriginalCue.startSec + fittedDurationSec`.
   - **Trường hợp A — `overflow_only` (Tràn thời lượng nhưng không va chạm)**:
     - Điều kiện: `audioEndSec > OriginalCue.endSec` VÀ `audioEndSec <= nextOriginalCue.startSec`.
     - Hành vi: Cho phép giữ audio dài hơn cue gốc (lấn an toàn vào khoảng im lặng tự nhiên giữa 2 câu thoại); không mutate source timestamps; không ripple-shift.
     - **Quy định Xuất Master WAV**: **HỢP LỆ ĐỂ XUẤT (ALLOWED TO EXPORT)**. Hiển thị nhãn cảnh báo nhẹ (vàng) trên UI để người dùng nắm thông tin.
   - **Trường hợp B — `collision_danger` (Va chạm âm thanh với câu kế tiếp)**:
     - Điều kiện: `audioEndSec > nextOriginalCue.startSec`.
     - Hành vi bắt buộc:
       1. Đánh dấu trạng thái `collision_danger` với badge màu đỏ nổi bật trên UI.
       2. **TUYỆT ĐỐI KHÔNG mix/chồng đè** 2 đoạn âm thanh lời thoại lên nhau.
       3. **TUYỆT ĐỐI KHÔNG tự ý cắt bớt (truncate)** âm thanh của câu thoại.
       4. **TUYỆT ĐỐI KHÔNG delay / ripple-shift** câu hiện tại hoặc các câu phía sau.
       5. **TUYỆT ĐỐI KHÔNG tự sửa** timeline phụ đề.
       6. **CHẶN XUẤT MASTER WAV (BLOCK EXPORT)**: Vô hiệu hóa nút xuất Master WAV hoặc chặn xuất với thông báo lỗi rõ ràng cho tới khi người dùng giải quyết xong va chạm.
       7. **Hướng dẫn người dùng khắc phục trên UI**: Chỉ rõ câu bị va chạm, hướng dẫn người dùng rút ngắn câu dịch, chỉnh sửa text và bấm tạo lại audio riêng câu đó.
       8. **MVP không có tùy chọn "Force export overlapping speech"**.
   - **Tính độc lập của Phụ đề Dịch**: File phụ đề đã dịch (`_translated.srt`) **VẪN ĐƯỢC PHÉP XUẤT BÌNH THƯỜNG** ngay cả khi có `collision_danger` vì phụ đề hoàn toàn độc lập với âm thanh lồng tiếng và sử dụng source timestamps gốc.

### 16.3 Ràng Buộc Dịch Thuật Bất Biến 1:1 (Translation Cue Invariant & Validator)

1. **Hard Invariant**: Thao tác Dịch thuật (Translation) **CHỈ ĐƯỢC PHÉP THAY ĐỔI TEXT**.
2. **Quy tắc Bảo toàn Tuyệt đối 1:1**:
   - `cue count`: Số lượng câu dịch bắt buộc bằng chính xác số lượng câu gốc (`translatedCues.length === originalCues.length`).
   - `cue index`: Chỉ số thứ tự từng câu phải khớp 100% (`translatedCues[i].index === originalCues[i].index`).
   - `cue order`: Thứ tự xuất hiện tuần tự nghiêm ngặt (1, 2, ..., N).
   - `timestamps`: `startSec` và `endSec` phải giống hệt bản gốc.
   - `mapping`: Ánh xạ 1:1 duy nhất giữa `originalCue.index` $\rightarrow$ `translatedCue.index`.
3. **Cấm Tuyệt đối Các Hành Vi Sau từ Provider / LLM**:
   - Gộp nhiều câu thành một câu (Merge cues).
   - Tách một câu thành nhiều câu (Split cues).
   - Đảo lộn thứ tự các câu (Reorder cues).
   - Bỏ sót câu (Drop cues).
   - Chèn thêm câu không có trong bản gốc (Insert extra cues).
4. **Hàm Xác thực Nghiêm ngặt (Strict Response Validator)**:
   - Trước khi kết quả dịch từ Provider được commit vào state của dự án, hệ thống bắt buộc chạy hàm xác thực `validateTranslationResponse1to1(originalCues, translatedCues)`.
   - Nếu kết quả trả về từ Provider không đáp ứng đầy đủ điều kiện 1:1 (thiếu câu, thừa câu, sai mốc thời gian, text rỗng do lỗi API):
     - **TUYỆT ĐỐI KHÔNG commit** dữ liệu sai vào state dự án.
     - **TUYỆT ĐỐI KHÔNG tự ý đoán định** vị trí mapping.
     - Gắn cờ lỗi tường minh và thông báo cho người dùng chọn thử lại (Retry) hoặc chuyển sang Provider khác.
5. **Thao tác Chỉnh sửa Thủ công (Manual Edit)**: Người dùng chỉ được phép chỉnh sửa nội dung văn bản `text` của câu dịch, không thể sửa đổi `index` hoặc `timestamps`.

### 16.4 Định Dạng Âm Thanh Chuẩn Hóa Cố Định (Canonical Dub Audio Format)

Để bảo đảm tính tất định và tương thích tuyệt đối khi ghép nối âm thanh, hệ thống áp dụng một chuẩn định dạng âm thanh duy nhất:

- **Target Sample Rate**: Cố định chính xác **`44,100 Hz`** (44.1 kHz).
- **Channels**: **`Mono` (1 channel)**.
- **Bit Depth / Encoding**: **`16-bit Signed Linear PCM`** (AudioFormat = 1).
- **Container**: **`RIFF WAVE (.wav)`**.
- **Chính sách Xử lý Chênh lệch Kênh & Tần số mẫu (Resampling & Downmixing Policy)**:
  - Nếu âm thanh từ TTS Provider là Stereo (2 kênh): Tự động chuyển thành Mono bằng công thức trung bình cộng hai kênh:
    $$\text{monoSample}[i] = \frac{\text{channelData}[0][i] + \text{channelData}[1][i]}{2}$$
  - Nếu âm thanh từ TTS Provider có tần số lấy mẫu khác 44.1kHz (ví dụ 24kHz từ Edge-TTS hoặc 48kHz từ Local TTS): Hệ thống tự động thực hiện Resampling về chuẩn 44,100 Hz thông qua Web Audio API OfflineAudioContext trước khi đưa vào hàng đợi lắp ráp.
  - Toàn bộ các đoạn `DubAudioSegment` trước khi đưa vào hàm lắp ráp Master WAV bắt buộc phải ở đúng định dạng Canonical này.

### 16.5 Chính Sách Lưu Trữ Dữ Liệu & Vòng Đời Phiên Làm Việc (Session Storage & Lifecycle Policy)

Phân định rạch ròi giữa dữ liệu được lưu bền vững (Persistent) và dữ liệu theo phiên làm việc (Session-only):

1. **Dữ liệu Lưu trữ Bền vững qua Lần Khởi động lại Ứng dụng (Persisted Across Restarts in `localStorage`)**:
   - `voxlab_translation_settings`: `{ targetLanguage, translationProviderId, customModels }`.
   - `voxlab_dubbing_preferences`: `{ selectedVoiceId }` (giọng đọc dự án được chọn gần nhất).
   - `voxlab_active_workspace`: Workspace đang hoạt động (ví dụ `"dubbing"`).
   - `voxlab_subtitle_settings`: Toàn bộ cài đặt ASR & hiển thị phụ đề trong Right Panel của Tab Phụ đề.
2. **Dữ liệu Theo Phiên Làm việc (Session State & In-Memory Storage Boundary)**:
   - **QUY TẮC CẤM NHỊ PHÂN VÀO WEB STORAGE**:
     - Web Storage (`sessionStorage`) có hạn ngạch khắt khe (~5 MB) và không thể tuần tự hóa đối tượng nhị phân (`AudioBuffer`, `Blob`, `ArrayBuffer`, PCM payload).
     - **TUYỆT ĐỐI KHÔNG ĐƯỢC LƯU** `AudioBuffer`, `Blob`, file binary hoặc audio payload lớn vào `sessionStorage`.
   - **`sessionStorage` CHỈ CHỨA TRẠNG THÁI LIGHTWEIGHT JSON-SERIALIZABLE**:
     - `OriginalCue[]`
     - `TranslatedCue[]` (bao gồm các chỉnh sửa thủ công của người dùng `text`, `isEdited: true`)
     - Metadata nguồn: `sourceMediaName`, `sourceDurationSec`, `sourceLang`, `targetLang`
     - Cấu hình phiên: `selectedProviderId`, `selectedVoiceId`
     - Metadata va chạm: `overflowAnalysis: Record<number, TimingOverflowMetadata>`
     - Trạng thái tiến độ audio gọn nhẹ: `Record<number, { cueIndex: number, status: "idle" | "needs_generation", rawDurationSec?: number, fittedDurationSec?: number, speedFactor?: number }>` (không lưu Blob URL hay mảng sample nhị phân).
3. **Hành Vi Xác Định Khi Tải Lại WebView (Deterministic WebView Reload Behavior)**:
   - Trong VoxLab, các đoạn audio do TTS tổng hợp chỉ tồn tại tạm thời dưới dạng `Blob` trong RAM của tiến trình WebView2 (`URL.createObjectURL(blob)`).
   - Khi WebView bị reload (F5 hoặc refresh cửa sổ): Toàn bộ `Blob` trong RAM bị thu hồi và các URL `blob:...` trở nên không hợp lệ (stale/revoked).
   - **Hành vi xử lý tất định khi phục hồi từ `sessionStorage`**:
     1. Khôi phục 100% kịch bản dịch: Danh sách `OriginalCue[]`, `TranslatedCue[]` cùng mọi chỉnh sửa thủ công của người dùng được giữ nguyên vẹn.
     2. Khôi phục cấu hình giọng đọc, provider, ngôn ngữ đích.
     3. Toàn bộ các câu đã từng sinh audio được chuyển trạng thái tất định về **`status: "needs_generation"`** (cần tạo lại âm thanh).
     4. Hiển thị thông báo trên thanh trạng thái UI: *"Đã khôi phục kịch bản dịch từ phiên trước. Vui lòng bấm 'Tạo âm thanh' để tổng hợp lại file thoại."*
     5. Người dùng có thể bấm `[Tạo âm thanh tất cả]` hoặc bấm `[Tạo]` riêng từng câu khi sẵn sàng.
4. **Ranh giới Ngoài Phạm vi (OUT OF SCOPE for MVP)**:
   - Việc phục hồi toàn bộ dự án kèm các file audio blob nhị phân sau khi tắt hoàn toàn ứng dụng (Full Application Restart Project Restoration) **NẰM NGOÀI PHẠM VI MVP** (tuân thủ nguyên tắc Task/Session-based workflow của VoxLab). Khi khởi động lại ứng dụng, workspace mở ra ở trạng thái sạch sẽ với các cấu hình preference (giọng đọc, provider, ngôn ngữ) được giữ nguyên vẹn.

### 16.6 Chính Sách Phân Tích Cú Pháp Phụ Đề & Chuẩn Hóa Speaker WebVTT (.SRT / .VTT Parser)

1. **Chuẩn hóa Ký tự Xuống dòng**: Tự động chuyển đổi `\r\n` (CRLF) và `\r` (CR) về `\n` (LF) thống nhất.
2. **Bóc tách Timestamps Chính xác**:
   - SubRip (`.srt`): `00:01:23,456 --> 00:01:25,789`.
   - WebVTT (`.vtt`): `00:01:23.456 --> 00:01:25.789` hoặc `01:23.456 --> 01:25.789`.
   - Quy đổi sang số thực giây với độ chính xác 3 chữ số thập phân (`toFixed(3)`).
3. **Quy tắc Chuẩn Hóa Nhãn Người Nói WebVTT (WebVTT Speaker Normalization Semantics)**:
   - Cú pháp WebVTT hỗ trợ thẻ gán giọng thoại dạng `<v SpeakerName>Nội dung câu nói` hoặc `<v SpeakerName>Nội dung</v>`.
   - **Quy tắc Chuẩn hóa Bắt buộc**:
     - Hệ thống **CHUẨN HÓA THÀNH DẠNG TEXT**: `"SpeakerName: Nội dung câu nói"`.
     - **Mục đích**: Bảo toàn 100% ngữ nghĩa thông tin người nói (ai đang nói câu gì) ngay trong chuỗi văn bản kịch bản mà **KHÔNG CẦN THÊM TRƯỜNG `speaker` VÀO SCHEMA `OriginalCue`** (giữ schema tối giản, ổn định và bất biến).
     - **Ngữ nghĩa Lồng tiếng MVP**: Trong phạm vi MVP, dự án lồng tiếng sử dụng Single Project Voice (1 giọng đọc duy nhất cho toàn dự án). Nhãn người nói sau khi chuẩn hóa vào text sẽ được phát âm như một phần của kịch bản, trừ khi người dùng chủ động xóa hoặc chỉnh sửa trong cột Dịch (Translated text).
4. **Quy tắc Bảo toàn Ngữ Nghĩa & Lọc Bỏ Thẻ Trình Diễn (Markup Stripping)**:
   - **BẢO TOÀN 100% NỘI DUNG NGỮ NGHĨA (SEMANTIC TEXT)**:
     - Nhãn người nói dạng văn bản (ví dụ `Người dẫn chuyện:`, `[Alice]:`, `Speaker 1:`) được giữ nguyên vẹn.
     - Các dấu câu, dấu ngoặc, dấu gạch ngang phân đoạn thoại trong câu được giữ nguyên vẹn.
   - **CHỈ LỌC BỎ CÁC THẺ TRÌNH DIỄN (PRESENTATION MARKUP TAGS)**:
     - Thẻ HTML/XML: `<b>`, `</b>`, `<i>`, `</i>`, `<u>`, `</u>`, `<font ...>`, `</font>`, `<color ...>`, `</color>`, `<c.class>`, `</c>`, `<ruby>`, `<rt>`.
     - Thẻ mốc thời gian nội tuyến WebVTT: `<00:00:00.000>`.
5. **Xử lý Lỗi Tường minh (Actionable Error Handling)**:
   - Nếu file rỗng, không chứa mốc thời gian hợp lệ, hoặc sai cấu trúc $\rightarrow$ Hệ thống hiển thị hộp thoại lỗi thân thiện: *"Không thể đọc file phụ đề: Định dạng thời gian không hợp lệ hoặc file không có nội dung. Vui lòng kiểm tra lại file .SRT hoặc .VTT."*

### 16.7 Mô Hình Bộ Nhớ Làm Việc Dự Án Dài & Kiểm Soát Bộ Nhớ Thực Tế (Working Buffer Memory Model)

1. **Mô Hình Bộ Nhớ Làm Việc Thực Tế khi Xuất Master WAV (Realistic Working Buffer Model)**:
   - Định dạng Master WAV Canonical: 44,100 Hz, 16-bit Signed Linear PCM, Mono.
   - **Dung lượng file âm thanh đích (Output Int16 Buffer)**:
     $$\text{Dung lượng (1 giờ)} = 3600 \text{ s} \times 44100 \times 2 \approx 317.5 \text{ MB}$$
     $$\text{Dung lượng (2 giờ)} = 7200 \text{ s} \times 44100 \times 2 \approx 635.0 \text{ MB}$$
   - **Phân tích Đỉnh Chiếm Dụng RAM (Peak RAM Usage Breakdown)**:
     Trong quá trình lắp ráp (assembly) và xuất Master WAV, bộ nhớ làm việc của tiến trình WebView2 (Chromium) không chỉ chứa file đích, mà bao gồm đồng thời 4 thành phần:
     1. **Mảng Float32 AudioBuffer nguồn**: Các đoạn thoại đã sinh và co giãn WSOLA được lưu trong bộ nhớ dưới dạng `AudioBuffer` (chuẩn Web Audio sử dụng Float32, tức 4 bytes/mẫu). Đối với dự án 120 phút, nếu tổng thời lượng phát âm thực tế chiếm khoảng 50% - 80% timeline, mảng Float32 này chiếm khoảng:
        $$\text{Float32 Segments} \approx (7200 \times 0.7) \times 44100 \times 4 \approx 889 \text{ MB RAM}$$
     2. **Mảng Master Buffer Đích (Int16Array)**: Buffer liên tục chứa toàn bộ timeline 120 phút ở 44.1kHz 16-bit:
        $$\text{Master Int16} = 7200 \times 44100 \times 2 \approx 635 \text{ MB RAM}$$
     3. **Buffer Tạm Cho Quá Trình Xử Lý Âm Thanh (Temporary Processing Buffers)**: Buffer tạm thời phục vụ thuật toán WSOLA, downmix Stereo $\rightarrow$ Mono, và OfflineAudioContext resampling: chiếm thêm khoảng **100 MB – 250 MB RAM**.
     4. **Đối tượng Blob & Object URL khi Đóng Gói File**: Khi gọi `new Blob([int16MasterBuffer.buffer], { type: "audio/wav" })`, trình duyệt Chromium có thể giữ một bản sao bộ nhớ của payload cho tới khi hoàn tất tải file về đĩa và thu hồi URL: chiếm thêm khoảng **635 MB RAM**.
   - **Tổng Đỉnh RAM Tiêu Thụ Thực Tế (Estimated Peak RAM)**:
     $$\text{Peak RAM (120 phút)} \approx 889 \text{ MB} + 635 \text{ MB} + 200 \text{ MB} + 635 \text{ MB} \approx \mathbf{2.36 \text{ GB RAM}}$$
     Trong môi trường Windows 64-bit với WebView2, mức tiêu thụ 2.0GB - 2.5GB RAM là cận trên chấp nhận được nhưng tiềm ẩn nguy cơ cao nếu máy tính của người dùng bị giới hạn RAM hoặc chạy đa nhiệm nặng.
2. **Trần Hỗ Trợ Dự Kiến Cho MVP (Provisional Cap for MVP)**:
   - Ngưỡng hỗ trợ danh định tối đa cho một phiên xuất Master WAV là **`120 phút` (2 giờ)**.
3. **Cơ Chế Kiểm Tra Dung Lượng Trước Khi Cấp Phát (Pre-flight Memory Check Policy)**:
   - Trước khi bắt đầu tiến trình cấp phát bộ nhớ lắp ráp Master WAV, hàm kiểm tra an toàn `preflightMemoryCheck(totalDurationSec)` được kích hoạt:
     - **Mức Cảnh Báo ($> 60$ phút và $\le 120$ phút)**:
       Hiển thị thông báo lưu ý người dùng: *"Dự án dài (> 60 phút) sẽ tiêu tốn khoảng 1.0GB - 2.0GB RAM trong lúc ghép nối âm thanh. Hãy đảm bảo máy tính còn đủ bộ nhớ trống."*
     - **Mức Từ Chối Tuyệt Đối ($> 120$ phút hoặc Dung Lượng Master $> 635$ MB)**:
       Hệ thống lập tức **TỪ CHỐI TIẾN TRÌNH XUẤT** và hiển thị hộp thoại cảnh báo an toàn:
       *"Dự án vượt quá giới hạn thời lượng 120 phút cho một lần xuất âm thanh. Vui lòng chia nhỏ dự án để đảm bảo an toàn bộ nhớ và hiệu năng hệ thống."*
       Tuyệt đối không để ứng dụng bị crash im lặng (silent crash) hay sập WebView do tràn bộ nhớ (OOM).
4. **Yêu Cầu Đo Đạc Thực Nghiệm (Empirical Benchmark Requirement)**:
   - Trong giai đoạn triển khai và kiểm thử, nhóm kỹ thuật **BẮT BUỘC** thực hiện benchmark đo đạc mức tiêu thụ RAM thực tế và thời gian xử lý trên môi trường Windows WebView2 ở 3 mốc thời lượng:
     1. Mốc ngắn: **`30 phút`** (Kỳ vọng: Peak RAM < 700 MB, hoạt động cực kỳ mượt mà).
     2. Mốc trung bình: **`60 phút`** (Kỳ vọng: Peak RAM < 1.3 GB, ổn định trên mọi máy cấu hình tiêu chuẩn).
     3. Mốc trần: **`120 phút`** (Đo đạc chính xác đỉnh RAM, GC latency và tính ổn định trước khi xác nhận ngưỡng 120 phút là an toàn tuyệt đối).

### 16.8 Lắp Ráp Master Audio WAV & Điều Kiện Xuất Hợp Lệ (Master Assembly Gate)

1. **Quy trình Kiểm tra Điều kiện Xuất (Export Pre-flight Check)**:
   - Bước 1: Kiểm tra 100% các câu dịch phải có trạng thái audio là `Ready`. Nếu có câu `Failed`, `Pending`, `Generating`, `Modified` hoặc `needs_generation` $\rightarrow$ Chặn xuất và chỉ rõ danh sách câu chưa hoàn tất.
   - Bước 2: Kiểm tra va chạm âm thanh (`collision_danger`):
     - Nếu phát hiện **BẤT KỲ CÂU NÀO** có `hasCollision === true` $\rightarrow$ **CHẶN XUẤT MASTER WAV**, hiển thị thông báo:
       *"Không thể xuất âm thanh tổng: Phát hiện va chạm âm thanh tại câu #{index}. Vui lòng rút gọn câu dịch hoặc tạo lại âm thanh trước khi xuất."*
   - Bước 3: Kiểm tra giới hạn bộ nhớ qua `preflightMemoryCheck`: Dự án phải $\le 120$ phút.
2. **Quy trình Lắp ráp**:
   - Khi vượt qua toàn bộ 3 bước kiểm tra trên, hệ thống khởi tạo buffer 44.1kHz 16-bit PCM Mono.
   - Lần lượt ghi từng đoạn `fittedAudio` vào đúng vị trí mẫu `sampleOffset = Math.round(cue.startSec * 44100)`.
   - Các khoảng cách giữa các câu tự động là khoảng lặng âm thanh hoàn hảo (giá trị 0).
   - Đóng gói container RIFF WAVE và xuất file `.wav` hoàn chỉnh.

### 16.9 Cấu trúc Cài đặt Tập trung & Migration Dữ liệu Bền vững

1. **Tách biệt Storage Keys**:
   - `voxlab_subtitle_settings`: Chỉ chứa cài đặt ASR và hiển thị phụ đề (`audioLanguage`, `whisperModel`, `speechSpeed`, `processingSpeed`, `aspectRatio`, `maxLines`).
   - `voxlab_translation_settings`: Chứa cài đặt dịch thuật (`targetLanguage`, `translationProviderId`, `customModels`, `autoTranslate`).
2. **Quy trình Tự động Migration khi Khởi động**:
   - Hàm `migrateSubtitleAndTranslationSettings()` kiểm tra `voxlab_subtitle_settings`:
     - Tự động di chuyển `customModels`, `translationProviderId`, `targetLanguage` sang `voxlab_translation_settings`.
     - Dọn sạch các trường dịch thuật ra khỏi `voxlab_subtitle_settings`.
     - Đảm bảo toàn bộ custom model và provider user đã cấu hình trước đây không bị mất.
3. **Loại bỏ Trang Trùng lặp**:
   - Xóa bỏ mục `"transcription"` trong danh sách `SettingsGroup` của [SettingsWorkspace.tsx](file:///f:/Source%20Code%20Tool/Voxlab/src/views/SettingsWorkspace.tsx).
   - Nếu user đang lưu `activeGroup === "transcription"`, tự động fallback sang `"translation"`.
   - Loại bỏ mục cấu hình Tỷ lệ khung hình thừa tại `Settings > General`.

### 16.10 Xử lý Lỗi, Hủy bỏ & Phục hồi Phiên làm việc

1. **Cô lập Lỗi (Failure Isolation)**:
   - Khi dịch một cue thất bại: Gắn cờ lỗi `status: "failed"`, hiển thị thông báo lỗi riêng, không làm dừng toàn bộ mảng cue khác.
   - Khi sinh audio một cue bị lỗi: Hàng đợi cho phép người dùng chọn **`[Thử lại]`** riêng câu đó hoặc bỏ qua.
2. **Kiểm soát Hàng đợi**: Hỗ trợ đầy đủ Pause, Resume, Cancel trong suốt quá trình sinh âm thanh lồng tiếng.

### 16.11 Quy Tắc Làm Chậm ASR & Ánh Xạ Ngược Mốc Thời Gian (ASR Slow-Down & Strict Reverse Timestamp Mapping)

1. **Phạm vi Áp dụng Duy nhất của "Tốc độ giọng nói"**:
   - Setting *"Tốc độ giọng nói"* (`speechSpeed`: `1.0x` Bình thường, `0.9x` Giọng nhanh, `0.8x` Giọng rất nhanh) trong Right Panel Phụ đề **CHỈ ĐƯỢC ÁP DỤNG CHO PIPELINE ASR** nhằm hỗ trợ Whisper nhận diện tốt hơn các đoạn audio có tốc độ nói quá nhanh.
   - Không được áp dụng setting này vào pipeline Dubbing hoặc TTS.
2. **Quy trình Xử lý & Ánh xạ Ngược Bắt buộc (Strict Reverse Remapping Pipeline)**:
   - **Bước 1**: Khi `speechSpeed < 1.0` (ví dụ `0.9x` hoặc `0.8x`), audio đầu vào được time-stretch/resample chậm lại trước khi nạp vào faster-whisper.
   - **Bước 2**: faster-whisper tạo ra các phân đoạn (`segments`) và mốc thời gian từ (`words`) trên timeline âm thanh đã bị kéo chậm.
   - **Bước 3 (BẮT BUỘC)**: Toàn bộ mốc thời gian (`startSec`, `endSec`, `word.startSec`, `word.endSec`) **BẮT BUỘC PHẢI ĐƯỢC QUY ĐỔI NGƯỢC VỀ TIMELINE CỦA MEDIA GỐC** trước khi chuyển sang bước tiếp theo:
     $$\text{original\_time} = \text{processed\_time} \times \text{speed\_factor}$$
     - Sử dụng hàm tất định [`remapWhisperOutputToOriginalTimeline(segments, speedFactor)`](file:///f:/Source%20Code%20Tool/Voxlab/src/services/subtitle/timing.ts#L22).
   - **Bước 4**: Subtitle Optimizer (chia dòng, gộp ngắt, tỷ lệ khung hình) **BẮT BUỘC** chỉ nhận dữ liệu `word timestamps` và `speech units` đã nằm trên timeline gốc.
3. **Các Điều Kiện Ràng Buộc Bất Biến (Hard Invariants)**:
   - **Đồng nhất với Media Gốc**: Mọi mốc thời gian `startSec` và `endSec` hiển thị trên UI, xuất ra file `.srt`, `.vtt` hoặc handoff sang Dịch & Lồng tiếng **PHẢI LUÔN KHỚP 100% VỚI VIDEO/AUDIO GỐC**.
   - **Tuyệt đối không để rò rỉ (No Leaked Timestamps)**: Tuyệt đối không để bất kỳ timestamp nào của audio đã slow-down lọt vào kết quả cuối cùng của subtitle.
   - **Identity Mapping tại 1.0x**: Khi `speechSpeed === 1.0`, hàm ánh xạ trả về nguyên vẹn mốc thời gian mà không làm tròn hay suy hao (`Math.abs(speedFactor - 1.0) < 0.0001 -> return processedSec`).
4. **Bảng Đối Chiếu Số Học Kiểm Thử (Verification Test Vectors)**:
   - *Trường hợp 1.0x (Identity)*: Audio gốc $10.000\text{s} \rightarrow 15.000\text{s}$; ASR $10.000\text{s} \rightarrow 15.000\text{s}$; Output: $10.000\text{s} \rightarrow 15.000\text{s}$.
   - *Trường hợp 0.9x (Giọng nhanh)*: Audio gốc $10.000\text{s} \rightarrow 15.000\text{s}$; Audio chạy Whisper $11.111\text{s} \rightarrow 16.667\text{s}$; Ánh xạ ngược: $11.111 \times 0.9 = 10.000\text{s}$, $16.667 \times 0.9 = 15.000\text{s}$. Output: $10.000\text{s} \rightarrow 15.000\text{s}$.
   - *Trường hợp 0.8x (Giọng rất nhanh)*: Audio gốc $10.000\text{s} \rightarrow 15.000\text{s}$; Audio chạy Whisper $12.500\text{s} \rightarrow 18.750\text{s}$; Ánh xạ ngược: $12.500 \times 0.8 = 10.000\text{s}$, $18.750 \times 0.8 = 15.000\text{s}$. Output: $10.000\text{s} \rightarrow 15.000\text{s}$. **Cấm tuyệt đối xuất $12.500\text{s} \rightarrow 18.750\text{s}$**.

### 16.12 Kiến Trúc Tùy Biến Tham Số Hiệu Năng (Configurable Performance & Tuning Architecture)

Nhằm tuân thủ nguyên tắc không tối ưu hóa sớm (Avoid Premature Optimization), hệ thống thiết kế kiến trúc cấu hình mở cho các tham số thực thi:

1. **Không Hard-code Cố định**: Không gán chết các thông số nhạy cảm về phần cứng trong mã nguồn nghiệp vụ.
2. **Cấu hình Động & Khả Năng Benchmark (Tunable Execution Parameters)**:
   - `ttsBatchSize`: Số câu xử lý trong một đợt (Default: 10, cấu hình được từ 1 đến 50).
   - `ttsConcurrency`: Số luồng request song song (Default: 1 để an toàn, mở rộng được theo provider).
   - `workerCount`: Số tiến trình worker backend (tự động phát hiện theo số luồng CPU/GPU).
   - `queueParallelism`: Số tác vụ hàng đợi chạy song song (Default: 1).
   - `chunkSize`: Độ dài khối văn bản phân đoạn (Default: 200 ký tự, cấu hình được).
   - `modelUnloadTimeoutSec`: Thời gian chờ trước khi giải phóng model khỏi VRAM/RAM (Default: 300s).
3. **Mục đích**: Toàn bộ các thông số này có thể dễ dàng đo đạc, benchmark trong giai đoạn kiểm thử hiệu năng và điều chỉnh linh hoạt theo từng cấu hình máy tính mà không phải can thiệp sâu vào code logic.

---

## 17. Acceptance Criteria (Bổ sung cho Đợt Tái cấu trúc v2.5.3)

### AC-16: Main Sidebar & Workspace Navigation
- [ ] Main Sidebar hiển thị đầy đủ 7 mục theo đúng thứ tự: *Text to Speech, Voice Clone, Voice Library, Phụ đề, Dịch & Lồng tiếng, Lịch sử, Cài đặt*.
- [ ] Bấm chọn `Dịch & Lồng tiếng` $\rightarrow$ Ứng dụng chuyển sang workspace `dubbing` mượt mà, lưu trạng thái vào `voxlab_active_workspace`.
- [ ] Tắt và mở lại ứng dụng $\rightarrow$ Workspace đang mở được khôi phục chính xác.

### AC-17: Tab Phụ đề — Single Responsibility & Cài đặt Phụ đề
- [ ] Tab Phụ đề không còn bất kỳ ô nhập, dropdown hay nút bấm nào liên quan đến dịch thuật.
- [ ] Right Panel được đổi tên thành **"CÀI ĐẶT PHỤ ĐỀ"**, chứa đủ 2 nhóm: *Nhận diện* (đổi setting $\rightarrow$ invalidate ASR) và *Hiển thị* (đổi Tỷ lệ khung hình/Số dòng $\rightarrow$ re-run optimizer từ word timestamps, không chạy lại Whisper).
- [ ] Tại màn hình Kết quả, nút cũ "Chuyển sang TTS" được thay bằng **`[Chuyển sang Dịch & Lồng tiếng ➔]`**.

### AC-18: Handoff Bất biến từ Phụ đề sang Dịch & Lồng tiếng
- [ ] Bóc băng xong ở tab Phụ đề $\rightarrow$ Bấm `[Chuyển sang Dịch & Lồng tiếng ➔]` $\rightarrow$ Ứng dụng tự động chuyển sang tab Dịch & Lồng tiếng với toàn bộ danh sách cues gốc và timestamps được nạp đầy đủ.
- [ ] Tại tab Dịch & Lồng tiếng, chỉnh sửa nội dung câu dịch hoặc sinh audio $\rightarrow$ Quay lại tab Phụ đề: Toàn bộ danh sách cue gốc của tab Phụ đề vẫn giữ nguyên 100%, không bị mutate.

### AC-19: Nhập File Phụ đề Cục bộ (.SRT / .VTT)
- [ ] Tại tab Dịch & Lồng tiếng, bấm `[Nhập file phụ đề]` và chọn file `.srt` chuẩn $\rightarrow$ Parser đọc chính xác số thứ tự, mốc thời gian và text, nạp thành công vào bảng Cues.
- [ ] Chọn file `.vtt` chuẩn $\rightarrow$ Parser xử lý đúng dấu chấm mili-giây, bỏ qua header `WEBVTT` và nạp cues chính xác.

### AC-20: Cấu hình Provider Tập trung & Deep-link Actionable
- [ ] Tab Dịch & Lồng tiếng tuyệt đối không hiển thị ô nhập API Key hay server endpoint.
- [ ] Chọn Provider là Gemini nhưng chưa có API Key trong Settings $\rightarrow$ Hiển thị badge cảnh báo kèm nút `[Cấu hình trong Settings]`.
- [ ] Bấm nút `[Cấu hình trong Settings]` $\rightarrow$ Ứng dụng chuyển ngay sang `Settings > Translation`. Sau khi nhập key và quay lại tab Dịch, Provider tự động cập nhật sang trạng thái sẵn sàng.

### AC-21: Bố cục Review / Edit 2 Cột Song song
- [ ] Giao diện Review hiển thị rõ ràng 2 cột: Cột trái là Cue gốc (Read-only); Cột phải là Cue dịch (Inline editable).
- [ ] Người dùng sửa text câu dịch $\rightarrow$ Text mới được lưu, cue được đánh dấu `isEdited: true`. Nếu câu đó đã có audio từ trước, audio chuyển sang trạng thái cần tạo lại (`Modified`).

### AC-22: Timing Fit — WSOLA Speedup Semantics, Overflow vs Collision Danger & Export Blocking
- [ ] **Quy tắc Co giãn Tốc độ WSOLA**: Khi thời lượng âm thanh thô `rawDuration` vượt quá thời lượng khả dụng của cue `availableDuration`:
  - Hệ thống tính toán hệ số tăng tốc: `speedFactor = Math.min(rawDuration / availableDuration, 1.20)`.
  - Áp dụng `timeStretchAudioBuffer` tăng tốc tối đa $1.20\times$ (giảm thời lượng xuống tối đa $\frac{\text{rawDuration}}{1.20}$).
- [ ] **Trường hợp Overflow không Va chạm (`overflow_only`)**: Sau khi co giãn WSOLA (hoặc không cần co giãn), câu dịch phát âm dài hơn thời lượng cue gốc nhưng kết thúc trước hoặc đúng thời điểm bắt đầu của câu kế tiếp (`audioEndSec <= nextCue.startSec`) $\rightarrow$ Hiển thị nhãn cảnh báo vàng trên UI; nút **`[Xuất Audio Lồng tiếng (.WAV)]` VẪN KHẢ DỤNG** và cho phép xuất bình thường.
- [ ] **Trường hợp Va chạm Âm thanh (`collision_danger`)**: Câu dịch phát âm dài hơn thời điểm bắt đầu của câu kế tiếp (`audioEndSec > nextCue.startSec`) $\rightarrow$ Hiển thị nhãn cảnh báo đỏ; nút **`[Xuất Audio Lồng tiếng (.WAV)]` BỊ KHÓA HOÀN TOÀN**; khi bấm vào hiển thị hướng dẫn người dùng rút ngắn câu dịch hoặc tạo lại audio.
- [ ] Tuyệt đối không tự ý mix chồng 2 giọng nói, không tự ý cắt ngắn audio, và không tự ý dời (ripple-shift) timestamp của các cue tiếp theo.
- [ ] Dù có `collision_danger`, nút **`[Xuất Phụ đề Đã dịch (.SRT)]` VẪN HOẠT ĐỘNG BÌNH THƯỜNG** và xuất file SRT sử dụng mốc thời gian gốc.

### AC-23: Lắp ráp Master Audio WAV & Xuất SRT Chuẩn Timestamps Gốc
- [ ] Khi không còn câu nào bị va chạm (`collision_danger`), bấm `[Xuất Audio Lồng tiếng (.WAV)]` $\rightarrow$ Hệ thống lắp ráp các đoạn audio đã fit vào đúng vị trí `startSec` trên timeline, chèn khoảng lặng tự nhiên giữa các câu, tạo file WAV hoàn chỉnh nghe khớp với video gốc.
- [ ] Bấm `[Xuất Phụ đề Đã dịch (.SRT)]` $\rightarrow$ File SRT được tạo ra chứa nội dung câu dịch với **chính xác các mốc thời gian `startSec` và `endSec` của subtitle gốc**.

### AC-24: Loại bỏ Trùng lặp Settings & Migration An toàn
- [ ] Mục `Settings > Phụ đề` biến mất hoàn toàn khỏi danh sách cài đặt; không còn hiện tượng trùng lặp cấu hình.
- [ ] Cấu hình phụ đề user đã lưu từ các phiên bản trước được bảo toàn trọn vẹn tại Right Panel của Tab Phụ đề.
- [ ] Các model dịch custom và API keys đã lưu trước đây không bị mất mát trong quá trình chuyển đổi.

### AC-25: Kiểm soát Hàng đợi TTS (Pause, Resume, Cancel)
- [ ] Đang trong tiến trình lồng tiếng $\rightarrow$ Bấm `[Tạm dừng]` $\rightarrow$ Hàng đợi dừng an toàn.
- [ ] Bấm `[Tiếp tục]` $\rightarrow$ Hàng đợi chạy tiếp từ câu tiếp theo.
- [ ] Bấm `[Hủy bỏ]` $\rightarrow$ Hàng đợi dừng hoàn toàn, các câu đã sinh xong trước đó vẫn giữ nguyên trạng thái `Ready` và nghe thử được bình thường.

### AC-26: Translation Cue Invariant 1:1 & Response Validation
- [ ] Mọi job dịch thuật bắt buộc phải bảo toàn 100%: số lượng câu, chỉ số index, thứ tự câu, và mốc thời gian `startSec`/`endSec`.
- [ ] Giả lập Provider trả về thiếu câu, thừa câu, đảo lộn thứ tự hoặc text rỗng $\rightarrow$ Hàm `validateTranslationResponse1to1` lập tức phát hiện và từ chối commit vào state dự án, hiển thị thông báo lỗi tường minh, không làm hỏng dữ liệu phụ đề gốc.

### AC-27: Canonical Dub Audio Format Enforcement
- [ ] Toàn bộ các đoạn `DubAudioSegment` và file Master WAV xuất ra đều tuân thủ chính xác định dạng Canonical: 44,100 Hz, 16-bit Linear PCM, 1 kênh Mono.
- [ ] Nếu âm thanh đầu vào là Stereo $\rightarrow$ Tự động chuyển đổi thành Mono bằng trung bình cộng 2 kênh.
- [ ] Nếu âm thanh đầu vào có sample rate khác 44.1kHz (ví dụ 24kHz hoặc 48kHz) $\rightarrow$ Tự động resample về 44.1kHz trước khi ghép master.

### AC-28: Lightweight Session Persistence & Deterministic Reload Behavior
- [ ] Người dùng chọn giọng đọc dự án, provider và ngôn ngữ đích $\rightarrow$ Thoát ứng dụng và mở lại: Các tùy chọn preference này được khôi phục chính xác 100% từ `localStorage`.
- [ ] `sessionStorage` **tuyệt đối không chứa `AudioBuffer`, `Blob`, hay dữ liệu nhị phân**; chỉ chứa dữ liệu JSON gọn nhẹ (`OriginalCue[]`, `TranslatedCue[]` kèm chỉnh sửa `isEdited: true`, metadata va chạm và trạng thái tiến độ).
- [ ] Người dùng reload webview (F5) $\rightarrow$ Toàn bộ kịch bản và câu dịch được phục hồi 100%; các câu đã sinh audio được chuyển trạng thái tất định về **`needs_generation`**; hiển thị thông báo nhắc người dùng bấm nút tạo lại âm thanh khi sẵn sàng.
- [ ] Thoát hẳn ứng dụng (Restart app) $\rightarrow$ Workspace Dịch & Lồng tiếng mở ra ở trạng thái sẵn sàng sạch sẽ, không gây lỗi treo hay cố gắng load lại các audio blob đã hết hạn.

### AC-29: SRT/VTT WebVTT Speaker Normalization & Markup Stripping
- [ ] Cú pháp WebVTT có thẻ người nói `<v SpeakerName>Nội dung câu nói` $\rightarrow$ Tự động chuẩn hóa thành chuỗi text `"SpeakerName: Nội dung câu nói"` trong `OriginalCue.text`, bảo toàn thông tin người nói mà không thêm trường schema thừa; phát âm bằng Single Project Voice của MVP.
- [ ] Nhập file `.srt` hoặc `.vtt` có nhãn người nói dạng text thông thường (ví dụ `Speaker 1: Xin chào`, `[Alice]: Hello`) $\rightarrow$ Nội dung nhãn người nói được giữ nguyên vẹn 100% trong `OriginalCue.text`.
- [ ] Nhập file có thẻ định dạng HTML/VTT (ví dụ `<b>đậm</b>`, `<font color="red">chữ đỏ</font>`) $\rightarrow$ Hệ thống lọc sạch các thẻ trình diễn, giữ lại nội dung văn bản thuần túy.
- [ ] Nhập file rỗng hoặc sai cú pháp thời gian $\rightarrow$ Hệ thống báo lỗi thân thiện, không làm sập ứng dụng.

### AC-30: Long Project Memory Pre-flight Guardrail & Empirical Benchmarks
- [ ] Dự án dài $> 60$ phút và $\le 120$ phút: Hiển thị thông báo lưu ý người dùng về mức chiếm dụng RAM dự kiến (1.0GB - 2.0GB).
- [ ] Dự án có tổng thời lượng $\le 120$ phút $\rightarrow$ Quá trình xuất Master WAV diễn ra bình thường, tạo file WAV hợp lệ.
- [ ] Dự án có tổng thời lượng vượt quá 120 phút (hoặc master buffer $> 635$ MB) $\rightarrow$ Hàm `preflightMemoryCheck` lập tức từ chối cấp phát bộ nhớ, hiển thị thông báo lỗi an toàn yêu cầu chia nhỏ dự án, ngăn chặn hoàn toàn nguy cơ sập WebView do Out-Of-Memory.
- [ ] **Empirical Benchmark Requirement**: Nhóm phát triển phải thực hiện đo đạc thực nghiệm mức chiếm dụng RAM và hiệu năng thực tế tại các mốc 30 phút, 60 phút, và 120 phút trên môi trường Windows WebView2 trong giai đoạn Verification.

### AC-31: ASR Speed Slow-Down & Strict Reverse Timestamp Mapping (1.0x / 0.9x / 0.8x)
- [ ] Cài đặt "Tốc độ giọng nói" trong Cài đặt Phụ đề chỉ áp dụng cho pipeline ASR (làm chậm audio để Whisper nhận diện tốt hơn), không ảnh hưởng đến pipeline Dubbing.
- [ ] Khi chọn `1.0x` (Bình thường) $\rightarrow$ Hàm `remapWhisperOutputToOriginalTimeline` thực hiện Identity Mapping, giữ nguyên 100% timestamps thô từ Whisper.
- [ ] Khi chọn `0.9x` hoặc `0.8x` $\rightarrow$ Audio được time-stretch/resample chậm trước khi chạy Whisper. Timestamps trả về từ Whisper được quy đổi ngược về timeline gốc theo công thức $\text{original\_time} = \text{processed\_time} \times \text{speedFactor}$.
- [ ] Kiểm thử trường hợp cụ thể: Audio 0.8x có segment từ $12.500\text{s} \rightarrow 18.750\text{s}$ được quy đổi chính xác thành $10.000\text{s} \rightarrow 15.000\text{s}$. Tuyệt đối không để timestamp của audio slow-down rò rỉ vào kết quả subtitle.
- [ ] Cues hiển thị, Subtitle Optimizer và file SRT/VTT xuất ra luôn luôn đồng bộ chính xác với video/audio gốc.

### AC-32: Configurable Performance Tuning Architecture
- [ ] Các thông số thực thi như `batchSize`, `concurrency`, `workerCount`, `queueParallelism`, `chunkSize`, và `modelUnloadTimeoutSec` được đóng gói trong cấu hình có thể tùy biến, không bị hard-code cố định trong code nghiệp vụ.
- [ ] Hệ thống cho phép đo đạc, benchmark độc lập và điều chỉnh linh hoạt theo từng cấu hình phần cứng.

---

## 18. Bảng Đánh Giá Rủi Ro Kỹ Thuật (Technical Risks & Evidence-Based Mitigations)

| # | Rủi ro Kỹ thuật | Mức độ | Bằng chứng Hiện trạng & Biện pháp Giảm thiểu (Mitigation Strategy) |
|---|---|---|---|
| 1 | **Va chạm Âm thanh (Audio Collision) khi Ghép Master WAV** | Cao | Đã chốt chính sách cứng tại Mục 16.2: `collision_danger` lập tức khóa nút xuất Master WAV cho tới khi người dùng rút ngắn câu dịch. Không bao giờ mix chồng 2 giọng nói hoặc tự ý dời timeline. |
| 2 | **Provider trả về Kết quả Dịch Sai Lệch / Mất Cue** | Cao | Thêm tầng kiểm duyệt bắt buộc `validateTranslationResponse1to1` tại Mục 16.3: Nếu số lượng câu, chỉ số index hoặc thứ tự không khớp 1:1, hệ thống từ chối commit dữ liệu sai vào state. |
| 3 | **Lệch Định dạng Âm thanh (Tần số mẫu / Số kênh)** | Trung bình | Đã chuẩn hóa tại Mục 16.4: Bắt buộc định dạng Canonical 44.1kHz 16-bit Mono. Tự động downmix stereo thành mono và resample về 44.1kHz trước khi ghép master. |
| 4 | **Tràn Bộ nhớ (OOM) khi Xuất Master WAV Dự án Dài** | Trung bình | Đã mô hình hóa toàn diện tại Mục 16.7 (Peak RAM gồm Float32 segments + Int16 master + temp WSOLA + Blob $\approx 2.36$ GB cho 120 phút): Hàm `preflightMemoryCheck` cảnh báo ở mốc > 60 phút và từ chối an toàn ở mốc > 120 phút; bắt buộc chạy empirical benchmark ở 30/60/120 phút. |
| 5 | **Tràn Quota SessionStorage (5MB) / Lỗi Stale Audio Blob khi Reload** | Trung bình | Đã giải quyết triệt để tại Mục 16.5: Cấm hoàn toàn lưu AudioBuffer/Blob vào `sessionStorage`; chỉ lưu lightweight JSON; khi reload webview, audio state chuyển tất định sang `needs_generation` để user tạo lại. |
| 6 | **Mất Nhãn Người Nói khi Import WebVTT** | Thấp | Đã chuẩn hóa tại Mục 16.6: Chuyển đổi `<v Speaker>Text` thành `"Speaker: Text"`, bảo toàn ngữ nghĩa thoại mà không phá vỡ schema `OriginalCue`. |
| 7 | **Mất mát cấu hình Custom Models & API Keys khi Migrate** | Cao | Xây dựng hàm `migrateSubtitleAndTranslationSettings()` chạy tại bootstrap app, sao chép an toàn dữ liệu sang `voxlab_translation_settings` trước khi dọn sạch key cũ. |
| 8 | **Lệch Timestamps khi ASR Chạy Chế Độ Giọng Nhanh (0.8x / 0.9x)** | Cao | Đã quy định bắt buộc tại Mục 16.11: Áp dụng hàm toán học quy đổi ngược tất định `original_time = processed_time * speed_factor` trước khi nạp vào Subtitle Optimizer; cam kết 100% khớp timeline media gốc. |

---

### KẾT LUẬN & PHÊ DUYỆT GATE B

Tài liệu `SPEC.md` v2.5.3 đã hoàn thiện trọn vẹn toàn bộ các yêu cầu kỹ thuật và đã được **CHÍNH THỨC PHÊ DUYỆT TẠI GATE B**.
Hệ thống chính thức chuyển tiếp sang **Phase 4: `/plan`** (Lập kế hoạch triển khai chi tiết và task breakdown).
