# VOICE PICKER COMPLIANCE MATRIX (FINAL CALIBRATION)

Document: `tasks/voice-picker-compliance.md`  
Scope: Final Compliance Remediation for VoxLab Desktop Voice Picker Popup ("Chọn giọng nói")  
Auditor: Antigravity Code Quality & Compliance Agent  
Date: 2026-09-07  
Status: **READY** (0 Root Blockers | 0 Partial Items, 1 Deferred/NA, 75 Pass, 0 Fail)  
Traceability: **100%** (All 27 source sections mapped to R-01–R-52 & AC-01–AC-24)

---

## I. SUMMARY OF AUDIT FINDINGS

| Category | Total Evaluated | PASS | PARTIAL | FAIL | BLOCKED | DEFERRED / N/A |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Core Requirements (R-01 to R-52)** | 52 | 51 | 0 | 0 | 0 | 1 |
| **Acceptance Criteria (AC-01 to AC-24)** | 24 | 24 | 0 | 0 | 0 | 0 |
| **Total Compliance Items** | **76** | **75** | **0** | **0** | **0** | **1** |

---

## II. RESOLUTION OF ROOT ISSUES

### A. COMPLIANCE BLOCKERS (All 4 Resolved)

1. **Root Issue 1 — Dynamic Session Recent Usage Update**
   - **Associated IDs**: `R-19`, `AC-10`
   - **Status**: **RESOLVED (PASS)**
   - **Code Location**: `src/App.tsx` (`handleSelectActiveVoice`), `src/components/modals/VoiceSelectionModal.tsx`
   - **Resolution Details**: Voice selection is centralized in `handleSelectActiveVoice` across `VoiceSelectionModal`, `TtsInspector`, `VoiceLibraryWorkspace`, and `VoiceCloneWorkspace`. Whenever a voice is selected, its `lastUsedAt` timestamp is updated to `new Date().toISOString()`.
   - **Runtime Verification**: DevTools runtime evaluated selecting a voice (Nam Anh); reopened modal and sorted by "recent" ("Gần đây"); verified Nam Anh was positioned at index 0 (top of the list) with status `success: true`.

2. **Root Issue 2 — Heuristic Fallback String Inference Removed**
   - **Associated IDs**: `R-44`, `AC-23`
   - **Status**: **RESOLVED (PASS)**
   - **Code Location**: `src/components/modals/VoiceSelectionModal.tsx`
   - **Resolution Details**: Completely eliminated speculative substring/regex inference functions (`getVoiceGender`, `getVoiceAccent`, `getVoiceStyle`). Voice card rendering strictly utilizes typed properties `[vGender, voice.accent, voice.style].filter(Boolean).join(" · ")` without rendering empty dots (` ·  · `). Added standard `normalizeVietnamese` for diacritic-insensitive search ("thao trinh" matches "Thảo Trinh").
   - **Runtime Verification**: DevTools runtime tested unaccented searches ("thao trinh", "sai gon"), both matching correctly. Verified metadata lines across all voices have zero heuristic parsing and zero empty separator dots (`hasEmptyDots: false`).

3. **Root Issue 3 — Keyboard Accessible Voice Cards & Isolated Controls**
   - **Associated IDs**: `R-47`, `R-49`
   - **Status**: **RESOLVED (PASS)**
   - **Code Location**: `src/components/modals/VoiceSelectionModal.tsx`, `src/components/inspector/TtsInspector.tsx`
   - **Resolution Details**: Voice card containers are interactive with `role="button"`, `tabIndex={0}`, `onKeyDown` (Enter/Space selection), and distinct `focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface1` outlines. Nested Play button and Favorite button have independent focus rings and stop event propagation (`e.stopPropagation()` on both click and keydown).
   - **Runtime Verification**: DevTools runtime verified card receives focus (`cardFocused: true`, `cardRole: "button"`), Play and Favorite receive focus independently (`playFocused: true`, `favFocused: true`), Enter on Play/Favorite does not select card or dismiss modal (`modalStillOpenAfterPlay: true`, `modalStillOpenAfterFav: true`), and Enter on card selects voice and closes modal (`selectedVoiceMatches: true`).

4. **Root Issue 4 — Modal Focus Containment & Restoration**
   - **Associated ID**: `R-50`
   - **Status**: **RESOLVED (PASS)**
   - **Code Location**: `src/components/modals/VoiceSelectionModal.tsx`
   - **Resolution Details**: Modal container has `role="dialog"`, `aria-modal="true"`, and `aria-label`. On open, focus automatically moves to the Search input. A keyboard trap listener contains Tab and Shift+Tab within the modal's focusable elements (wrapping from end to start and start to end). Dismissing via Escape key cleanly closes modal and restores focus back to the triggering button (`#voice-picker-trigger`).
   - **Runtime Verification**: DevTools runtime verified `wrappedToFirst: true`, `wrappedToLast: true`, `modalClosedAfterEscape: true`, and `focusRestoredToTrigger: true`.

---

### B. TECH DEBT & SAFE ENHANCEMENTS RESOLVED

1. **Active Chip Removal Tooltip String Nit (R-26)**
   - **Code Location**: `src/i18n/translations.ts`, `src/components/modals/VoiceSelectionModal.tsx`
   - **Resolution**: Added `removeFilter` across all locales (`vi: "Xóa bộ lọc này"`, `en: "Remove this filter"`, `ja: "このフィルターを削除"`, `zh: "移除此筛选条件"`). Chip remove button title is now `title={t.voiceModal.removeFilter}`. Runtime verified `chipTooltip: "Xóa bộ lọc này"`.

2. **Vietnamese Diacritic-Insensitive Search (AC-03)**
   - **Code Location**: `src/components/modals/VoiceSelectionModal.tsx`
   - **Resolution**: Integrated `normalizeVietnamese` helper using Unicode NFD normalization to strip diacritical marks. Searching "thao trinh" matches "Thảo Trinh (Hà Nội)" seamlessly.

---

### C. DEFERRED / N/A (1 Item)

1. **Production SQLite / Tauri Database Schema Migration (R-46)**
   - **Associated ID**: `R-46 (Production DB Aspect)`
   - **Detail**: VoxLab is currently in Phase 6 UI/UX frontend prototype. A SQLite/Tauri persistence layer does not yet exist. Frontend TypeScript interface backward compatibility (`VoiceProfile` optional fields) is **PASS**, while production database migration is **DEFERRED** to subsequent backend persistence phases.

---

## III. DETAILED COMPLIANCE MATRIX: CORE REQUIREMENTS (R-01 to R-52)

| ID | Requirement Description | Status | Code Evidence | Runtime Evidence | Notes |
| :--- | :--- | :---: | :--- | :--- | :--- |
| **R-01** | Quick selection modal: browse, preview, filter, select directly, launch clone | **PASS** | `VoiceSelectionModal.tsx` | Verified open, browse, play, filter, select Jenny Neural | Compliant |
| **R-02** | Must NOT replicate full Voice Library management capabilities | **PASS** | `VoiceSelectionModal.tsx` omits rename, delete, file import, quota, clone params | Library retains deep management; modal is focused picker | Compliant |
| **R-03** | Priority: Simple → Fast → Minimal Text → Easy to find voice | **PASS** | `VoiceSelectionModal.tsx` | Clean 1-row toolbar + collapsible drawer | Compliant |
| **R-04** | No unnecessary technical metadata, debug values, or internals | **PASS** | `VoiceSelectionModal.tsx` | Clean metadata string `Nữ · Miền Bắc · Tự nhiên`; no dev internals | Compliant |
| **R-05** | Retain exactly 3 core tabs: "Hệ thống", "Giọng của tôi", "Yêu thích" | **PASS** | `VoiceSelectionModal.tsx` | Centered header tabs with Globe, User, Heart icons | Compliant |
| **R-06** | No redundant or overlapping tabs | **PASS** | `VoiceSelectionModal.tsx` | Exactly 3 distinct tabs strictly partitioned | Compliant |
| **R-07** | Retain search, preview button, favorite, create new voice, 1-click select | **PASS** | `VoiceSelectionModal.tsx` | All 5 primary controls active and verified | Compliant |
| **R-08** | Rename "Nhân bản giọng mới" to "Tạo giọng mới" | **PASS** | `translations.ts` (`cloneNew: "Tạo giọng mới"`), `VoiceSelectionModal.tsx` | Button reads "Tạo giọng mới" | Compliant |
| **R-09** | Create voice flow triggers navigation, not embedded in picker | **PASS** | `VoiceSelectionModal.tsx` (`onClose(); onNavigateToClone();`) | Navigates to Voice Clone workspace; modal closes | Compliant |
| **R-10** | Filtering system without overcrowding toolbar | **PASS** | `VoiceSelectionModal.tsx` | Search + 2 dropdowns + "Bộ lọc" toggle + Sort | Compliant |
| **R-11** | Language Filter (MANDATORY): "Tất cả", "Tiếng Việt", "English" | **PASS** | `VoiceSelectionModal.tsx` | Selecting "English" filters to English voices | Compliant |
| **R-12** | Gender Filter (MANDATORY): Exactly 3 states ("Tất cả", "Nam", "Nữ") | **PASS** | `VoiceSelectionModal.tsx` | Segmented control with 3 states inside drawer | Compliant |
| **R-13** | Region / Accent Filter: Unified UI label "Vùng / Accent" | **PASS** | `VoiceSelectionModal.tsx` | Label is "Vùng / Accent:"; supports Miền Bắc, Miền Trung, Miền Nam, US, UK | Compliant |
| **R-14** | Style Filter: MVP list ("Tự nhiên", "Kể chuyện", "Thuyết minh", "Podcast", "Quảng cáo") | **PASS** | `VoiceSelectionModal.tsx` | Segmented buttons matching exact MVP style set | Compliant |
| **R-15** | Timbre / Chất giọng: Do NOT add if metadata is not reliable | **PASS** | `VoiceSelectionModal.tsx` completely omits timbre filter | No fake subjective timbre tags rendered | Compliant |
| **R-16** | Model Compatibility: Inside advanced "Bộ lọc" drawer, not main toolbar | **PASS** | `VoiceSelectionModal.tsx` | Located in drawer; filters voices by compatibility | Compliant |
| **R-17** | Do NOT use Emotion as a fixed voice filter | **PASS** | `VoiceSelectionModal.tsx` contains 0 emotion filters | Emotion handled in TTS generation parameters | Compliant |
| **R-18** | Sorting must be strictly separated from filtering | **PASS** | `VoiceSelectionModal.tsx` | Visual divider separates Sort; resetting filters preserves sorting | Compliant |
| **R-19** | Sorting options: "Dùng nhiều", "Mới nhất", "A–Z", "Gần đây" | **PASS** | `App.tsx` (`handleSelectActiveVoice`), `VoiceSelectionModal.tsx` | Session selection updates `lastUsedAt`; "Gần đây" bubbles voice to top | Compliant |
| **R-20** | Sorting must use a single dropdown (`Sắp xếp: [Dùng nhiều ▼]`) | **PASS** | `VoiceSelectionModal.tsx` | Single `<select>` dropdown with clean label | Compliant |
| **R-21** | Priority toolbar layout without consecutive dropdown congestion | **PASS** | `VoiceSelectionModal.tsx` | Layout: `[Tìm kiếm]` \| `[Ngôn ngữ: Tất cả ▼]` \| `[Vùng / Accent: Tất cả ▼]` \| `[Bộ lọc]` \| `[Sắp xếp: Dùng nhiều ▼]` | Compliant |
| **R-22** | Gender filter in clean segmented control inside "Bộ lọc" drawer | **PASS** | `VoiceSelectionModal.tsx` | Clean segmented pill control inside drawer | Compliant |
| **R-23** | "Bộ lọc" button opens collapsible drawer with Gender, Style, Model, Reset | **PASS** | `VoiceSelectionModal.tsx` | Collapsible drawer toggled by button; shows active badge counter | Compliant |
| **R-24** | Progressive disclosure: default state clean and minimal | **PASS** | `VoiceSelectionModal.tsx` (`isFilterPanelOpen = false`) | Advanced filters collapsed by default; revealed on demand | Compliant |
| **R-25** | Removable active filter chips for non-default values | **PASS** | `VoiceSelectionModal.tsx` | Chips render with `[Label ×]` for active non-default filters | Compliant |
| **R-26** | Click `×` to remove an individual active filter | **PASS** | `VoiceSelectionModal.tsx` | Verified clicking `×` removes only that filter with dedicated tooltip | Compliant |
| **R-27** | Do NOT display chips for default values ("Tất cả") | **PASS** | `VoiceSelectionModal.tsx` | Only pushes chip when value !== "all" | Compliant |
| **R-28** | Dedicated "Đặt lại" button restores all filters to default | **PASS** | `VoiceSelectionModal.tsx` | Verified clicking "Đặt lại" restores all filters and clears search | Compliant |
| **R-29** | Filter persistence across popup close/reopen in session | **PASS** | `VoiceSelectionModal.tsx` local state in persistent component mount | Runtime verified: applied filter persists upon reopen with chips visible | Compliant |
| **R-30** | Minimalist voice card: max 2–3 key metadata items | **PASS** | `VoiceSelectionModal.tsx` (`metaString = [vGender, vAccent, vStyle].filter(Boolean).join(" · ")`) | Displays e.g. `Nữ · Miền Bắc · Tự nhiên` without empty dots | Compliant |
| **R-31** | Do not clutter card with multiple simultaneous badges | **PASS** | `VoiceSelectionModal.tsx` | Only optional `Nhân bản` or `Online` tiny badge | Compliant |
| **R-32** | Tag priority: Gender, Accent/Region, Style; omit Language/Model | **PASS** | `VoiceSelectionModal.tsx` | Exactly `[vGender, vAccent, vStyle]` formatted with dots | Compliant |
| **R-33** | Play button ONLY previews sample audio; must NOT select voice | **PASS** | `VoiceSelectionModal.tsx` (`e.stopPropagation()`) | Verified play toggles playback animation; does not alter active voice | Compliant |
| **R-34** | Clicking card selects voice and closes popup immediately (1-click) | **PASS** | `VoiceSelectionModal.tsx` (`onSelectVoice(voice); onClose();`) | 1-click select verified; TTS Inspector updates immediately | Compliant |
| **R-35** | Currently used voice clearly marked with `✓ Đang dùng` and subtle border | **PASS** | `VoiceSelectionModal.tsx` | Highlight ring + accent background + `✓ Đang dùng` badge | Compliant |
| **R-36** | Favorite heart icon strictly independent (`e.stopPropagation()`) | **PASS** | `VoiceSelectionModal.tsx` | Toggling favorite does not select voice or close modal | Compliant |
| **R-37** | Long voice names truncate cleanly with tooltip / title | **PASS** | `VoiceSelectionModal.tsx` (`truncate`, `title={voice.name}`) | Verified text-overflow: ellipsis and full title attribute present | Compliant |
| **R-38** | Desktop targeted dimensions: Width ~900–1050px, Height ~600–720px | **PASS** | `VoiceSelectionModal.tsx` (`max-w-[960px] h-[660px] max-h-[88vh]`) | Bounding rect measured 960px x 660px on desktop | Compliant |
| **R-39** | Voice list scrolls internally; header, tab bar, and toolbar remain fixed | **PASS** | `VoiceSelectionModal.tsx` (`overflow-y-auto`) | Verified scrollHeight (536px) > clientHeight (456px); fixed header/toolbar | Compliant |
| **R-40** | Responsive grid flows naturally without excessive stretch | **PASS** | `VoiceSelectionModal.tsx` (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`) | Responsive card grid verified at 1440x900 and 1024x700 | Compliant |
| **R-41** | Remove heavy bottom footer; result count placed subtly in header | **PASS** | `VoiceSelectionModal.tsx` | No bottom footer; count displayed in header ("10 giọng có sẵn") | Compliant |
| **R-42** | Modal dismissal supported via X button, Escape key, and backdrop click | **PASS** | `VoiceSelectionModal.tsx` | All 3 methods verified in DevTools runtime | Compliant |
| **R-43** | All active criteria evaluated with logical AND; search works with filters | **PASS** | `VoiceSelectionModal.tsx` | Combining Gender + Style + Search narrows list accurately | Compliant |
| **R-44** | No fake or speculative metadata / taxonomy | **PASS** | `VoiceSelectionModal.tsx` | Heuristic regex parser removed; typed attributes used directly | Compliant |
| **R-45** | No regression of existing capabilities | **PASS** | `App.tsx`, `TtsInspector.tsx`, `VoiceLibraryWorkspace.tsx` | Smoke tested Voice Clone, Voice Library, and TTS navigation | Compliant |
| **R-46** | Schema migration & backward compatibility for voice schema additions | **DEFERRED / N/A** | Frontend TypeScript compatibility is PASS; Production DB migration deferred | Backend persistence deferred to subsequent phase | N/A (Prototype) |
| **R-47** | Clear keyboard focus indicators on all interactive controls | **PASS** | `VoiceSelectionModal.tsx` (`role="button" tabIndex={0} focus-visible:ring-2 focus-visible:ring-accent`) | Card, Play, Favorite, Search, and Filters all receive focus rings | Compliant |
| **R-48** | Tooltips for icon-only buttons | **PASS** | `VoiceSelectionModal.tsx` | All icon buttons have title attributes | Compliant |
| **R-49** | Clearly distinguishable hover / focus / selected / current states | **PASS** | `VoiceSelectionModal.tsx` | Hover, focus-visible, and selected/current states distinct and validated | Compliant |
| **R-50** | Modal focus context & containment upon modal open/close | **PASS** | `VoiceSelectionModal.tsx` | Focus enters Search input, Tab/Shift-Tab trapped, Escape restores trigger focus | Compliant |
| **R-51** | Persisted / current active voice integrity across workspace switches | **PASS** | Runtime tested switching from Library -> TTS -> Voice Picker | Current active voice remains intact | Compliant |
| **R-52** | Zero horizontal overflow on viewport or modal containers | **PASS** | Runtime measured `scrollWidth === clientWidth` on body and modal | Zero horizontal overflow | Compliant |

---

## IV. DETAILED COMPLIANCE MATRIX: ACCEPTANCE CRITERIA (AC-01 to AC-24)

| ID | Acceptance Criteria | Status | Code Evidence | Runtime Evidence | Notes |
| :--- | :--- | :---: | :--- | :--- | :--- |
| **AC-01** | Popup opens from “Đổi giọng” in TTS Inspector | **PASS** | `TtsInspector.tsx`, `App.tsx` | Clicking voice card in TTS Inspector opens modal | Verified |
| **AC-02** | User can switch voice directly without navigating to Voice Library | **PASS** | `VoiceSelectionModal.tsx` | Switching Jenny Neural applied directly in Chunk Studio | Verified |
| **AC-03** | Real-time text search works | **PASS** | `VoiceSelectionModal.tsx` (`normalizeVietnamese`) | Real-time accented and unaccented search works | Verified |
| **AC-04** | Filter by Language works | **PASS** | `VoiceSelectionModal.tsx` | Selecting "English" filters list to Sarah, David, Jenny Neural | Verified |
| **AC-05** | Filter by Gender works | **PASS** | `VoiceSelectionModal.tsx` | Selecting "Nam" yields 5 male voices; "Nữ" yields 5 female voices | Verified |
| **AC-06** | Filter by Region / Accent works | **PASS** | `VoiceSelectionModal.tsx` | Selecting "Miền Bắc" yields Thảo Trinh, Mai Phương, Linh Chi | Verified |
| **AC-07** | Filter by Style works | **PASS** | `VoiceSelectionModal.tsx` | Selecting "Podcast" yields Nam Anh, Bảo Long | Verified |
| **AC-08** | Filters combine with each other (logical AND) | **PASS** | `VoiceSelectionModal.tsx` | Nam + Podcast filters to Nam Anh and Bảo Long | Verified |
| **AC-09** | Search works simultaneously with active filters | **PASS** | `VoiceSelectionModal.tsx` | Filter Nam + Search "Đà Nẵng" isolates Bảo Long | Verified |
| **AC-10** | Sorting works (Dùng nhiều, Mới nhất, A–Z, Gần đây) | **PASS** | `App.tsx`, `VoiceSelectionModal.tsx` | Popular, Newest, A-Z, Recent sort properly; recent updates on use | Verified |
| **AC-11** | Active filters are clearly visible (chips & badges) | **PASS** | `VoiceSelectionModal.tsx` | Active badge counter + removable chips row | Verified |
| **AC-12** | Can reset all filters to default with one action | **PASS** | `VoiceSelectionModal.tsx` | "Đặt lại" resets all 5 criteria + search input | Verified |
| **AC-13** | Voice card does not show excessive badges (max 2–3 key metadata) | **PASS** | `VoiceSelectionModal.tsx` | Clean single line `Nữ · Miền Bắc · Tự nhiên` without trailing dots | Verified |
| **AC-14** | Play preview does not alter the selected active voice | **PASS** | `VoiceSelectionModal.tsx` (`e.stopPropagation()`) | Active voice remains unchanged during preview | Verified |
| **AC-15** | Favorite toggle does not alter the selected active voice | **PASS** | `VoiceSelectionModal.tsx` (`e.stopPropagation()`) | Active voice remains unchanged during favorite toggle | Verified |
| **AC-16** | Clicking card selects voice and applies to TTS | **PASS** | `VoiceSelectionModal.tsx`, `App.tsx` | Card selected, modal closes, Inspector updates | Verified |
| **AC-17** | Currently active voice is clearly marked (`✓ Đang dùng`) | **PASS** | `VoiceSelectionModal.tsx` | Highlight ring + accent background + `✓ Đang dùng` | Verified |
| **AC-18** | No need to visit Voice Library to select or switch voices | **PASS** | Direct workflow end-to-end within TTS Studio | User switches voices inside TTS without leaving workflow | Verified |
| **AC-19** | Voice Library remains the dedicated full-screen management area | **PASS** | `VoiceLibraryWorkspace.tsx` intact | Full management available in Voice Library | Verified |
| **AC-20** | Popup no longer feels like a full-page library replica | **PASS** | 960x660 modal with focused selection UI | Light, fast, selection-focused experience | Verified |
| **AC-21** | Long list of voices scrolls internally without breaking layout | **PASS** | `VoiceSelectionModal.tsx` (`overflow-y-auto`) | ScrollHeight > clientHeight; no layout breakage | Verified |
| **AC-22** | Filters do not create hidden empty states without clear indication | **PASS** | `VoiceSelectionModal.tsx` | Empty state illustration, explanation, and Reset button | Verified |
| **AC-23** | No fake metadata or unsupported taxonomy added | **PASS** | `VoiceSelectionModal.tsx` | Speculative inference parser eliminated; schema-based metadata only | Verified |
| **AC-24** | Zero regressions in preview, favorite, selection, my voices, system, clone | **PASS** | Regression smoke tests across all workspaces | All pre-existing capabilities fully operational | Verified |
