# VOXLAB — TTS MAIN WORKSPACE UI SIMPLIFICATION REQUIREMENTS

Document: `tasks/tts-workspace-simplification-requirements.md`  
Scope: Main Text to Speech Workspace UI Simplification for VoxLab Desktop  
Status: **DRAFT / SPECIFICATION**  
Author: Antigravity Code Quality & UI Engineering  
Date: 2026-09-07  

---

## 1. OBJECTIVES & CORE PRINCIPLES

1. **Information Density & Minimalism**:
   - Less text, fewer redundant status badges, fewer concurrent controls.
   - Content is the center: text readability and audio production workflow take top priority.
   - Advanced settings revealed on-demand via progressive disclosure.
2. **Global Status Principle: NORMAL STATE = SILENT**:
   - Normal states (Saved, Ready, Fully Synced, Auto Pause, Default, GPU Ready) are SILENT.
   - UI exclusively highlights states demanding user attention: Processing / Generating, Modified, Error, Action Required, Completed.
3. **Zero Capability Loss**:
   - Retain 100% of synthesis, voice picking, model switching, fine-tuning, editing, regeneration, and export capabilities.

---

## 2. CORE REQUIREMENTS (TTS-R-001 to TTS-R-032)

### Section 1: Left Sidebar
- **TTS-R-001**: Remove non-essential section headings from the left sidebar ("KHÔNG GIAN LÀM VIỆC CHÍNH", "TIỆN ÍCH").
- **TTS-R-002**: Remove explanatory subtitles / descriptions below navigation items:
  - Text to Speech: remove "Kịch bản dài & câu đọc"
  - Voice Clone: remove "Tạo mẫu giọng mới"
  - Voice Library: remove "Quản lý & tái sử dụng giọng"
  - Transcription: remove "Bóc băng ASR độc lập"
- **TTS-R-003**: Sidebar navigation items must cleanly display icon + primary label only (Text to Speech, Voice Clone, Voice Library, Transcription, Lịch sử, Cài đặt) without losing active state indicators or icons.
- **TTS-R-004**: Remove permanent "Active Engine Omni Voice" widget from the bottom of the sidebar (engine selection is located in TTS Inspector). Keep the collapse/expand toggle button.

### Section 2: Project Header / TopBar
- **TTS-R-005**: Retain project title ("Kịch bản Podcast Công nghệ Tập 12" / dynamic project title).
- **TTS-R-006**: Remove permanent status badges "Đã lưu" and "Cục bộ" / "Online" from the header under normal conditions.
- **TTS-R-007**: Save status indicator must only appear when an active notification is needed ("Đang lưu...", "Chưa lưu", "Lỗi lưu"). Normal state remains completely silent.

### Section 3: Workflow Tabs & Stage Navigation
- **TTS-R-008**: Update stage tab wording:
  - "1. Soạn & Chuẩn bị" &rarr; "Soạn thảo"
  - "2. Chunk Studio" &rarr; "Tạo giọng"
- **TTS-R-009**: Remove numerical prefixes ("1.", "2.") and technical jargon ("Chunk Studio") from user-facing navigation tabs.
- **TTS-R-010**: Remove the density toggle ("Thoáng / Gọn") from the main workspace toolbar.

### Section 4: Main Sentence List Header & Toolbar
- **TTS-R-011**: Remove the long explanatory info line ("Kịch bản gồm 7 câu • Tự động giữ nguyên số, mốc thời gian và định dạng kỹ thuật."). Optionally show a minimal count ("7 câu") or omit if clear from context.
- **TTS-R-012**: Remove the permanent duplicated status breakdown ("Sẵn sàng (3)", "Đã sửa (1)", "Đang tạo... (1)", "Lỗi (1)") from the list header.
- **TTS-R-013**: If a summary badge is displayed in the list header, it must only prioritize actionable exceptions (e.g. "1 câu lỗi" or "5/7 hoàn tất · 1 lỗi"), never enumerating normal ready states.
- **TTS-R-014**: Reduce main action toolbar CTA congestion to maximum 2–3 contextually relevant actions:
  - Default primary actions: `[Tạo audio]` and `[Xuất audio]`.
  - Contextual action: `[Tạo lại 2 câu]` (only when modified/failed sentences exist).
  - Remove redundant `[Sửa văn bản]` button (users switch directly via the "Soạn thảo" tab).

### Section 5: Sentence Cards (Normal State = Silent)
- **TTS-R-015**: A normal ready sentence card must be clean and silent:
  - Do NOT display "Sẵn sàng" badge.
  - Do NOT display "Khớp hoàn toàn".
  - Do NOT display automatic/default pause info ("Khoảng nghỉ sau câu: Tự động (~400ms)").
  - Clean visual hierarchy: Index & Duration &rarr; Editable text &rarr; `[▶ Nghe]` & `[↻ Tạo lại]`.
- **TTS-R-016**: Sentence card badges only appear for states requiring attention: "Đang tạo...", "Đã sửa", "Lỗi", "Cần tạo lại".
- **TTS-R-017**: Shorten regenerate action wording: change "Tạo lại câu này" to "Tạo lại".
- **TTS-R-018**: Simplify modified sentence card: remove verbose explanatory paragraph ("Audio cũ không còn khớp với nội dung mới. Bấm ‘Tạo lại câu này’ để cập nhật.") &rarr; display badge "Đã sửa" and action `[Tạo lại]`.
- **TTS-R-019**: Simplify error sentence card: remove long paragraph ("Hệ thống ghi nhận worker...") &rarr; display badge "Lỗi", concise error label (e.g. "Worker Timeout"), and action `[Thử lại]`.
- **TTS-R-020**: Sentence pause info: hide pause info when using default/automatic pause. Only display when user explicitly overrides pause for that specific sentence (e.g. "Nghỉ: 1.2s").

### Section 6: Right TTS Inspector
- **TTS-R-021**: Streamline default Inspector view into a clean primary stack:
  1. Voice card with "Đổi giọng"
  2. Model dropdown ("Omni Voice")
  3. Speed slider
  4. Pitch slider
  5. Sắc thái biểu cảm / Emotion dropdown
  6. Collapsible "Ngắt nghỉ >"
  7. Collapsible "Nâng cao >"
- **TTS-R-022**: Remove development / layout measurement labels (e.g. "340px", "350px", "420px") from the user-facing header. Keep the Inspector collapse button.
- **TTS-R-023**: Move Volume ("Âm lượng") slider out of default view into the collapsible "Nâng cao" section.
- **TTS-R-024**: Advanced parameters (Volume, future Seed, Temperature, CFG, sampling) must reside under "Nâng cao" via progressive disclosure.
- **TTS-R-025**: The "QUÃNG NGẮT NGHỈ DẤU CÂU" section must be collapsed by default ("Ngắt nghỉ >"). When expanded, display pause inputs for comma, period, question/exclamation, colon/semicolon, and sentence pause.
- **TTS-R-026**: Eliminate repetitive "Mặc định" labels across sections; provide a single reset action ("Đặt lại" / icon) where appropriate.
- **TTS-R-027**: Simplify sliders: remove clutter of multiple permanent static milestone markers (0.5x, 1.0x Chuẩn, 2.0x); cleanly display label and current value (e.g. `Tốc độ: 1.00×`).
- **TTS-R-028**: Simplify Voice Inspector card header: remove redundant count label ("12 giọng sẵn có"). Focus on voice name, compact metadata, and "Đổi giọng" button.
- **TTS-R-029**: Support collapsing / toggling the Inspector cleanly without layout distortion.

### Section 7: Bottom Progress & Status Bar
- **TTS-R-030**: Streamline generating state: eliminate redundant overlapping labels ("Đang tạo audio", "Câu 5/7 (71%)", "Đã chạy 00:24", "Còn lại ~00:10", "Tiến độ tổng hợp 71%"). Unify into a single concise indicator: `[Progress Bar] 5/7 · 71% · còn ~10s` + `[Tạm dừng]` + `[Hủy]`.
- **TTS-R-031**: Remove permanent "GPU: Sẵn sàng" status from the bottom bar. Only display hardware alerts when an error or throttle condition occurs.
- **TTS-R-032**: Completed state: when synthesis finishes, bottom bar displays clean completion status (`✓ Hoàn tất · 7 câu` + `[Mở thư mục]` + `[Xuất audio]`), discarding obsolete active-job counters.

---

## 3. ACCEPTANCE CRITERIA (TTS-AC-001 to TTS-AC-025)

- **TTS-AC-001**: Left sidebar displays navigation items without section headings and without subtitle descriptions.
- **TTS-AC-002**: "Active Engine Omni Voice" block is absent from sidebar bottom; sidebar collapse/expand toggle works smoothly.
- **TTS-AC-003**: TopBar displays project name; permanent "Đã lưu" and "Cục bộ" badges are removed during normal state.
- **TTS-AC-004**: Stage tabs read "Soạn thảo" and "Tạo giọng" without numerical prefixes or "Chunk Studio" terminology.
- **TTS-AC-005**: "Thoáng / Gọn" density switch is removed from the main workspace toolbar.
- **TTS-AC-006**: Long boilerplate info line ("Kịch bản gồm 7 câu • Tự động giữ nguyên...") is removed from sentence list header.
- **TTS-AC-007**: Status summary in list header does not enumerate normal ready states; displays only exceptions (e.g. "1 lỗi" or "2 câu cần tạo") or is omitted when all normal.
- **TTS-AC-008**: Main toolbar displays at most 2–3 context-relevant buttons (e.g. `[Tạo audio]`, `[Xuất audio]`, plus contextual `[Tạo lại 2 câu]` when modified/error chunks exist). Redundant `[Sửa văn bản]` button is removed.
- **TTS-AC-009**: Normal ready sentence card displays NO "Sẵn sàng" badge, NO "Khớp hoàn toàn", and NO default pause text.
- **TTS-AC-010**: Normal sentence card displays index (`01`), duration (`4.2s`), editable text, and concise action buttons (`▶ Nghe`, `↻ Tạo lại`).
- **TTS-AC-011**: Sentence card badges only appear for non-normal states: "Đang tạo...", "Đã sửa", "Lỗi".
- **TTS-AC-012**: Button label reads "Tạo lại" instead of "Tạo lại câu này".
- **TTS-AC-013**: Modified sentence card displays "Đã sửa" badge and "Tạo lại" button, omitting verbose explanation text.
- **TTS-AC-014**: Failed sentence card displays "Lỗi" badge, short error message ("Worker Timeout"), and "Thử lại" button, omitting verbose explanation text.
- **TTS-AC-015**: Sentence pause info only appears on cards where the user has explicitly overridden the default pause value.
- **TTS-AC-016**: Inspector header does NOT display pixel layout numbers ("340px", etc.).
- **TTS-AC-017**: Inspector default view contains only: Voice Card + Change Voice, Model selector, Speed slider, Pitch slider, Emotion dropdown, "Ngắt nghỉ >", and "Nâng cao >".
- **TTS-AC-018**: Volume slider is relocated into the collapsible "Nâng cao" section.
- **TTS-AC-019**: Punctuation pause section is collapsed by default ("Ngắt nghỉ >") and opens on demand.
- **TTS-AC-020**: Inspector sliders display clean current value without clutter of multiple redundant milestone markers.
- **TTS-AC-021**: Voice Inspector card removes "12 giọng sẵn có" label.
- **TTS-AC-022**: Bottom bar generating state unifies progress info into a concise single line (`5/7 · 71% · còn ~10s`), removing redundant duplicated text strings.
- **TTS-AC-023**: "GPU: Sẵn sàng" is removed from the bottom bar in normal operation.
- **TTS-AC-024**: Bottom bar completed state displays `✓ Hoàn tất · 7 câu` with `[Mở thư mục]` and `[Xuất audio]`.
- **TTS-AC-025**: Zero regression of functional capabilities: Voice selection via "Đổi giọng" opens Voice Picker modal; preview, regenerate, retry, export, pause, cancel, and tab navigation all work across 1920x1080, 1440x900, and 1024x700 without horizontal overflow.
