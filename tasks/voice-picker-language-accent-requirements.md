# VOXLAB — VOICE PICKER CARD + LANGUAGE/ACCENT TAXONOMY + FULL I18N PASS
## Requirements & Acceptance Criteria Specification

**Document Version:** 1.0.0  
**Scope:** Voice Picker (`VoiceSelectionModal.tsx`), Voice Card, Language/Accent Taxonomy (`voiceFilters.ts`), Translations (`translations.ts`), Mock Data (`data.ts`).  
**Traceability Target:** 100% Coverage across 46 prompt sections.

---

### Requirement Matrix

| Requirement ID | Acceptance Criteria ID | Section | Category | Description | Priority |
|---|---|---|---|---|---|
| **VA-R-001** | VA-AC-001 | 1 | Foundation | Create requirements spec & traceability matrix before modifying code. | MUST |
| **VA-R-002** | VA-AC-002 | 2 | Voice Card | Completely remove usage count text (e.g. 14.1M lượt dùng) from voice cards. Keep data field for sorting. | MUST |
| **VA-R-003** | VA-AC-003 | 3 | Voice Card | Remove Play/Pause overlay button from voice avatar. Avatar only serves identification. | MUST |
| **VA-R-004** | VA-AC-004 | 4 | Voice Card | Add dedicated Preview button ("Nghe thử" / "Dừng" in VI; "Preview" / "Stop" in EN) with large hit target replacing usage count. | MUST |
| **VA-R-005** | VA-AC-005 | 5 | Voice Card | Minimal voice card layout with max ~3 metadata items (Gender · Accent · Style) and Preview button + Used state indicator. | MUST |
| **VA-R-006** | VA-AC-006 | 6 | I18N | Absolute I18N: All user-facing text in Voice Picker must match UI locale. Never render canonical IDs directly. | MUST |
| **VA-R-007** | VA-AC-007 | 7 | I18N | No mixed-language UI: VI locale must have 100% Vietnamese labels; EN locale must have 100% English labels. | MUST |
| **VA-R-008** | VA-AC-008 | 8 | Architecture | Internal state must strictly use canonical IDs (e.g., `en`, `en-us`, `vi`, `vi-north`), never translated strings. | MUST |
| **VA-R-009** | VA-AC-009 | 9 | Taxonomy | Prepare central registry for 7 core language groups: `vi`, `en`, `es`, `pt`, `fr`, `de`, `ar`. | MUST |
| **VA-R-010** | VA-AC-010 | 10 | Taxonomy | Vietnamese accents: `vi-north` (Miền Bắc / Northern Vietnamese), `vi-central` (Miền Trung / Central Vietnamese), `vi-south` (Miền Nam / Southern Vietnamese). | MUST |
| **VA-R-011** | VA-AC-011 | 11 | Taxonomy | English accents: `en-us` (Mỹ / US), `en-gb` (Anh / UK), `en-au` (Úc / Australian), `en-ca` (Canada / Canadian), `en-in` (Ấn Độ / Indian). No "Anh Mỹ"/"Anh Anh". | MUST |
| **VA-R-012** | VA-AC-012 | 12 | Taxonomy | Spanish accents: `es-es` (Tây Ban Nha / Spain), `es-mx` (Mexico / Mexican), `es-ar` (Argentina / Argentinian), `es-co` (Colombia / Colombian). | MUST |
| **VA-R-013** | VA-AC-013 | 13 | Taxonomy | Portuguese accents: `pt-br` (Brazil / Brazilian), `pt-pt` (Bồ Đào Nha / European Portuguese). | MUST |
| **VA-R-014** | VA-AC-014 | 14 | Taxonomy | French accents: `fr-fr` (Pháp / France), `fr-ca` (Canada / Canadian French), `fr-be` (Bỉ / Belgian French), `fr-ch` (Thụy Sĩ / Swiss French). | MUST |
| **VA-R-015** | VA-AC-015 | 15 | Taxonomy | German accents: `de-de` (Đức / Germany), `de-at` (Áo / Austrian German), `de-ch` (Thụy Sĩ / Swiss German). | MUST |
| **VA-R-016** | VA-AC-016 | 16 | Taxonomy | Arabic accents: `ar-msa` (Ả Rập chuẩn / Modern Standard Arabic), `ar-egyptian` (Ai Cập / Egyptian), `ar-gulf` (Vùng Vịnh / Gulf), `ar-levantine` (Levant / Levantine), `ar-maghrebi` (Maghreb / Maghrebi). | MUST |
| **VA-R-017** | VA-AC-017 | 17 | Scope | Do not add Chinese, Japanese, Korean, Hindi, Italian, Russian to filter registry in this pass. | MUST |
| **VA-R-018** | VA-AC-018 | 18 | Dependency | Accent filter depends strictly on selected Language. No invalid states (e.g. English + Miền Bắc). | MUST |
| **VA-R-019** | VA-AC-019 | 19 | Dependency | When Language = All, Accent filter must be disabled with tooltip helper ("Chọn ngôn ngữ trước" / "Select a language first"). | MUST |
| **VA-R-020** | VA-AC-020 | 20 | Dependency | Changing Language resets Accent to "all"/null, but preserves valid sibling filters (Gender, Style, Age). | MUST |
| **VA-R-021** | VA-AC-021 | 21 | Taxonomy | Accent options displayed in UI must be meaningful and derived for the selected language. | MUST |
| **VA-R-022** | VA-AC-022 | 22 | Architecture | Use centralized config/registry for Language & Accent; no hardcoded taxonomy in JSX. | MUST |
| **VA-R-023** | VA-AC-023 | 23 | I18N | Active filter chips update immediately on UI locale switch without resetting filter state. Format without redundant prefix. | MUST |
| **VA-R-024** | VA-AC-024 | 24 | I18N | Card metadata uses canonical IDs mapped to translated labels (e.g., Nữ · Mỹ · Thuyết minh / Female · US · Narration). | MUST |
| **VA-R-025** | VA-AC-025 | 25 | Voice Card | Card metadata prioritization: Gender · Accent · Style (max ~3 primary items) to prevent visual clutter. | MUST |
| **VA-R-026** | VA-AC-026 | 26 | Taxonomy | Style taxonomy strictly preserved: all, natural, storytelling, conversational, narration, podcast, advertising. | MUST |
| **VA-R-027** | VA-AC-027 | 27 | UI | Style dropdown has no search input; shows all options directly. | MUST |
| **VA-R-028** | VA-AC-028 | 28 | UI | Language dropdown search filters against localized display labels (e.g. "tây ban nha" or "spanish"). | MUST |
| **VA-R-029** | VA-AC-029 | 29 | UI | Accent dropdown has no search input for short lists (2-5 options); displays directly. | MUST |
| **VA-R-030** | VA-AC-030 | 30 | Functional | "Dùng nhiều" (Popular) sorting remains fully functional using dataset `usageCount`. | MUST |
| **VA-R-031** | VA-AC-031 | 31 | Interaction | Clicking Favorite icon does not select voice, does not close modal, does not trigger preview. | MUST |
| **VA-R-032** | VA-AC-032 | 32 | Interaction | Preview button operates independently (Mouse & Keyboard Enter/Space); does not select voice or close modal. | MUST |
| **VA-R-033** | VA-AC-033 | 33 | Interaction | Clicking voice card body selects voice, closes modal, and updates TTS active voice. | MUST |
| **VA-R-034** | VA-AC-034 | 34 | UI / I18N | Empty state: Primary CTA = "Đặt lại bộ lọc" / "Reset filters", Secondary CTA = "Tạo giọng mới" / "Create new voice". Pure locale. | MUST |
| **VA-R-035** | VA-AC-035 | 35 | Functional | Reset filter button clears Language, Accent, Style, Gender, Age to "all" and restores voice list. | MUST |
| **VA-R-036** | VA-AC-036 | 36 | Verification | Runtime check of pure Vietnamese UI (no English leaks) and pure English UI (no Vietnamese leaks). | MUST |
| **VA-R-037** | VA-AC-037 | 37 | Verification | Switching UI locale while filters are active updates all labels and chips without resetting voice results. | MUST |
| **VA-R-038** | VA-AC-038 | 38 | Verification | 10 runtime dependency test cases verified via DevTools MCP. | MUST |
| **VA-R-039** | VA-AC-039 | 39 | Quality | No fake voice data added; verify registry structurally and UI gracefully handles 0-result states. | MUST |
| **VA-R-040** | VA-AC-040 | 40 | Responsive | Verify layout at 1920x1080, 1440x900, 1024x700 without horizontal overflow or chip wrapping bugs. | MUST |
| **VA-R-041** | VA-AC-041 | 41 | Quality | No regression in Voice Picker, tabs, search, favorites, preview, selection, sorting, or accessibility. | MUST |
| **VA-R-042** | VA-AC-042 | 42 | Compliance | Generate `tasks/voice-picker-language-accent-compliance.md` with code and runtime evidence. | MUST |
| **VA-R-043** | VA-AC-043 | 43 | Quality | Complete Visual Checklist covering Voice Card, I18N, and Dependency. | MUST |
| **VA-R-044** | VA-AC-044 | 44 | Build | `npx tsc --noEmit` and `npm run build` exit code 0. | MUST |
| **VA-R-045** | VA-AC-045 | 45 | Quality | Strict Done condition: Do not report READY if any check fails or is unverified. | MUST |
| **VA-R-046** | VA-AC-046 | 46 | Report | Deliver structured final report ending strictly with `READY` or `NOT READY`. | MUST |

---

### Detailed Acceptance Criteria

- **VA-AC-001**: Requirements document created and linked to prompt sections. Traceability coverage = 100%.
- **VA-AC-002**: Card contains zero occurrences of "lượt dùng" or "uses". `usageCount` retained in data for sorting.
- **VA-AC-003**: Avatar has no play/pause overlay button or child clickable elements.
- **VA-AC-004**: Card bottom row contains explicit `[▶ Nghe thử]` (VI) / `[▶ Preview]` (EN), toggling to `[■ Dừng]` (VI) / `[■ Stop]` (EN).
- **VA-AC-005**: Metadata line contains max 3 items: Gender · Accent · Style (e.g. `Nữ · Miền Bắc · Kể chuyện`).
- **VA-AC-006**: In VI locale, all labels, options, chips, tooltips, and empty states are in Vietnamese. In EN locale, in English. No raw canonical IDs (e.g. `en-us`, `vi-north`, `storytelling`) rendered.
- **VA-AC-007**: No cross-language leakage anywhere in the UI.
- **VA-AC-008**: Component state stores `selectedLanguage`, `selectedAccent`, `selectedStyle`, `selectedGender` as canonical strings.
- **VA-AC-009**: Centralized `LANGUAGE_OPTIONS` has exactly: `vi`, `en`, `es`, `pt`, `fr`, `de`, `ar` with labels for `vi`, `en`, `ja`, `zh`.
- **VA-AC-010**: Vietnamese accents define `vi-north`, `vi-central`, `vi-south` with exact translations.
- **VA-AC-011**: English accents define `en-us`, `en-gb`, `en-au`, `en-ca`, `en-in`. Canonical `en-gb` supported along with alias `en-uk`.
- **VA-AC-012**: Spanish accents define `es-es`, `es-mx`, `es-ar`, `es-co`.
- **VA-AC-013**: Portuguese accents define `pt-br`, `pt-pt`.
- **VA-AC-014**: French accents define `fr-fr`, `fr-ca`, `fr-be`, `fr-ch`.
- **VA-AC-015**: German accents define `de-de`, `de-at`, `de-ch`.
- **VA-AC-016**: Arabic accents define `ar-msa`, `ar-egyptian`, `ar-gulf`, `ar-levantine`, `ar-maghrebi`.
- **VA-AC-017**: Chinese, Japanese, Korean, Hindi, Italian, Russian omitted from language filter registry in this pass.
- **VA-AC-018**: Accent dropdown displays accents corresponding exclusively to the currently selected language.
- **VA-AC-019**: When `selectedLanguage === "all"`, Accent button is disabled with tooltip `selectLanguageFirst`.
- **VA-AC-020**: Selecting a new language resets `selectedAccent` to `"all"`, while preserving `selectedGender` and `selectedStyle`.
- **VA-AC-021**: Accent dropdown renders all defined accents for the selected language cleanly.
- **VA-AC-022**: `ACCENTS_BY_LANGUAGE` and `LANGUAGE_OPTIONS` exported from `voiceFilters.ts` and consumed by modal.
- **VA-AC-023**: Active filter chips render localized labels directly (e.g., `Tiếng Tây Ban Nha ×`, `Mexico ×`). Switching locale updates them immediately.
- **VA-AC-024**: Card metadata rendered via `getGenderLabel`, `getAccentLabel`, `getStyleLabel` using active locale `lang`.
- **VA-AC-025**: Card metadata displays at most 3 items: Gender, Accent, Style.
- **VA-AC-026**: Style filter retains exactly the 7 canonical options: `all`, `natural`, `storytelling`, `conversational`, `narration`, `podcast`, `advertising`.
- **VA-AC-027**: Style dropdown contains no search input.
- **VA-AC-028**: Language dropdown search filters against `getLanguageLabel(code, lang)`.
- **VA-AC-029**: Accent dropdown contains no search input.
- **VA-AC-030**: Sorting by "Dùng nhiều" / Popular orders voices by numeric value of `usageCount`.
- **VA-AC-031**: Clicking heart icon updates favorite state without selecting voice or closing modal.
- **VA-AC-032**: Clicking Preview button or pressing Enter/Space while focused on it toggles audio preview without selecting voice or closing modal.
- **VA-AC-033**: Clicking card body selects voice and closes modal.
- **VA-AC-034**: Empty state displays primary "Đặt lại bộ lọc" / "Reset filters" and secondary "Tạo giọng mới" / "Create new voice".
- **VA-AC-035**: Reset button restores all filters to "all" and re-displays all available voices.
- **VA-AC-036**: Runtime DevTools inspection confirms 0 English words in VI modal and 0 Vietnamese words in EN modal.
- **VA-AC-037**: Switching locale with active filters preserves voice list and updates chip and card metadata text.
- **VA-AC-038**: All 10 runtime dependency matrix cases pass in Chrome DevTools MCP.
- **VA-AC-039**: No fake mock voices added to dataset.
- **VA-AC-040**: Viewport checks at 1920x1080, 1440x900, 1024x700 show no horizontal scroll or layout clipping.
- **VA-AC-041**: All existing TTS modal capabilities (tabs, search, keyboard escape, focus trap) function without error.
- **VA-AC-042**: `tasks/voice-picker-language-accent-compliance.md` created with verified code and runtime evidence.
- **VA-AC-043**: Visual checklist completed and documented.
- **VA-AC-044**: Both `tsc --noEmit` and `npm run build` succeed with 0 errors.
- **VA-AC-045**: Strict Done evaluation confirms zero violations.
- **VA-AC-046**: Final report generated ending with `READY`.
