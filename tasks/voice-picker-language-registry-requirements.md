# VOXLAB — VOICE PICKER LANGUAGE REGISTRY + ACCENT AVAILABILITY + FILTER SEARCH REMOVAL
## Requirements & Acceptance Criteria Specification

**Document Version:** 1.0.0  
**Scope:** Voice Picker (`VoiceSelectionModal.tsx`), Filter Dropdowns, Language Registry (`voiceFilters.ts`), Accent Availability & Dependency Rules, Full I18N (`translations.ts`).  
**Traceability Target:** 100% Coverage across 42 prompt sections.

---

### Requirement Matrix

| Requirement ID | Acceptance Criteria ID | Section | Category | Description | Priority |
|---|---|---|---|---|---|
| **LANG-R-001** | LANG-AC-001 | 1 | Foundation | Create requirements spec and traceability matrix before code modifications. | MUST |
| **LANG-R-002** | LANG-AC-002 | 2 | UI / Search | Completely remove search input ("Tìm kiếm...") from all filter dropdowns (Language, Accent, Style, Gender, Age). | MUST |
| **LANG-R-003** | LANG-AC-003 | 2 | UI / Layout | Dropdowns must use direct list, reasonable max-height, vertical scroll, and leave no dead space from removed search. | MUST |
| **LANG-R-004** | LANG-AC-004 | 3 | Taxonomy | Centralize 32-language baseline registry (vi, en, ja, zh, de, hi, fr, ko, pt, it, es, id, nl, tr, fil, pl, sv, bg, ro, ar, cs, el, fi, hr, ms, sk, da, ta, uk, ru, hu, no) equivalent to ElevenLabs scale. | MUST |
| **LANG-R-005** | LANG-AC-005 | 4 | Architecture | Internal state must strictly use canonical IDs (e.g., `vi`, `en`, `es`, `en-us`), never translated strings. | MUST |
| **LANG-R-006** | LANG-AC-006 | 5 | I18N | Full I18N for all language and accent labels. Never render raw canonical IDs. Pure locale display. | MUST |
| **LANG-R-007** | LANG-AC-007 | 6 | Architecture | Separate registry definition from visible options policy (Policy B: model support & relevant dataset availability). | MUST |
| **LANG-R-008** | LANG-AC-008 | 7 | UX / Ordering | Order visible languages intentionally: Vietnamese, English, Chinese, Japanese, Korean, Spanish, French, German, Portuguese, Arabic. Centralized, not hardcoded in JSX. | MUST |
| **LANG-R-009** | LANG-AC-009 | 8 | Dependency | Accent filter strictly depends on selected Language. Language = All must disable Accent. | MUST |
| **LANG-R-010** | LANG-AC-010 | 9 | Availability | Accent is enabled ONLY if language is selected, has supported taxonomy, AND has at least 2 usable accents (`accentOptions.length >= 2`). | MUST |
| **LANG-R-011** | LANG-AC-011 | 9, 10 | Availability | If language has <= 1 usable accent, Accent control must be disabled. | MUST |
| **LANG-R-012** | LANG-AC-012 | 10 | UI / Accessibility | Disabled Accent button has reduced opacity, not clickable, no hover effects, clears previous accent, and shows tooltip helper. | MUST |
| **LANG-R-013** | LANG-AC-013 | 11 | Taxonomy | Vietnamese accent taxonomy: `vi-north`, `vi-central`, `vi-south` (Miền Bắc, Miền Trung, Miền Nam). | MUST |
| **LANG-R-014** | LANG-AC-014 | 12 | Taxonomy | English accent taxonomy: `en-us`, `en-gb`, `en-au`, `en-ca`, `en-in` (Mỹ, Anh, Úc, Canada, Ấn Độ; US, UK, Australian, Canadian, Indian). No "Anh Mỹ"/"Anh Anh". | MUST |
| **LANG-R-015** | LANG-AC-015 | 13 | Taxonomy | Spanish accent taxonomy: `es-es`, `es-mx`, `es-ar`, `es-co` (Tây Ban Nha, Mexico, Argentina, Colombia). | MUST |
| **LANG-R-016** | LANG-AC-016 | 14 | Taxonomy | Portuguese accent taxonomy: `pt-br`, `pt-pt` (Brazil, Bồ Đào Nha; Brazilian, European Portuguese). | MUST |
| **LANG-R-017** | LANG-AC-017 | 15 | Taxonomy | French accent taxonomy: `fr-fr`, `fr-ca`, `fr-be`, `fr-ch` (Pháp, Canada, Bỉ, Thụy Sĩ; France, Canadian French, Belgian French, Swiss French). | MUST |
| **LANG-R-018** | LANG-AC-018 | 16 | Taxonomy | German accent taxonomy: `de-de`, `de-at`, `de-ch` (Đức, Áo, Thụy Sĩ; Germany, Austrian German, Swiss German). | MUST |
| **LANG-R-019** | LANG-AC-019 | 17 | Taxonomy | Arabic accent taxonomy: `ar-msa`, `ar-egyptian`, `ar-gulf`, `ar-levantine`, `ar-maghrebi` (Ả Rập chuẩn, Ai Cập, Vùng Vịnh, Levant, Maghreb). | MUST |
| **LANG-R-020** | LANG-AC-020 | 18 | Availability | Unsupported accent languages (ja, zh, ko, it, hi, etc.) have Accent disabled with tooltip "Chưa có bộ lọc vùng cho ngôn ngữ này". | MUST |
| **LANG-R-021** | LANG-AC-021 | 19 | Architecture | Centralized config for language registry and accent registry by language in `voiceFilters.ts`. | MUST |
| **LANG-R-022** | LANG-AC-022 | 20 | Architecture | Data-aware accent visibility: clean derivation without fake metadata. | MUST |
| **LANG-R-023** | LANG-AC-023 | 21 | Dependency | Changing Language resets invalid Accent while preserving valid sibling filters (Gender, Style, Age). | MUST |
| **LANG-R-024** | LANG-AC-024 | 22 | Dependency | Resetting Language to "All" resets Accent to null/all, disables Accent, and clears active accent chip. | MUST |
| **LANG-R-025** | LANG-AC-025 | 23 | Search Removal | Verify complete removal of search input DOM elements and state from Language, Accent, Style, Gender, Age. | MUST |
| **LANG-R-026** | LANG-AC-026 | 24 | UI / Height | Language dropdown uses `max-h-60 overflow-y-auto`; short dropdowns remain compact without bloat. | MUST |
| **LANG-R-027** | LANG-AC-027 | 25 | Accessibility | Keyboard navigation (Tab, Enter/Space, Escape) remains intact with proper focus management. | MUST |
| **LANG-R-028** | LANG-AC-028 | 26 | I18N | Active filter chips render localized labels; switching UI locale updates chips without resetting filter state. | MUST |
| **LANG-R-029** | LANG-AC-029 | 27 | Voice Card | Card metadata prioritizes Gender · Accent · Style (max ~3 items). No visual clutter. | MUST |
| **LANG-R-030** | LANG-AC-030 | 28 | Metadata Integrity | No heuristic accent inference (e.g. city name to accent). Explicit canonical metadata only. | MUST |
| **LANG-R-031** | LANG-AC-031 | 29 | Metadata Integrity | Language matching uses canonical `supportedLanguages` metadata; supports multilingual voices. | MUST |
| **LANG-R-032** | LANG-AC-032 | 30 | Style Scope | Style taxonomy preserved: all, natural, storytelling, conversational, narration, podcast, advertising. No search, no characters. | MUST |
| **LANG-R-033** | LANG-AC-033 | 31 | Gender Scope | Gender taxonomy preserved: all, male, female. No search. | MUST |
| **LANG-R-034** | LANG-AC-034 | 32 | Age Scope | Age taxonomy preserved: all, young, middle_aged, senior. No search. | MUST |
| **LANG-R-035** | LANG-AC-035 | 33 | Functional | Reset All Filters resets language, accent, style, gender, age to null/all, disables Accent, and clears chips. | MUST |
| **LANG-R-036** | LANG-AC-036 | 34 | Verification | Pure VI UI has 0 English words; pure EN UI has 0 Vietnamese words in Voice Picker. | MUST |
| **LANG-R-037** | LANG-AC-037 | 35 | Verification | Verify 12 runtime cases (Case 1 to Case 12) via Chrome DevTools MCP. | MUST |
| **LANG-R-038** | LANG-AC-038 | 36 | Policy | Explicitly document Policy B (model capabilities + relevant dataset) for visible Language options. | MUST |
| **LANG-R-039** | LANG-AC-039 | 37 | Scope Boundary | No visual redesign of modal dimensions, tabs, card layout, preview button, or dark theme. | MUST |
| **LANG-R-040** | LANG-AC-040 | 38 | Responsive | Responsive verification across 1920x1080, 1440x900, 1024x700 without overflow. | MUST |
| **LANG-R-041** | LANG-AC-041 | 39 | Regression | No regression across existing TTS features, Voice Library, Voice Clone, or TTS Inspector. | MUST |
| **LANG-R-042** | LANG-AC-042 | 40-42 | Report & Compliance | Generate `tasks/voice-picker-language-registry-compliance.md` and deliver structured final report ending with READY/NOT READY. | MUST |

---

### Detailed Acceptance Criteria

- **LANG-AC-001**: Requirements and traceability document created with 100% coverage.
- **LANG-AC-002**: Zero `<input>` elements exist inside any filter popover (Language, Accent, Style, Gender, Age).
- **LANG-AC-003**: Dropdowns render items directly in compact containers with `max-h-60 overflow-y-auto` where needed.
- **LANG-AC-004**: `LANGUAGE_REGISTRY` contains all 32 canonical codes with labels for `vi`, `en`, `ja`, `zh`.
- **LANG-AC-005**: Filter states store canonical IDs (`vi`, `en`, `es-mx`, etc.).
- **LANG-AC-006**: Display labels resolve via `getLanguageLabel` and `getAccentLabel` matching active locale.
- **LANG-AC-007**: Visible language options derived via Policy B, prioritizing relevant/supported languages.
- **LANG-AC-008**: Language ordering places Vietnamese, English, Chinese, Japanese, Korean, Spanish, French, German first.
- **LANG-AC-009**: When `selectedLanguage === "all"`, Accent button is disabled with tooltip `selectLanguageFirst`.
- **LANG-AC-010**: Accent is enabled only when language is selected, has supported taxonomy, and has >= 2 usable accents.
- **LANG-AC-011**: If language has <= 1 usable accent, Accent button is disabled.
- **LANG-AC-012**: Disabled Accent button renders with opacity-50, cursor-not-allowed, not clickable, and tooltip helper.
- **LANG-AC-013**: Vietnamese accents define `vi-north`, `vi-central`, `vi-south` (Miền Bắc, Miền Trung, Miền Nam).
- **LANG-AC-014**: English accents define `en-us`, `en-gb`, `en-au`, `en-ca`, `en-in` (Mỹ, Anh, Úc, Canada, Ấn Độ).
- **LANG-AC-015**: Spanish accents define `es-es`, `es-mx`, `es-ar`, `es-co` (Tây Ban Nha, Mexico, Argentina, Colombia).
- **LANG-AC-016**: Portuguese accents define `pt-br`, `pt-pt` (Brazil, Bồ Đào Nha).
- **LANG-AC-017**: French accents define `fr-fr`, `fr-ca`, `fr-be`, `fr-ch` (Pháp, Canada, Bỉ, Thụy Sĩ).
- **LANG-AC-018**: German accents define `de-de`, `de-at`, `de-ch` (Đức, Áo, Thụy Sĩ).
- **LANG-AC-019**: Arabic accents define `ar-msa`, `ar-egyptian`, `ar-gulf`, `ar-levantine`, `ar-maghrebi` (Ả Rập chuẩn, Ai Cập, Vùng Vịnh, Levant, Maghreb).
- **LANG-AC-020**: Selecting Japanese or Chinese keeps Accent button disabled with tooltip `noAccentFilterForLanguage`.
- **LANG-AC-021**: Centralized exports `LANGUAGE_REGISTRY` and `ACCENTS_BY_LANGUAGE` consumed by modal.
- **LANG-AC-022**: Accent options derived without heuristic fake data.
- **LANG-AC-023**: Switching language resets accent to "all" and preserves valid gender and style.
- **LANG-AC-024**: Resetting language to "all" disables accent and removes accent chip.
- **LANG-AC-025**: Zero search boxes in Language, Accent, Style, Gender, Age popovers.
- **LANG-AC-026**: Language dropdown has `max-h-60 overflow-y-auto`; other dropdowns compact.
- **LANG-AC-027**: Keyboard focus, Tab traversal, Escape closing, and focus trap verified.
- **LANG-AC-028**: Switching locale dynamically updates active chips without state reset.
- **LANG-AC-029**: Voice cards display max 3 metadata items (Gender · Accent · Style).
- **LANG-AC-030**: Accent metadata read directly from `voice.accent`, no city heuristic.
- **LANG-AC-031**: Matching uses `voice.supportedLanguages`.
- **LANG-AC-032**: Style options remain the 7 canonical IDs without search.
- **LANG-AC-033**: Gender options remain male/female without search.
- **LANG-AC-034**: Age options remain young/middle_aged/senior without search.
- **LANG-AC-035**: Reset all clears state to all and restores all voice cards.
- **LANG-AC-036**: Runtime verification confirms 0 English words in VI UI and 0 Vietnamese words in EN UI.
- **LANG-AC-037**: All 12 runtime matrix cases pass in DevTools MCP.
- **LANG-AC-038**: Policy B documented in report.
- **LANG-AC-039**: Visual design dimensions and styles preserved.
- **LANG-AC-040**: Viewport tests at 1920x1080, 1440x900, 1024x700 pass without horizontal scroll.
- **LANG-AC-041**: Regression testing confirms 0 broken flows.
- **LANG-AC-042**: Compliance report generated and final report concludes with READY.
