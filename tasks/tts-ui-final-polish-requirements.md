# VOXLAB — TTS WORKSPACE FINAL UI POLISH PASS: REQUIREMENTS & TRACEABILITY

**Document Version**: 1.0.0  
**Audit Date**: 2026-09-07  
**Scope**: Final UI/UX Polish Pass for Text to Speech Main Workspace (Tạo giọng)  
**Status**: APPROVED & TRACEABLE (100% Coverage)  

---

## 1. SOURCE OF TRUTH DIRECTIVES & REQUIREMENT IDENTIFIERS (POLISH-R-001 to POLISH-R-047)

### Section 0 & 2: Scope & General Visual Principles
- **POLISH-R-001**: Task scope is strictly TTS Workspace Final UI Polish pass; preserve overall architecture, dark theme, and no loss of existing capabilities.
- **POLISH-R-002**: Global Status Principle: Normal state is SILENT. Do not re-introduce Ready, Default, Matched, Auto, Saved, GPU Ready or other normal state badges/indicators.
- **POLISH-R-003**: General visual refinement: cleaner, lighter, fewer nested outlines and containers; content text is the central focus.

### Section 3: Sentence Card — Giảm Chiều Cao (Height & Padding Reduction)
- **POLISH-R-004**: Reduce sentence card vertical height and padding by approximately 15–25% compared to current UI while maintaining high legibility and easy click targets.
- **POLISH-R-005**: Reduce vertical gap/margin between card header and text content.
- **POLISH-R-006**: Eliminate excess internal whitespace and unnecessary minimum card height so that all 7 cards appear noticeably more compact.

### Section 4: Bỏ "Form trong Form" ở Nội Dung Câu (Inner Container Removal)
- **POLISH-R-007**: Eliminate or drastically minimize the inner text container/input rectangle so cards follow clean hierarchy: Card -> Header -> Plain text content.
- **POLISH-R-008**: Render sentence text as primary reading content rather than a heavy form input field; if interactive, use subtle borders/backgrounds with no nested box appearance.

### Section 5: Pause Label Chỉ Hiện Khi Override
- **POLISH-R-009**: Punctuation / pause label ("Nghỉ: {ms}ms") must strictly NOT display if the pause value is default or "auto".
- **POLISH-R-010**: Pause label displays only when the sentence has an explicit custom per-sentence override (e.g. "Nghỉ: 800ms").

### Section 6: Selected Card — Giảm Độ Nổi
- **POLISH-R-011**: Reduce visual prominence of selected card: eliminate heavy bright cyan border/glow surrounding the entire card.
- **POLISH-R-012**: Selected state must use subtle indicators (subtler accent border, very light background tint, or thin ring) while remaining clearly distinguishable from normal, modified, error, and generating states.

### Section 7: Modified Card — Giảm Outline Thừa
- **POLISH-R-013**: Reduce excessive orange outlines/borders around modified card content; use badge ("Đã sửa") and action button ("Tạo lại") as primary signals.
- **POLISH-R-014**: Layout hierarchy for modified card follows clean concise format: "04 · Đã sửa · 5.1s" and action button "[Tạo lại]".

### Section 8: Error Card — Rút Gọn Message
- **POLISH-R-015**: Shorten error message text on failed cards to concise diagnostic text (e.g. "Worker Timeout" or "Hết thời gian chờ").
- **POLISH-R-016**: Strictly eliminate redundant "Vui lòng thử lại" from the error text since the "[Thử lại]" button is already present.

### Section 9: Card Action Wording
- **POLISH-R-017**: Keep card action wording short and consistent: "Nghe thử" (or "Nghe"), "Tạo lại", "Thử lại".
- **POLISH-R-018**: Strictly do not use verbose button wording like "Tạo lại câu này".

### Section 10: Card Header Hierarchy
- **POLISH-R-019**: Sentence card header must be compact with clear hierarchy: Sentence number -> Duration -> Abnormal status (if any) -> Action buttons (e.g. "02 · 9.6s" ... "[Nghe thử] [Tạo lại]").
- **POLISH-R-020**: Only display abnormal status badges in card header: "Đang tạo...", "Đã sửa", "Lỗi". Do not display normal status badges.

### Section 11: Inspector Header Wording
- **POLISH-R-021**: Shorten Inspector header title from "TÙY CHỈNH GIỌNG & THAM SỐ" to simpler, non-technical wording: "GIỌNG & CÀI ĐẶT" (or "CÀI ĐẶT GIỌNG").
- **POLISH-R-022**: Remove unnecessary technical jargon like "tham số" from the main header.

### Section 12: Inspector Scope Tabs
- **POLISH-R-023**: Shorten Inspector scope tabs from "Cài đặt chung" / "Câu #1" to concise tabs: "Toàn bộ" and "Câu #1" (or equivalent concise terminology).
- **POLISH-R-024**: Ensure scope tabs clearly communicate whether adjustments apply globally or to a specific sentence without verbose explanation text.

### Section 13: Bỏ Count Giọng Không Cần Thiết
- **POLISH-R-025**: Remove voice count ("13 giọng sẵn có" or similar) completely from Inspector header/voice card.
- **POLISH-R-026**: Inspector Voice section should cleanly present voice name, compact metadata, and "Đổi giọng" CTA without redundant library count.

### Section 14: Model — Giảm Visual Weight
- **POLISH-R-027**: Reduce visual weight, spacing, and header prominence of Model section so it does not compete with Voice.
- **POLISH-R-028**: Preserve Model selection capability and all options ("Omni Voice", "Chatterbox Turbo", "Qwen 1.7B") intact.

### Section 15: Rút Label "Tốc Độ Đọc"
- **POLISH-R-029**: Shorten speed slider label from "Tốc độ đọc" to "Tốc độ".
- **POLISH-R-030**: Maintain current value display format (e.g. "1.00×") and do not bring back milestone tick markers (0.5x, 1.0x, 2.0x).

### Section 16: Rút "Sắc Thái Biểu Cảm"
- **POLISH-R-031**: Shorten emotion section label from "SẮC THÁI BIỂU CẢM" to "SẮC THÁI".
- **POLISH-R-032**: Shorten default emotion dropdown option from "Tự nhiên (Mặc định)" to "Tự nhiên", eliminating redundant "Mặc định" text.

### Section 17: Ngắt Nghỉ / Nâng Cao
- **POLISH-R-033**: Keep both "Ngắt nghỉ >" and "Nâng cao >" collapsed by default.
- **POLISH-R-034**: When expanded, content must be clear, collapsible again, and not cause awkward inspector overflow or layout distortion.

### Section 18: CTA Hierarchy
- **POLISH-R-035**: Establish clear visual hierarchy for Action Toolbar CTAs: PRIMARY: "Tạo audio", CONTEXTUAL: "Tạo lại {n} câu", SECONDARY: "Xuất audio".
- **POLISH-R-036**: "Xuất audio" must look distinctly secondary so it does not compete visually with primary "Tạo audio".

### Section 19: Action Availability Khi Generating
- **POLISH-R-037**: When generation is actively running, disable or visually indicate unavailable state on conflicting actions (e.g. "Tạo audio" should not appear available while a job is running).
- **POLISH-R-038**: "Xuất audio" must only be enabled when current output is valid (disabled or warning state when invalid chunks exist or generation is in progress).
- **POLISH-R-039**: "Tạo lại" actions must respect queue/generation state without conflicting duplicate requests.

### Section 20: Top Status Summary
- **POLISH-R-040**: Top sentence list status summary strictly shows exception/actionable status only (e.g. "1 lỗi", "1 cần tạo lại").
- **POLISH-R-041**: Do not restore Ready count, Generated count, Default count, or Matched count.

### Section 21: Bottom Progress Bar
- **POLISH-R-042**: Keep bottom bar compact with single-line progress indicator (progress, 5/7, 71%, còn ~10s, [Tạm dừng], [Hủy]).
- **POLISH-R-043**: Do not reintroduce elapsed time, engine ready, GPU ready, duplicate percentage, or duplicate progress labels; polish spacing and alignment.

### Section 22 & 23: White Space & Không Đụng Phần Đã Ổn
- **POLISH-R-044**: Accept intentional white space below list for 7 sentences without artificially stretching cards or adding bogus filler.
- **POLISH-R-045**: Preserve already-approved areas without redesign: Sidebar, "Soạn thảo / Tạo giọng" tabs, Voice Picker modal, bottom bar structure, dark theme language, navigation.

### Section 24, 25, 26, 31: Visual Impact, Evidence & Zero Regression
- **POLISH-R-046**: Visual changes must be meaningful and clearly observable in before/after comparisons (compactness, cleaner typography, reduced containers).
- **POLISH-R-047**: Zero functional regression across Voice Picker, Voice Library, Voice Clone, active voice persistence, audio playback preview, retry, export, cancel, pause, and responsive layout (1920x1080, 1440x900, 1024x700).

---

## 2. ACCEPTANCE CRITERIA (POLISH-AC-001 to POLISH-AC-022)

- **POLISH-AC-001**: Sentence card vertical padding is reduced by 15–25% (e.g. from `p-3.5 space-y-2.5` to `p-2.5 space-y-1.5`), rendering 7 cards visibly more compact.
- **POLISH-AC-002**: Inner text container removes nested box styling; text is presented directly as primary content.
- **POLISH-AC-003**: Pause label strictly displays only when `pauseAfterMs` is customized (e.g. "Nghỉ: 600ms"), and is absent when "auto".
- **POLISH-AC-004**: Selected card uses a restrained accent border/subtle tint without harsh bright cyan glow ring.
- **POLISH-AC-005**: Modified card reduces heavy orange border/background; status is conveyed primarily via badge and "Tạo lại" CTA.
- **POLISH-AC-006**: Error card displays concise error text ("Worker Timeout" or "Hết thời gian chờ") without redundant "Vui lòng thử lại".
- **POLISH-AC-007**: Card action buttons use concise wording: "Nghe thử", "Tạo lại", "Thử lại".
- **POLISH-AC-008**: Card header layout follows: Sentence Number -> Duration -> Status Badge -> Action Buttons.
- **POLISH-AC-009**: Inspector header reads "GIỌNG & CÀI ĐẶT" without "tham số".
- **POLISH-AC-010**: Inspector scope tabs read "Toàn bộ" and "Câu #1".
- **POLISH-AC-011**: Inspector Voice section displays no library voice count.
- **POLISH-AC-012**: Model dropdown section has reduced vertical padding and subtle header weight.
- **POLISH-AC-013**: Speed slider label reads "Tốc độ" and displays numeric value (e.g. `1.00×`).
- **POLISH-AC-014**: Emotion section header reads "SẮC THÁI" and default option reads "Tự nhiên" (no "(Mặc định)").
- **POLISH-AC-015**: "Ngắt nghỉ >" and "Nâng cao >" remain collapsed by default and open/close on demand smoothly.
- **POLISH-AC-016**: Toolbar CTA visual hierarchy: "Tạo audio" is Primary (accent filled), "Tạo lại {n} câu" is Contextual (amber pill), "Xuất audio" is Secondary (subtle outlined/ghost style).
- **POLISH-AC-017**: When job is running, "Tạo audio" reflects generating state (disabled / pulsing spinner); "Xuất audio" indicates availability based on invalid chunks or active job.
- **POLISH-AC-018**: Top list status summary displays only actionable exceptions ("1 lỗi", "1 cần tạo lại").
- **POLISH-AC-019**: Bottom progress bar displays unified single-line progress without duplicate labels or GPU status.
- **POLISH-AC-020**: Clicking "Đổi giọng" opens Voice Picker popup modal seamlessly.
- **POLISH-AC-021**: Minimum desktop resolution 1024x700 has no horizontal overflow (`docScrollWidth === docClientWidth`).
- **POLISH-AC-022**: `npx tsc --noEmit` and `npm run build` compile with 0 errors.

---

## 3. TRACEABILITY MATRIX (100% COVERAGE)

| Source Directive Section | Requirement Summary | Mapped Requirement ID | Mapped Acceptance Criteria | Coverage Status |
|---|---|:---:|:---:|:---:|
| Section 0: Phạm vi & Nguyên tắc | Scope is TTS Polish, no architecture/feature changes | POLISH-R-001 | POLISH-AC-022 | **FULL** |
| Section 2: Mục tiêu Visual | Normal state is SILENT | POLISH-R-002 | POLISH-AC-003, AC-018 | **FULL** |
| Section 2: Mục tiêu Visual | Cleaner, lighter, fewer container-in-container | POLISH-R-003 | POLISH-AC-001, AC-002 | **FULL** |
| Section 3: Sentence Card Chiều Cao | Reduce card height/padding by 15–25% | POLISH-R-004 | POLISH-AC-001 | **FULL** |
| Section 3: Sentence Card Chiều Cao | Reduce header to text distance | POLISH-R-005 | POLISH-AC-001 | **FULL** |
| Section 3: Sentence Card Chiều Cao | Eliminate unnecessary whitespace/min-height | POLISH-R-006 | POLISH-AC-001 | **FULL** |
| Section 4: Bỏ Form trong Form | Eliminate inner input-like box for sentence text | POLISH-R-007 | POLISH-AC-002 | **FULL** |
| Section 4: Bỏ Form trong Form | Text as primary reading content | POLISH-R-008 | POLISH-AC-002 | **FULL** |
| Section 5: Pause Label | Hide default/auto pauses | POLISH-R-009 | POLISH-AC-003 | **FULL** |
| Section 5: Pause Label | Show pause label only when custom overridden | POLISH-R-010 | POLISH-AC-003 | **FULL** |
| Section 6: Selected Card | Reduce visual prominence/cyan glow of selected card | POLISH-R-011 | POLISH-AC-004 | **FULL** |
| Section 6: Selected Card | Subtle indicator distinguishable from other states | POLISH-R-012 | POLISH-AC-004 | **FULL** |
| Section 7: Modified Card | Reduce orange outlines around modified content | POLISH-R-013 | POLISH-AC-005 | **FULL** |
| Section 7: Modified Card | Clean format: 04 · Đã sửa · 5.1s [Tạo lại] | POLISH-R-014 | POLISH-AC-005 | **FULL** |
| Section 8: Error Card | Shorten error message text | POLISH-R-015 | POLISH-AC-006 | **FULL** |
| Section 8: Error Card | Remove redundant "Vui lòng thử lại" from text | POLISH-R-016 | POLISH-AC-006 | **FULL** |
| Section 9: Card Action Wording | Concise action wording (Nghe thử, Tạo lại, Thử lại) | POLISH-R-017 | POLISH-AC-007 | **FULL** |
| Section 9: Card Action Wording | No verbose wording like "Tạo lại câu này" | POLISH-R-018 | POLISH-AC-007 | **FULL** |
| Section 10: Card Header Hierarchy | Sentence number -> Duration -> Status -> Actions | POLISH-R-019 | POLISH-AC-008 | **FULL** |
| Section 10: Card Header Hierarchy | Abnormal status badges only | POLISH-R-020 | POLISH-AC-008 | **FULL** |
| Section 11: Inspector Header | Shorten header to "GIỌNG & CÀI ĐẶT" | POLISH-R-021 | POLISH-AC-009 | **FULL** |
| Section 11: Inspector Header | Remove "tham số" technical jargon | POLISH-R-022 | POLISH-AC-009 | **FULL** |
| Section 12: Scope Tabs | Shorten tabs to "Toàn bộ" and "Câu #1" | POLISH-R-023 | POLISH-AC-010 | **FULL** |
| Section 12: Scope Tabs | Clear global vs chunk scope without long text | POLISH-R-024 | POLISH-AC-010 | **FULL** |
| Section 13: Bỏ Count Giọng | Remove "13 giọng sẵn có" count | POLISH-R-025 | POLISH-AC-011 | **FULL** |
| Section 13: Bỏ Count Giọng | Clean voice presentation with "Đổi giọng" | POLISH-R-026 | POLISH-AC-011 | **FULL** |
| Section 14: Model | Reduce visual weight and spacing of Model section | POLISH-R-027 | POLISH-AC-012 | **FULL** |
| Section 14: Model | Preserve Model selection capability intact | POLISH-R-028 | POLISH-AC-012 | **FULL** |
| Section 15: Tốc Độ Đọc | Rename label to "Tốc độ" | POLISH-R-029 | POLISH-AC-013 | **FULL** |
| Section 15: Tốc Độ Đọc | Keep 1.00× value, no tick clutter | POLISH-R-030 | POLISH-AC-013 | **FULL** |
| Section 16: Sắc Thái | Rename label to "SẮC THÁI" | POLISH-R-031 | POLISH-AC-014 | **FULL** |
| Section 16: Sắc Thái | Rename option to "Tự nhiên" (remove "(Mặc định)") | POLISH-R-032 | POLISH-AC-014 | **FULL** |
| Section 17: Ngắt Nghỉ / Nâng Cao | Keep collapsed by default | POLISH-R-033 | POLISH-AC-015 | **FULL** |
| Section 17: Ngắt Nghỉ / Nâng Cao | Clean on-demand opening without overflow | POLISH-R-034 | POLISH-AC-015 | **FULL** |
| Section 18: CTA Hierarchy | Primary: Tạo audio; Contextual: Tạo lại; Secondary: Xuất audio | POLISH-R-035 | POLISH-AC-016 | **FULL** |
| Section 18: CTA Hierarchy | Xuất audio does not visually overpower Tạo audio | POLISH-R-036 | POLISH-AC-016 | **FULL** |
| Section 19: Action Availability | Disable/state-reflect conflicting actions during job | POLISH-R-037 | POLISH-AC-017 | **FULL** |
| Section 19: Action Availability | Enable Xuất audio only when valid | POLISH-R-038 | POLISH-AC-017 | **FULL** |
| Section 19: Action Availability | Tạo lại respects queue/state | POLISH-R-039 | POLISH-AC-017 | **FULL** |
| Section 20: Top Status Summary | Exception status only (1 lỗi, 1 cần tạo lại) | POLISH-R-040 | POLISH-AC-018 | **FULL** |
| Section 20: Top Status Summary | No restoration of ready/normal counts | POLISH-R-041 | POLISH-AC-018 | **FULL** |
| Section 21: Bottom Progress Bar | Compact single-line progress indicator | POLISH-R-042 | POLISH-AC-019 | **FULL** |
| Section 21: Bottom Progress Bar | No duplicate labels or GPU ready | POLISH-R-043 | POLISH-AC-019 | **FULL** |
| Section 22: White Space | Accept intentional whitespace below list | POLISH-R-044 | POLISH-AC-001 | **FULL** |
| Section 23: Không Đụng Phần Đã Ổn | Sidebar, tabs, Voice Picker, bottom bar preserved | POLISH-R-045 | POLISH-AC-020 | **FULL** |
| Section 24 & 25: Visual Impact | Meaningful observable before/after changes | POLISH-R-046 | POLISH-AC-001 to AC-019 | **FULL** |
| Section 31: Zero Regression | All existing capabilities preserved | POLISH-R-047 | POLISH-AC-020 to AC-022 | **FULL** |

**Traceability Score**: **47 / 47 requirements mapped (100.0%)**
