# VOICE PICKER I18N & DEPENDENT FILTER FOUNDATION — REQUIREMENTS SPECIFICATION

**Document**: `tasks/voice-picker-filter-foundation-requirements.md`  
**Scope**: VoxLab Desktop — Voice Picker Popup (`VoiceSelectionModal`) & Filter Foundation  
**Traceability Status**: **100% COVERAGE** (All 30 prompt sections mapped)

---

## I. BACKWARDS REQUIREMENT TRACEABILITY MATRIX (SOURCE SECTION → REQUIREMENT ID)

| Source Section | Prompt Directive Detail | Mapped ID | Coverage |
| :--- | :--- | :--- | :---: |
| **0. MỤC TIÊU** | Đồng bộ toàn bộ Voice Picker với ngôn ngữ giao diện VoxLab | **VF-R-001** | FULL |
| **0. MỤC TIÊU** | Bộ lọc phải tương tác / phụ thuộc đúng với nhau thay vì độc lập & hardcode | **VF-R-002** | FULL |
| **0. MỤC TIÊU** | Không redesign visual; không thêm filter mới bừa bãi; xây foundation trước | **VF-R-003** | FULL |
| **1. SOURCE OF TRUTH** | Inspect code, data model, i18n system, locale state, filters, metadata, model context | **VF-R-004** | FULL |
| **1. SOURCE OF TRUTH** | Tạo requirements & traceability matrix; cấm code nếu chưa map 100% | **VF-R-005** | FULL |
| **2. TÁCH LOCALE & SEMANTICS** | UI locale chỉ điều khiển presentation labels, KHÔNG điều khiển filter semantics | **VF-R-006** | FULL |
| **2. TÁCH LOCALE & SEMANTICS** | Filter state lưu canonical IDs (`vi`, `vi-north`, `female`), không lưu translated strings | **VF-R-007** | FULL |
| **2. TÁCH LOCALE & SEMANTICS** | Đổi UI locale không được thay đổi filter semantics hoặc kết quả lọc | **VF-R-008** | FULL |
| **3. KHÔNG DÙNG DISPLAY STRING** | Loại bỏ hoàn toàn so sánh filter dựa trên translated label trong codebase | **VF-R-009** | FULL |
| **3. KHÔNG DÙNG DISPLAY STRING** | Toàn bộ logic lọc dùng canonical IDs; translation chỉ ở presentation layer | **VF-R-010** | FULL |
| **4. ĐỒNG BỘ I18N TOÀN BỘ** | 100% user-facing text trong Voice Picker đi qua i18n system hiện có | **VF-R-011** | FULL |
| **4. ĐỒNG BỘ I18N TOÀN BỘ** | Bao quát tối thiểu 23 hạng mục text (tiêu đề, tabs, buttons, chips, empty, sort...) | **VF-R-012** | FULL |
| **5. RUNTIME LOCALE SWITCH** | Đổi locale UI (vi ↔ en ↔ ja ↔ zh) cập nhật ngay toàn bộ label trong modal | **VF-R-013** | FULL |
| **5. RUNTIME LOCALE SWITCH** | Đổi locale UI giữ nguyên danh sách kết quả, canonical filter state và search | **VF-R-014** | FULL |
| **6. LANG → ACCENT DEPENDENCY** | Accent phụ thuộc bắt buộc vào Language; không hardcode accent độc lập | **VF-R-015** | FULL |
| **6. LANG → ACCENT DEPENDENCY** | Lang = vi → Accent = vi-north, vi-central, vi-south (Miền Bắc, Trung, Nam) | **VF-R-016** | FULL |
| **6. LANG → ACCENT DEPENDENCY** | Lang = en → Accent = en-us, en-uk, en-au (US, UK, Australian); cấm hiện Miền Bắc | **VF-R-017** | FULL |
| **7. LANGUAGE = ALL** | Lang = All không trộn mọi accent thành danh sách dài | **VF-R-018** | FULL |
| **7. LANGUAGE = ALL** | Lang = All → Accent ở trạng thái disabled / unavailable | **VF-R-019** | FULL |
| **7. LANGUAGE = ALL** | Accent disabled hiển thị tooltip/helper "Chọn ngôn ngữ trước", không giải thích dài | **VF-R-020** | FULL |
| **7. LANGUAGE = ALL** | Khi chọn Language cụ thể → Accent được enable ngay | **VF-R-021** | FULL |
| **8. RESET CHILD FILTER** | Đổi Language → reset child accent về All/null | **VF-R-022** | FULL |
| **8. RESET CHILD FILTER** | Giữ nguyên sibling filters hợp lệ (gender, category/style); không reset máy móc | **VF-R-023** | FULL |
| **8. RESET CHILD FILTER** | Tuyệt đối không cho phép tồn tại state mâu thuẫn (English + Miền Bắc) | **VF-R-024** | FULL |
| **9. ACCENT STRUCTURED SOURCE** | Accent options tập trung tại cấu trúc dữ liệu chuẩn (`accentOptionsByLanguage`) | **VF-R-025** | FULL |
| **9. ACCENT STRUCTURED SOURCE** | Canonical IDs ổn định, translation keys độc lập, dễ mở rộng ngôn ngữ mới | **VF-R-026** | FULL |
| **10. RESPECT CURRENT DATASET** | Lọc option có sẵn theo dataset thực tế; không hiển thị option hoàn toàn rỗng | **VF-R-027** | FULL |
| **10. RESPECT CURRENT DATASET** | Không fake voice metadata để tạo option | **VF-R-028** | FULL |
| **11. FACETED FILTER** | Tính toán availability của options dựa trên tập voices còn phù hợp | **VF-R-029** | FULL |
| **11. FACETED FILTER** | Không cho user chọn option chắc chắn ra 0 kết quả nếu hệ thống biết trước | **VF-R-030** | FULL |
| **12. GENERIC FILTER DEPENDENCY** | Không hardcode if vi/en rải rác; kiến trúc generic cho tương lai (ja, zh...) | **VF-R-031** | FULL |
| **13. ACTIVE CHIPS I18N** | Active chips hiển thị translated label từ canonical state, cập nhật ngay khi đổi locale | **VF-R-032** | FULL |
| **14. FILTER DROPDOWN LABELS** | Label nút chưa active và active phản ánh đúng i18n và canonical value | **VF-R-033** | FULL |
| **15. SEARCH LOCALE-AGNOSTIC** | Search tìm theo name, canonical tags, metadata, accent; không phụ thuộc UI locale | **VF-R-034** | FULL |
| **16. NO SPECULATIVE METADATA** | Không suy đoán metadata từ name/freeform tags; thiếu metadata giữ unknown/null | **VF-R-035** | FULL |
| **17. MULTILINGUAL VOICES** | Multilingual voices (`supportedLanguages`) khớp đúng khi lọc từng ngôn ngữ | **VF-R-036** | FULL |
| **17. MULTILINGUAL VOICES** | Ghi rõ giới hạn accent schema hiện tại, không tự chế đa accent speculatively | **VF-R-037** | FULL |
| **18. CURRENT TTS MODEL** | Bảo toàn context model đang chọn; không bắt user filter lại model | **VF-R-038** | FULL |
| **19. NO FINAL TAXONOMY LOCK** | Giữ scope là FOUNDATION; không tự thêm Timbre, Emotion, hàng chục Style mới | **VF-R-039** | FULL |
| **20. EMPTY STATE I18N** | Empty state dịch theo UI locale; Primary action: Đặt lại bộ lọc, Sec: Tạo giọng | **VF-R-040** | FULL |
| **21. RESET FILTERS** | Reset clear canonical state, clear accent phụ thuộc, đưa UI về mặc định | **VF-R-041** | FULL |
| **22. LOCALE TEST MATRIX** | Verify runtime với `vi` và `en`; verify basic render cho `ja` và `zh` | **VF-R-042** | FULL |
| **23. RUNTIME MATRIX** | Case 1: vi + vi → Miền Bắc/Trung/Nam | **VF-R-043** | FULL |
| **23. RUNTIME MATRIX** | Case 2: vi + en → Accent labels tiếng Việt (Mỹ, Anh, Úc...) với canonical en-* | **VF-R-044** | FULL |
| **23. RUNTIME MATRIX** | Case 3: en + vi → Accent labels English (Northern, Central, Southern Vietnamese) | **VF-R-045** | FULL |
| **23. RUNTIME MATRIX** | Case 4: en + en → Accent labels English (US, UK, Australian...) | **VF-R-046** | FULL |
| **23. RUNTIME MATRIX** | Case 5: vi + vi-north → đổi en → accent reset All/null | **VF-R-047** | FULL |
| **23. RUNTIME MATRIX** | Case 6: vi + vi-north + female + podcast → đổi en → chỉ accent reset; female/podcast giữ | **VF-R-048** | FULL |
| **23. RUNTIME MATRIX** | Case 7: Lang = All → Accent disabled/unavailable | **VF-R-049** | FULL |
| **24. UI STATE CONSISTENCY** | Cấm trạng thái mâu thuẫn (English + Miền Bắc) trên dropdown, chips, state, kết quả | **VF-R-050** | FULL |
| **25. VISUAL REQUIREMENTS** | Giữ nguyên visual language, layout, tabs, dark theme; không text clipping, overflow | **VF-R-051** | FULL |
| **26. RESPONSIVE** | Verify tại 1920x1080, 1440x900, 1024x700 với zero horizontal overflow | **VF-R-052** | FULL |
| **27. REGRESSION PREVENTION** | Không làm hỏng modal launch, audio preview, selection, favorite, clone, tts... | **VF-R-053** | FULL |
| **28. COMPLIANCE MATRIX** | Tạo `tasks/voice-picker-filter-foundation-compliance.md` với code & runtime evidence | **VF-R-054** | FULL |
| **29. STRICT DOD** | Cấm kết luận DONE/READY nếu còn bất kỳ MUST fail/partial/unverified | **VF-R-055** | FULL |
| **30. FINAL REPORT** | Trả báo cáo theo đúng format chuẩn và chỉ kết luận READY hoặc NOT READY | **VF-R-056** | FULL |

---

## II. DETAILED REQUIREMENTS & ACCEPTANCE CRITERIA (VF-R & VF-AC)

### Category A: Core i18n & Decoupled Filter Semantics

#### VF-R-001 / VF-R-006 / VF-R-007: Canonical Filter State
- **Description**: Filter state inside `VoiceSelectionModal` MUST store stable canonical IDs:
  - `language`: `"all"` | `"vi"` | `"en"` | `"ja"` | `"zh"` | ...
  - `accent`: `"all"` | `"vi-north"` | `"vi-central"` | `"vi-south"` | `"en-us"` | `"en-uk"` | `"en-au"` | ...
  - `gender`: `"all"` | `"male"` | `"female"`
  - `category`: `"all"` | `"narration"` | `"conversational"` | `"characters"` | `"social"` | `"entertainment"` | `"ad"` | `"education"`
  - `age`: `"all"` | `"young"` | `"middle_aged"` | `"senior"`
- **VF-AC-001**: State never contains display labels such as `"Tiếng Việt"`, `"Miền Bắc"`, `"Nữ giới"`, `"Female"`.
- **VF-AC-002**: Filter predicates strictly compare against canonical properties or normalized metadata.

#### VF-R-009 / VF-R-010: No Display Strings in Logic
- **Description**: Search and remove all occurrences of translated label comparison in filtering code.
- **VF-AC-003**: No code exists matching `if (language === "Tiếng Việt")` or `voice.accent === "Miền Bắc"`.
- **VF-AC-004**: Translation function takes a canonical ID and current UI locale (`lang`) and returns the presentation label.

#### VF-R-011 / VF-R-012: Comprehensive Voice Picker i18n Coverage
- **Description**: All user-facing text in `VoiceSelectionModal` MUST use translations from `useI18n()`.
- **VF-AC-005**: All UI elements (tabs, search placeholder, filter buttons, active chips, dropdown items, empty states, sort labels, tooltips, action buttons) are dynamically localized.
- **VF-AC-006**: No hardcoded Vietnamese or English strings in JSX/TSX. All strings present in `translations.ts` for `vi`, `en`, `ja`, and `zh`.

#### VF-R-013 / VF-R-014: Instant Runtime UI Locale Switch
- **Description**: When `setLang()` is called (e.g. via TopBar language dropdown), the open Voice Picker updates all text immediately.
- **VF-AC-007**: Active filter chips change presentation label instantly (e.g. `[ ✕ Ngôn ngữ | Tiếng Việt ]` becomes `[ ✕ Language | Vietnamese ]`).
- **VF-AC-008**: The filtered voice list and active canonical state remain 100% intact during and after locale switch.

---

### Category B: Dependent Filters & Accent Registry

#### VF-R-015 / VF-R-016 / VF-R-017 / VF-R-025 / VF-R-026: Centralized Language → Accent Dependency
- **Description**: Accent options are strictly dependent on selected Language via a centralized configuration `ACCENT_OPTIONS_BY_LANGUAGE`.
- **VF-AC-009**: When `language === "vi"`, available accents are `vi-north`, `vi-central`, `vi-south`.
- **VF-AC-010**: When `language === "en"`, available accents are `en-us`, `en-uk`, `en-au`. Vietnamese accents are never displayed.
- **VF-AC-011**: Configuration is centralized in a single typed object/module, not embedded in JSX.

#### VF-R-018 / VF-R-019 / VF-R-020 / VF-R-021: Accent Disabled When Language = All
- **Description**: When `language === "all"`, Accent filter button is disabled.
- **VF-AC-012**: Accent button has disabled styling (muted background, cursor not-allowed, opacity 60%).
- **VF-AC-013**: Tooltip/helper displays translated message: `"Chọn ngôn ngữ trước"` (VI) / `"Select language first"` (EN).
- **VF-AC-014**: Accents from multiple languages are NEVER combined into a single flat dropdown.
- **VF-AC-015**: As soon as a language is selected, Accent button becomes interactive.

#### VF-R-022 / VF-R-023 / VF-R-024: Child Filter Reset & Sibling Preservation
- **Description**: When user changes Language to another language (or All), child `accent` is automatically reset.
- **VF-AC-016**: Switching from `vi` to `en` resets `accent` to `"all"`.
- **VF-AC-017**: Sibling filters (`gender`, `category`, `age`) are preserved if valid.
- **VF-AC-018**: Contradictory states like `English + vi-north` cannot occur.

#### VF-R-027 / VF-R-028 / VF-R-029 / VF-R-030 / VF-R-031: Generic Faceted Availability
- **Description**: Options in dropdowns derive availability from dataset without displaying impossible options.
- **VF-AC-019**: If no voices in dataset match a particular accent/category for current language, option is gracefully omitted or disabled.
- **VF-AC-020**: No voice metadata is fabricated or faked.

---

### Category C: Presentation, Search, Metadata & Empty State

#### VF-R-032 / VF-R-033: Localized Active Filter Chips
- **Description**: Active filter chips display localized labels for both filter name and filter value.
- **VF-AC-021**: Format: `[ ✕ <Localized Filter Name> | <Localized Value> ]`.
- **VF-AC-022**: Clicking `✕` resets only that specific filter. Clicking label opens dropdown to change value.

#### VF-R-034: Search Locale-Agnostic
- **Description**: Search input works independently of active UI locale.
- **VF-AC-023**: Matches voice name, canonical tags, metadata, and normalized Vietnamese (accent-insensitive) without crashing or mutating metadata regardless of UI locale.

#### VF-R-035 / VF-R-036 / VF-R-037: Authoritative Metadata & Multilingual Voices
- **Description**: Voices with multiple languages (e.g. `["vi", "en"]`) match when filtering either `vi` or `en`.
- **VF-AC-024**: Multilingual voice (Jenny Neural, Thảo Trinh, Mai Phương) correctly appears under `vi` and `en` filter.
- **VF-AC-025**: No speculative inference of metadata from freeform text.

#### VF-R-038: TTS Model Context Preservation
- **Description**: Voice Picker preserves model compatibility context without breaking or forcing redundant model filtering.
- **VF-AC-026**: Optional `currentModel` prop accepted; voices matching model are properly highlighted or verified.

#### VF-R-040 / VF-R-041: Localized Empty State & Reset
- **Description**: Empty state and reset buttons are fully translated.
- **VF-AC-027**: Empty state displays localized title, description, and primary CTA `"Đặt lại bộ lọc"` / `"Reset filters"`.
- **VF-AC-028**: Reset button restores all filters to default (`"all"`), clears dependent accent, closes open dropdown.

---

### Category D: Runtime Verification Matrix & Strict DoD

#### VF-R-043 to VF-R-049: 7 Runtime Cases
- **VF-AC-029 (Case 1)**: UI = vi, Lang = vi → Accent options = Miền Bắc / Miền Trung / Miền Nam.
- **VF-AC-030 (Case 2)**: UI = vi, Lang = en → Accent options = Tiếng Anh Mỹ / Tiếng Anh Anh / Tiếng Anh Úc (canonical `en-us`, `en-uk`, `en-au`).
- **VF-AC-031 (Case 3)**: UI = en, Lang = vi → Accent options = Northern Vietnamese / Central Vietnamese / Southern Vietnamese.
- **VF-AC-032 (Case 4)**: UI = en, Lang = en → Accent options = US / UK / Australian.
- **VF-AC-033 (Case 5)**: State `vi` + `vi-north` → switch Lang to `en` → Accent resets to `all`.
- **VF-AC-034 (Case 6)**: State `vi` + `vi-north` + `female` + `narration` → switch Lang to `en` → Accent resets to `all`, `female` and `narration` preserved.
- **VF-AC-035 (Case 7)**: State Lang = `all` → Accent is disabled with tooltip.

#### VF-R-050 / VF-R-051 / VF-R-052 / VF-R-053: Consistency, Responsive & Zero Regression
- **VF-AC-036**: Zero contradictory filter states possible across dropdown, chips, internal state, and result filtering.
- **VF-AC-037**: Tested at 1920x1080, 1440x900, 1024x700 with zero horizontal overflow.
- **VF-AC-038**: Zero regression in audio preview, voice selection, favorite toggle, search, focus trap, and modal close.

#### VF-R-054 / VF-R-055 / VF-R-056: Compliance Matrix & Final Report
- **VF-AC-039**: `tasks/voice-picker-filter-foundation-compliance.md` created with full code & runtime evidence.
- **VF-AC-040**: Final verdict strictly READY or NOT READY.
