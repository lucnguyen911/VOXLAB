# VOICE PICKER SPECIFICATION & TRACEABILITY MATRIX

Document: `tasks/voice-picker-requirements.md`  
Scope: VoxLab Desktop — Voice Picker Popup ("Chọn giọng nói")  
Source: User Directive (Phase 6 UI/UX Productization Pass - Voice Picker Specification)  
Traceability Status: **100% COVERAGE** (All 27 source sections mapped)

---

## I. BACKWARDS REQUIREMENT TRACEABILITY MATRIX (SOURCE → REQUIREMENT ID)

| Source Section | Source Requirement Detail | Mapped ID | Coverage |
| :--- | :--- | :--- | :---: |
| **MỤC TIÊU** | Voice Picker: browse, preview, filter, select directly, launch create | **R-01** | FULL |
| **MỤC TIÊU** | Not Voice Library replica; library for deep management (rename, delete, audio, import/export, quota, bulk) | **R-02** | FULL |
| **MỤC TIÊU** | Priority: ĐƠN GIẢN → NHANH → ÍT CHỮ → DỄ TÌM GIỌNG | **R-03** | FULL |
| **MỤC TIÊU** | No unnecessary UI or technical/debug info | **R-04** | FULL |
| **Section 1** | Keep 3 groups: Hệ thống, Giọng của tôi, Yêu thích | **R-05** | FULL |
| **Section 1** | No redundant/overlapping tabs (System, Clone, Custom, Favorite) | **R-06** | FULL |
| **Section 1** | Keep search bar, preview playback button, favorite toggle, create voice, 1-click select | **R-07** | FULL |
| **Section 2** | Rename “Nhân bản giọng mới” to “Tạo giọng mới” | **R-08** | FULL |
| **Section 2** | Detailed creation flow (upload, record, clone) in next step, not embedded in picker | **R-09** | FULL |
| **Section 3** | Filter system without overcrowding toolbar | **R-10** | FULL |
| **Section 3.A** | Language Filter (MANDATORY): "Tất cả", "Tiếng Việt", "English", others if supported | **R-11** | FULL |
| **Section 3.B** | Gender Filter (MANDATORY): Exactly 3 states ("Tất cả", "Nam", "Nữ"); no taxonomy expansion | **R-12** | FULL |
| **Section 3.C** | Region / Accent (MANDATORY): Miền Bắc, Trung, Nam, US, UK... Unified label "Vùng / Accent" | **R-13** | FULL |
| **Section 3.D** | Style (SHOULD): MVP list (Tự nhiên, Kể chuyện, Thuyết minh, Podcast, Quảng cáo) | **R-14** | FULL |
| **Section 3.E** | Timbre / Chất giọng (OPTIONAL/ADVANCED): Only if reliable metadata exists; no subjective tags | **R-15** | FULL |
| **Section 3.F** | Model Compatibility (ADVANCED): OmniVoice, Chatterbox, Qwen TTS... inside "Bộ lọc" drawer | **R-16** | FULL |
| **Section 4** | Do NOT use Emotion as a fixed voice filter (generation parameter, not fixed voice property) | **R-17** | FULL |
| **Section 5** | Sorting strictly separated from filtering | **R-18** | FULL |
| **Section 5** | Sorting options: Dùng nhiều, Mới nhất, A–Z, Gần đây | **R-19** | FULL |
| **Section 5** | Single dropdown `Sắp xếp: [Dùng nhiều ▼]` without exposing all options on toolbar | **R-20** | FULL |
| **Section 6** | Toolbar priority layout: `[Tìm kiếm]` \| `[Ngôn ngữ: Tất cả ▼]` \| `[Vùng / Accent: Tất cả ▼]` \| `[Bộ lọc]` \| `[Sắp xếp ▼]` | **R-21** | FULL |
| **Section 6** | Gender in segmented control OR inside "Bộ lọc" drawer if crowded | **R-22** | FULL |
| **Section 7** | "Bộ lọc" button opens collapsible drawer with Gender, Style, Model, Reset | **R-23** | FULL |
| **Section 7 / 22** | Progressive disclosure: default state minimal, advanced revealed on demand | **R-24** | FULL |
| **Section 8** | Removable active filter chips for non-default applied filters | **R-25** | FULL |
| **Section 8** | Click `×` to remove individual active filter | **R-26** | FULL |
| **Section 8** | Do NOT display chips for default values ("Tất cả", "Default") | **R-27** | FULL |
| **Section 8 / 19** | Dedicated "Đặt lại" (Reset) button restores all filters to default | **R-28** | FULL |
| **Section 19** | Filter persistence across popup close/reopen in same session with clear visibility | **R-29** | FULL |
| **Section 9** | Voice card minimalist: max ~2–3 key metadata items per card | **R-30** | FULL |
| **Section 9** | Do not clutter card with multiple simultaneous badges | **R-31** | FULL |
| **Section 10** | Tag priority: 1. Gender, 2. Accent/Region, 3. Style; omit language/model if unnecessary | **R-32** | FULL |
| **Section 11** | Play button previews sample audio ONLY; does NOT select voice | **R-33** | FULL |
| **Section 11** | Clicking card selects voice, applies to TTS, closes popup immediately (1-click select) | **R-34** | FULL |
| **Section 12** | Currently used voice clearly marked with `✓ Đang dùng` and subtle border/ring | **R-35** | FULL |
| **Section 13** | Favorite heart toggle independent from selection (`e.stopPropagation()`) | **R-36** | FULL |
| **Section 14** | Desktop targeted size: Width ~900–1050px, Height ~600–720px | **R-38** | FULL |
| **Section 14** | Voice list scrolls internally; header, tabs, and toolbar remain fixed | **R-39** | FULL |
| **Section 15** | Responsive grid: cards do not stretch excessively when few; flows naturally when many | **R-40** | FULL |
| **Section 16** | Remove heavy bottom footer; place count subtly in header | **R-41** | FULL |
| **Section 16 / 23** | Modal dismissal supported via X button, Escape key, and backdrop click | **R-42** | FULL |
| **Section 18** | Logical AND combination for multi-filter; search works simultaneously with filters | **R-43** | FULL |
| **Section 20** | No fake or speculative metadata; no invented taxonomy without backing data | **R-44** | FULL |
| **Section 21** | Separation of concerns: Voice Picker vs Voice Library; zero regression | **R-45** | FULL |
| **Section 20** | Schema migration & backward compatibility for voice schema additions | **R-46** | FULL |
| **Section 23** | Clear keyboard focus indicators on all interactive controls | **R-47** | FULL |
| **Section 23** | Tooltips on icon-only buttons | **R-48** | FULL |
| **Section 23** | Clearly distinguishable hover / focus / selected / current states | **R-49** | FULL |
| **Section 23** | Focus context & restoration upon modal open/close | **R-50** | FULL |
| **Section 26** | Persisted / current active voice integrity across workspace switches | **R-51** | FULL |
| **Section 26** | Zero horizontal overflow on viewport or modal containers | **R-52** | FULL |

---

## II. CORE PRODUCT REQUIREMENTS (R-01 to R-52)

### 1. Architectural Role & Information Architecture
- **R-01 [MUST]**: Voice Picker popup is a quick selection modal designed specifically to: browse/find voices, preview samples, filter, select directly for immediate TTS usage, and launch voice creation when needed.
- **R-02 [MUST]**: Voice Picker popup must NOT replicate the full management capabilities of Voice Library (e.g. rename, delete, edit metadata, manage reference audio files, import/export, clone configuration, storage/quota management, bulk actions).
- **R-03 [MUST]**: Voice Picker design priority must be: Simple → Fast → Minimal Text → Easy to find voice.
- **R-04 [MUST]**: No unnecessary technical metadata, debug/dev values, or implementation details rendered in the picker.
- **R-05 [MUST]**: Retain exactly 3 core groups/tabs: "Hệ thống" (System), "Giọng của tôi" (My Voices), and "Yêu thích" (Favorites).
- **R-06 [MUST]**: Do not introduce redundant or overlapping tabs (such as System, Clone, Custom, Favorite overlapping each other).
- **R-07 [MUST]**: Retain search bar, preview playback button on each card, favorite toggle, create new voice button, and direct 1-click voice selection.

### 2. Button Wording & Navigation
- **R-08 [MUST]**: Rename "Nhân bản giọng mới" to "Tạo giọng mới" (accessible, intuitive terminology for general users).
- **R-09 [MUST]**: Create voice flow details (upload, record, clone) must not be fully embedded in the picker; it should trigger navigation to the creation flow.

### 3. Filter System
- **R-10 [MUST]**: Add a filtering system without overcrowding or cluttering the toolbar.
- **R-11 [MUST]**: Language Filter (MANDATORY): Support "Tất cả" (All), "Tiếng Việt", "English", and additional languages if supported by voices.
- **R-12 [MUST]**: Gender Filter (MANDATORY): Exactly 3 states: "Tất cả" (All), "Nam" (Male), "Nữ" (Female). Do not expand gender taxonomy beyond supported metadata.
- **R-13 [MUST]**: Region / Accent Filter (MANDATORY): Unified UI label must be "Vùng / Accent". Support Vietnamese accents: "Miền Bắc", "Miền Trung", "Miền Nam"; English accents: "US", "UK", etc.
- **R-14 [SHOULD]**: Style Filter: Standard MVP list: "Tự nhiên" (Natural), "Kể chuyện" (Storytelling), "Thuyết minh" (Narration), "Podcast", "Quảng cáo" (Advertising). Do not create dozens of tags or complex taxonomy.
- **R-15 [OPTIONAL/ADVANCED]**: Timbre / Chất giọng: Only support if reliable actual metadata exists (Ấm, Sáng, Trầm, Mềm, Mạnh, Trẻ, Trưởng thành). Must NOT expose by default or add subjective/unreliable tags. If metadata is not reliable, do NOT add this filter.
- **R-16 [ADVANCED]**: Model Compatibility: Voices declare model compatibility (Omni Voice, Chatterbox Turbo, Qwen 1.7B...). Must NOT be a prominent standalone dropdown on the main toolbar; place inside the advanced "Bộ lọc" area.
- **R-17 [MUST]**: Do NOT use Emotion as a fixed voice filter (emotions are generation parameters, not fixed voice properties).

### 4. Sorting & Toolbar Layout
- **R-18 [MUST]**: Sorting must be strictly separated from filtering (sorting is not a filter).
- **R-19 [MUST]**: Sorting options must support at least: "Dùng nhiều" (Popular), "Mới nhất" (Newest), "A–Z" (Alphabetical), "Gần đây" (Recent).
- **R-20 [MUST]**: Sorting must use a single dropdown: `Sắp xếp: [Dùng nhiều ▼]` without exposing all options simultaneously on the toolbar.
- **R-21 [MUST]**: Main toolbar layout: `[Tìm kiếm]` | `[Ngôn ngữ: Tất cả ▼]` | `[Vùng / Accent: Tất cả ▼]` | `[Bộ lọc]` | `[Sắp xếp: Dùng nhiều ▼]`.
- **R-22 [MUST]**: Gender filter must be in a clean segmented control OR moved inside "Bộ lọc" drawer if toolbar is crowded.
- **R-23 [MUST]**: "Bộ lọc" button must open a collapsible/popover area containing less frequent filters (Gender, Style, Model, and Reset).
- **R-24 [MUST]**: Progressive disclosure: default state must remain clean and minimal; advanced filters revealed only on demand.

### 5. Active Filter Chips & Session Persistence
- **R-25 [MUST]**: When user applies non-default filters, display removable chips (e.g. `[Miền Bắc ×]`, `[Podcast ×]`).
- **R-26 [MUST]**: User can click `×` to remove an individual active filter.
- **R-27 [MUST]**: Do NOT display chips for default values ("Tất cả", "Default", unconstrained).
- **R-28 [MUST]**: Dedicated "Đặt lại" (Reset) button must restore all filters to default state.
- **R-29 [MUST]**: Filter persistence: retain filter selections across modal close/reopen in the same session without causing "hidden filter" confusion (active chips and counter visible).

### 6. Voice Card Presentation & Interaction
- **R-30 [MUST]**: Minimalist voice card: each card displays at most 2–3 key metadata items (e.g. `Nữ · Miền Bắc · Tự nhiên`).
- **R-31 [MUST]**: Do not clutter card with multiple simultaneous badges.
- **R-32 [MUST]**: Tag display priority: 1. Gender, 2. Accent/Region, 3. Style. Language omitted if already filtered or obvious from name; Model compatibility only shown if conflict/necessary.
- **R-33 [MUST]**: Play button ONLY previews sample audio; it must NOT select the voice (`e.stopPropagation()`).
- **R-34 [MUST]**: Clicking the card body selects the voice for TTS and closes the popup immediately (1-click select, no redundant Confirm/Apply steps).
- **R-35 [MUST]**: Currently used voice clearly marked with `✓ Đang dùng` and subtle border/ring accent without noisy multi-cue visual clutter.
- **R-36 [MUST]**: Favorite heart icon toggle is strictly independent; clicking it must NOT select the voice or close the modal (`e.stopPropagation()`).
- **R-37 [MUST]**: Long voice names must truncate cleanly and provide full text via tooltip or title.

### 7. Dimensions, Layout & Accessibility
- **R-38 [MUST]**: Popup dimensions targeted for desktop: Width ~900–1050px, Height ~600–720px (not a full-page modal).
- **R-39 [MUST]**: Voice list scrolls internally; header, tab bar, and toolbar remain fixed.
- **R-40 [MUST]**: Responsive grid: cards do not stretch excessively when few voices; flows naturally across rows when many voices.
- **R-41 [MUST]**: Remove heavy bottom footer (`Showing X voices`, `Close` button); result count placed subtly in header.
- **R-42 [MUST]**: Modal dismissal supported via: `X` button, keyboard `Escape` key, and backdrop click.
- **R-43 [MUST]**: Data model / Filter combination: all active criteria are evaluated with logical AND; search text works simultaneously with filters.
- **R-44 [MUST]**: No fake or speculative metadata: do not invent taxonomy or fabricate backend fields that do not exist.
- **R-45 [MUST]**: No regression of existing capabilities across TTS, Clone, Library, Transcription workspaces.

### 8. Schema Integrity, Accessibility & State Invariants (Sections 20, 23, 26)
- **R-46 [MUST]**: Schema Migration & Backward Compatibility: Any schema expansion (gender, accent, style, lastUsedAt) must maintain backward compatibility with existing persisted voice data without runtime breakage.
- **R-47 [MUST]**: Clear Keyboard Focus: All interactive controls (tabs, search input, filter selects, drawer buttons, cards, play, favorite, reset, clone, close) must provide clear keyboard focus indicators.
- **R-48 [MUST]**: Tooltips for Icon Buttons: Any icon button lacking explicit text must provide an accessible tooltip / title attribute.
- **R-49 [MUST]**: Distinct Visual States: Cards and controls must clearly distinguish between hover, focus, selected, and current-in-use states.
- **R-50 [MUST]**: Modal Focus Context & Restoration: Modal opening and closing must preserve keyboard focus context without abnormal focus drop into void.
- **R-51 [MUST]**: Persisted / Current Active Voice Integrity: Selecting or changing a voice must not lose or corrupt the current active voice in TTS upon workspace switching or modal reopening.
- **R-52 [MUST]**: Zero Horizontal Overflow: Neither the page body nor the Voice Picker modal container/grid may exhibit horizontal overflow or spurious horizontal scrollbars.

---

## III. ACCEPTANCE CRITERIA (AC-01 to AC-24)

- **AC-01 [MUST]**: Popup opens from “Đổi giọng” in TTS Inspector.
- **AC-02 [MUST]**: User can switch voice directly without navigating to Voice Library.
- **AC-03 [MUST]**: Real-time text search works.
- **AC-04 [MUST]**: Filter by Language works.
- **AC-05 [MUST]**: Filter by Gender works.
- **AC-06 [MUST]**: Filter by Region / Accent works.
- **AC-07 [MUST]**: Filter by Style works.
- **AC-08 [MUST]**: Filters combine with each other (logical AND).
- **AC-09 [MUST]**: Search works simultaneously with active filters.
- **AC-10 [MUST]**: Sorting works (Dùng nhiều, Mới nhất, A–Z, Gần đây).
- **AC-11 [MUST]**: Active filters are clearly visible (chips & badges).
- **AC-12 [MUST]**: Can reset all filters to default with one action.
- **AC-13 [MUST]**: Voice card does not show excessive badges (max 2–3 key metadata).
- **AC-14 [MUST]**: Play preview does not alter the selected active voice.
- **AC-15 [MUST]**: Favorite toggle does not alter the selected active voice.
- **AC-16 [MUST]**: Clicking card selects voice and applies to TTS.
- **AC-17 [MUST]**: Currently active voice is clearly marked (`✓ Đang dùng`).
- **AC-18 [MUST]**: No need to visit Voice Library to select or switch voices.
- **AC-19 [MUST]**: Voice Library remains the dedicated full-screen management area.
- **AC-20 [MUST]**: Popup no longer feels like a full-page library replica.
- **AC-21 [MUST]**: Long list of voices scrolls internally without breaking layout.
- **AC-22 [MUST]**: Filters do not create hidden empty states without clear indication.
- **AC-23 [MUST]**: No fake metadata or unsupported taxonomy added.
- **AC-24 [MUST]**: Zero regressions in preview, favorite, selection, my voices, system, clone button.
