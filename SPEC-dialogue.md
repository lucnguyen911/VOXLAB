# Specification: Hội Thoại Đa Nhân Vật (Multi-Speaker Dialogue Workspace)

**Version**: 1.0.0  
**Status**: DRAFT FOR USER REVIEW (Gate B)  
**Author**: Antigravity & User  
**Target Platform**: VoxLab Desktop (Tauri v2 + React 19 + TypeScript + Vite)  

---

## 1. Objective & Vision

Cung cấp cho người dùng VoxLab một không gian làm việc chuyên biệt mang tên **"Hội Thoại" (`dialogue`)**, cho phép tạo ra các đoạn hội thoại đa nhân vật tự nhiên từ kịch bản văn bản dạng `[Tên]: Lời thoại`:
1. **Tự động nhận diện thời gian thực (Real-time Character Detection)**: Khi người dùng gõ hoặc dán kịch bản, hệ thống tự động bóc tách danh sách nhân vật, đếm số phân đoạn của từng người mà không bắt người dùng phải cấu hình thủ công.
2. **Tô màu phân vai trực quan (Color-Coded Speaker Highlighting)**: Tự động tô màu badge/thẻ tên nhân vật trong khung soạn thảo kịch bản (`[Nam]:` màu tím, `[Vy]:` màu xanh dương, `[Lan]:` màu xanh lá,...), hỗ trợ gõ tiếng Việt Telex/VNI an toàn 100% không nhảy con trỏ.
3. **Quản lý & Gán giọng đọc riêng cho từng nhân vật (Per-Character Voice Assignment)**: Mỗi nhân vật có thẻ cấu hình riêng (chọn giọng đọc từ Thư viện VoxLab, chỉnh tốc độ riêng, cao độ riêng, nghe thử mic).
4. **Thiết lập âm thanh tự nhiên (Natural Turn-Taking Synthesis)**: Hỗ trợ chỉnh khoảng nghỉ giữa các phân đoạn đối đáp (mặc định 0.3s - 0.8s), xuất file âm thanh tổng (Master Audio WAV/MP3) và xuất phụ đề SRT có kèm tên nhân vật `[Tên]: Lời thoại`.

---

## 2. Tech Stack & Commands

- **Language & Framework**: TypeScript 5.8+, React 19, Tailwind CSS v4, Lucide Icons.
- **Audio Engine**: Web Audio API, Linear PCM WAV encoder / AudioBuffer merger.
- **Commands**:
  - Dev Server: `npm run dev` (Port 1420)
  - Typecheck: `npx tsc --noEmit`
  - Automated Tests: `npx tsx --test "src/**/*.test.ts"`
  - Production Build: `npm run build`

---

## 3. Project Structure

Các tệp dự kiến tạo mới và tích hợp (không sửa code trước khi được duyệt):

```text
src/
├── types/
│   └── dialogue.ts                  # [MỚI] Schema dữ liệu: DialogueCharacter, DialogueSegment, DialogueConfig
├── services/
│   └── dialogue/                    # [MỚI] Dịch vụ xử lý hội thoại
│       ├── parser.ts                # Regex bóc tách kịch bản, đếm phân đoạn, lọc tên nhân vật
│       ├── sampleScripts.ts         # Kịch bản mẫu phong phú (tiếng Việt tự nhiên)
│       ├── masterAssembly.ts        # Ghép các phân đoạn audio kèm khoảng nghỉ đối đáp
│       ├── srtExporter.ts           # Xuất file SRT có nhãn người nói [Tên]: ...
│       └── __tests__/
│           ├── parser.test.ts       # Unit tests kiểm thử bóc tách cú pháp kịch bản
│           └── assembly.test.ts     # Tests kiểm thử khoảng nghỉ và ghép master
├── components/
│   └── dialogue/                    # [MỚI] Component giao diện Hội Thoại
│       ├── DialogueEditor.tsx       # Trình soạn thảo kịch bản tô màu cú pháp (IME-safe)
│       ├── DialogueInspector.tsx    # Sidebar bên phải: Thiết lập chung & Danh sách nhân vật
│       ├── CharacterCard.tsx        # Thẻ cấu hình từng nhân vật (Chọn giọng, tốc độ, cao độ)
│       └── EmptyDialogueState.tsx   # Trạng thái rỗng: Hướng dẫn 3 bước + nút Kịch bản mẫu
└── views/
    └── DialogueWorkspace.tsx        # [MỚI] Workspace chính tích hợp Editor + Inspector + Player
```

---

## 4. Data Contracts & Schema (`src/types/dialogue.ts`)

```typescript
export interface DialogueCharacter {
  id: string;               // Normalized key (e.g. "nam", "vy", "lan")
  name: string;             // Display name (e.g. "Nam", "Vy", "Lan")
  color: string;            // Distinct theme color class or hex
  segmentCount: number;     // Number of dialogue turns detected in text
  voiceId?: string;         // Assigned VoiceProfile id from VoxLab
  speed: number;            // Playback speed override (default: 1.0)
  pitch: number;            // Pitch override (default: 1.0)
  volume: number;           // Volume override (default: 1.0)
}

export interface DialogueSegment {
  id: string;
  index: number;
  characterName: string;
  characterId: string;
  text: string;
  cleanText: string;        // Text stripped of character label and inline tags
  pauseAfterSec: number;    // Inter-speaker pause duration
  status: "pending" | "generating" | "ready" | "failed";
  audioBuffer?: AudioBuffer;
  audioBlobUrl?: string;
  durationSec?: number;
  errorMessage?: string;
}

export interface DialogueGlobalSettings {
  model: string;            // TTS model (default: "omni-voice" or active model)
  masterVolume: number;     // Overall volume multiplier (0.0 to 2.0, default: 1.0)
  exportSrt: boolean;       // Whether to export SRT alongside audio (default: true)
  turnPauseSec: number;     // Turn-taking pause between different speakers (default: 0.3s)
  sameSpeakerPauseSec: number; // Pause between consecutive turns of same speaker (default: 0.2s)
}

export interface DialogueSessionState {
  rawScript: string;
  characters: DialogueCharacter[];
  segments: DialogueSegment[];
  settings: DialogueGlobalSettings;
  isProcessing: boolean;
  activeSegmentId: string | null;
  masterAudioUrl: string | null;
  masterDurationSec: number;
}
```

---

## 5. Cú Pháp Kịch Bản & Thuật Toán Parser

### 5.1 Cú pháp hỗ trợ
Hệ thống chấp nhận các cú pháp chuẩn và linh hoạt:
1. `[Tên]: Lời thoại` *(Chuẩn khuyến nghị)*
2. `[Tên] Lời thoại`
3. `Tên: Lời thoại`
4. Cảm xúc / chỉ dẫn sân khấu: `[Nam] (vui vẻ): Xin chào cả nhà!` $\rightarrow$ nhãn cảm xúc được bóc tách riêng, không phát âm chữ trong ngoặc đơn nếu người dùng chọn ẩn.
5. Khoảng dừng tùy ý: `[pause: 1.0s]` hoặc `[nghi: 500ms]` chèn giữa lời thoại.

### 5.2 Bảng màu tự động cho nhân vật
Để đảm bảo giao diện trực quan như hình mẫu:
- Nhân vật 1: **Tím (Purple)** (`#a855f7` / `text-purple-400 bg-purple-500/15 border-purple-500/30`)
- Nhân vật 2: **Xanh dương (Blue/Sky)** (`#38bdf8` / `text-sky-400 bg-sky-500/15 border-sky-500/30`)
- Nhân vật 3: **Xanh lá (Emerald)** (`#34d399` / `text-emerald-400 bg-emerald-500/15 border-emerald-500/30`)
- Nhân vật 4: **Cam/Hổ phách (Amber)** (`#fbbf24` / `text-amber-400 bg-amber-500/15 border-amber-500/30`)
- Nhân vật 5: **Hồng/Đỏ hoa hồng (Rose)** (`#fb7185` / `text-rose-400 bg-rose-500/15 border-rose-500/30`)
- Nhân vật 6+: Xoay vòng bảng màu cao cấp.

---

## 6. Giao Diện & Trải Nghiệm Người Dùng (UX/UI Specification)

### 6.1 Bố cục 3 vùng (Three-Zone Studio Architecture)
1. **Sidebar Trái (VoxLab Main Nav)**:
   - Thêm tab `Hội Thoại` (id: `"dialogue"`), icon `MessagesSquare` hoặc `Users2`, nằm giữa `Text to Speech` và `Phụ đề`.
2. **Khu vực trung tâm (Dialogue Editor Workspace)**:
   - Header:
     - Biểu tượng + Tiêu đề: **Chuyển đổi hội thoại**
     - Mô tả phụ: *Mỗi đoạn bắt đầu bằng [Tên]:*
     - Nút tiện ích: **+ Thêm khoảng dừng**, **Văn bản mẫu**, **Tải file kịch bản (.docx, .txt)**
   - Vùng soạn thảo kịch bản:
     - Kỹ thuật **Highlighter Overlay + Transparent Textarea**: Cho phép gõ tiếng Việt có dấu (Unikey, EVKey Telex/VNI) mượt mà 100%, không giật lag, không lệch con trỏ, đồng thời các thẻ `[Tên]:` được render nổi bật với badge màu tương ứng.
   - Thanh trạng thái chân trang (Footer Bar):
     - Bên trái: `3 tên giọng | Tổng số 117 từ, 546 ký tự`
     - Bên phải: Nút **CHUYỂN ĐỔI** (`h-[68px]` hoặc `h-11` bo góc chuẩn VoxLab, trạng thái disabled khi chưa có nhân vật).
3. **Thanh bên phải (Right Inspector)**:
   - **Thẻ 1: Thiết lập chung (Cho tất cả giọng đọc)**:
     - Mô hình TTS (Dropdown danh sách model)
     - Âm lượng (Slider 0% - 200%, default 1.00)
     - Xuất tệp SRT (Phụ đề) (Toggle switch)
     - Nghỉ giữa phân đoạn (Number input kèm đơn vị giây `0.3 s`)
   - **Thẻ 2: Tùy chỉnh giọng đọc**:
     - *Trạng thái rỗng (Empty State)*: Khi script chưa có text, hiển thị thẻ hướng dẫn 3 bước + nút "Sử dụng văn bản mẫu".
     - *Trạng thái đã có nhân vật (Populated State)*: Hiển thị danh sách card của từng nhân vật:
       - Header: Badge màu `[Tên]` + `Gồm X phân đoạn` + Nút mic nghe thử.
       - Nút chọn giọng: Mở `VoiceSelectionModal` của VoxLab (tự động gợi ý giọng theo giới tính nếu tên nhân vật là Nam/Vy/Bố/Mẹ,...).
       - Tốc độ giọng (1x) & Cao độ (1.00).

---

## 7. Âm Thanh & Xuất Master (Audio Engine Specification)

1. **Sinh âm thanh từng phân đoạn (Per-Segment Synthesis)**:
   - Sử dụng concurrency queue của VoxLab để sinh âm thanh cho từng phân đoạn theo đúng `voiceId`, `speed`, `pitch` đã gán.
2. **Ghép Master Audio (Master WAV Assembly)**:
   - Chèn khoảng lặng thời gian thực giữa các phân đoạn:
     - Nếu phân đoạn $i$ và phân đoạn $i+1$ khác nhân vật: chèn `turnPauseSec` (mặc định 0.3s - 0.8s).
     - Nếu cùng một nhân vật nói 2 câu liên tiếp: chèn `sameSpeakerPauseSec` (mặc định 0.2s).
   - Nối liền mạch thành 1 file Master WAV chuẩn 44.1kHz 16-bit PCM Mono/Stereo.
3. **Trình phát Bottom Audio Player**:
   - Khi có Master Audio, thanh `BottomAudioPlayer` hiện ở chân trang cho phép nghe thử toàn bộ cuộc hội thoại, tua tiến/lùi, điều chỉnh âm lượng, và tải file audio về máy.
4. **Xuất phụ đề SRT có tên người nói**:
   - Tự động sinh file `.srt` với thời gian bắt đầu và kết thúc của từng câu thoại:
     ```srt
     1
     00:00:00,000 --> 00:00:04,500
     [Nam]: Vy ơi, cậu có thấy tớ giống một chiếc meme hướng nội không?

     2
     00:00:04,800 --> 00:00:09,200
     [Vy]: Haha, lại văn vở! Tớ thấy cậu giống một chiếc cờ đỏ di động thì có.
     ```

---

## 8. Boundaries & Quality Contract

- **Always Do**:
  - Đảm bảo gõ tiếng Việt Telex/VNI trong editor mượt mà 100% không bị nuốt ký tự hay giật con trỏ.
  - Tự động lưu bản nháp kịch bản vào `localStorage`/`sessionStorage` để không mất nội dung khi reload trang.
  - Viết đầy đủ unit tests cho bộ parser regex và thuật toán ghép master audio.
  - Chạy `npx tsc --noEmit` và bộ test tự động trước khi báo hoàn tất.
- **Ask First**:
  - Thêm bất kỳ thư viện npm bên ngoài nào (ưu tiên tận dụng tối đa mã nguồn hiện có của VoxLab).
  - Thay đổi cấu trúc cơ sở dữ liệu hoặc storage của các tab khác.
- **Never Do**:
  - Không sửa đổi mã nguồn khi chưa có sự đồng ý của người dùng.
  - Không hard-code danh sách nhân vật cố định; phải hoàn toàn động theo kịch bản người dùng nhập.

---

## 9. Acceptance Criteria (Tiêu chí nghiệm thu)

- [ ] **AC-01**: Tab "Hội Thoại" xuất hiện trên thanh điều hướng bên trái của VoxLab và chuyển đổi qua lại mượt mà.
- [ ] **AC-02**: Khi nhập kịch bản theo mẫu `[Tên]: Lời thoại`, hệ thống tự động bóc tách danh sách nhân vật và đếm đúng số phân đoạn.
- [ ] **AC-03**: Thẻ tên nhân vật được tô màu riêng biệt theo từng nhân vật trong khung soạn thảo.
- [ ] **AC-04**: Khi kịch bản rỗng, hiển thị đúng hướng dẫn 3 bước và nút "Sử dụng văn bản mẫu". Bấm nút sẽ chèn ngay đoạn đối thoại mẫu.
- [ ] **AC-05**: Thẻ mỗi nhân vật ở sidebar bên phải cho phép chọn giọng nói từ Voice Modal của VoxLab, chỉnh tốc độ và cao độ độc lập.
- [ ] **AC-06**: Nút "+ Thêm khoảng dừng" hoạt động chính xác, chèn mốc nghỉ vào kịch bản.
- [ ] **AC-07**: Thanh footer hiển thị đúng tổng số tên giọng, số từ, số ký tự.
- [ ] **AC-08**: Khi bấm "CHUYỂN ĐỔI", hệ thống tạo âm thanh từng đoạn với đúng giọng của nhân vật đó, ghép thành Master Audio có khoảng nghỉ tự nhiên.
- [ ] **AC-09**: Nghe thử toàn bộ hội thoại trên BottomAudioPlayer và tải file WAV/SRT thành công.
- [ ] **AC-10**: `npx tsc --noEmit` đạt 0 lỗi, 100% tests vượt qua.
