# VOXLAB — PHASE 1 VOICE PROVIDERS REQUIREMENTS & ACCEPTANCE CRITERIA
## Edge TTS + OpenAI GPT TTS + Google TTS + 3 Existing Local Models

**Document Version:** 1.0.0  
**Scope:** Phase 1 Voice Providers (`edge`, `openai`, `google_translate`, `local`, `clone`), Voice Picker Source Filter (`VoiceSelectionModal.tsx`), Unified Voice Profile Schema (`ui.ts`), Provider Adapters, Audio Preview, Full I18N.  
**Traceability Target:** 100% Coverage across 44 prompt sections (`PROV-R-001` through `PROV-R-044`, `PROV-AC-001` through `PROV-AC-044`).

---

### Requirement Traceability Matrix

| Requirement ID | Acceptance Criteria ID | Section | Category | Description | Priority |
|---|---|---|---|---|---|
| **PROV-R-001** | PROV-AC-001 | 0 | Scope Boundary | Online providers strictly limited to Edge TTS, OpenAI TTS, Google TTS (gTTS). Local engines strictly limited to OmniVoice, Chatterbox Turbo, Qwen TTS 1.7B. Voice Clone preserved. | MUST |
| **PROV-R-002** | PROV-AC-002 | 0, 33 | Scope Boundary | Strictly forbidden: Kokoro, Piper, ElevenLabs, Vbee, CapCut, Azure Speech, Google Cloud TTS, Amazon Polly, Coqui, XTTS, Fish Speech, CosyVoice. None exposed. | MUST |
| **PROV-R-003** | PROV-AC-003 | 1 | Governance | Create requirements document and traceability matrix with 100% coverage before production changes. | MUST |
| **PROV-R-004** | PROV-AC-004 | 2 | Architecture | Voice schema must distinguish `sourceType` (online, local, clone), `provider` (edge, openai, google_translate, local, clone), and `engine`/`model`. | MUST |
| **PROV-R-005** | PROV-AC-005 | 2 | Architecture | Edge maps to `sourceType: "online"`, `provider: "edge"`, `engine: "edge_tts"`. | MUST |
| **PROV-R-006** | PROV-AC-006 | 2 | Architecture | OpenAI maps to `sourceType: "online"`, `provider: "openai"`, `engine: "gpt_tts"` (or model ID). | MUST |
| **PROV-R-007** | PROV-AC-007 | 2 | Architecture | Google Translate maps to `sourceType: "online"`, `provider: "google_translate"`, `engine: "gtts"`. | MUST |
| **PROV-R-008** | PROV-AC-008 | 2 | Architecture | Local engines map to `sourceType: "local"`, `provider: "local"`, `engine`: `omnivoice`, `chatterbox_turbo`, `qwen_tts_1_7b`. | MUST |
| **PROV-R-009** | PROV-AC-009 | 2 | Architecture | Clone maps to `sourceType: "clone"`, `provider: "clone"`. | MUST |
| **PROV-R-010** | PROV-AC-010 | 3, 34 | UI / Filter Order | Add filter "Nguồn" (VI) / "Source" (EN) in exact order: Ngôn ngữ → Vùng / Accent → Nguồn → Phong cách → Giới tính → Tuổi. | MUST |
| **PROV-R-011** | PROV-AC-011 | 3, 20 | UI / Search | Zero search input inside "Nguồn" / "Source" dropdown. Clean direct list. | MUST |
| **PROV-R-012** | PROV-AC-012 | 4 | UI / Options | Source dropdown options in VI: Tất cả, TRỰC TUYẾN (Edge TTS, OpenAI TTS, Google TTS), CỤC BỘ (Local), GIỌNG CỦA TÔI (Clone). | MUST |
| **PROV-R-013** | PROV-AC-013 | 4 | UI / Options | Source dropdown options in EN: All, ONLINE (Edge TTS, OpenAI TTS, Google TTS), LOCAL (Local), MY VOICES (Clone). | MUST |
| **PROV-R-014** | PROV-AC-014 | 4, 22 | Logic | Local option aggregates all 3 local models (OmniVoice, Chatterbox Turbo, Qwen 1.7B). Do NOT expose them as separate Source options. | MUST |
| **PROV-R-015** | PROV-AC-015 | 5 | Engine Registry | Local engine registry in this phase contains ONLY OmniVoice, Chatterbox Turbo, Qwen TTS 1.7B. | MUST |
| **PROV-R-016** | PROV-AC-016 | 6 | Edge Adapter | Implement Edge TTS provider adapter with `availability()`, `listVoices()`, `preview()`, `synthesize()`, `capabilities()`. | MUST |
| **PROV-R-017** | PROV-AC-017 | 6 | Edge Catalog | Do not hardcode hundreds of Edge voices into `mock/data.ts`. Modal consumes normalized catalog from adapter. | MUST |
| **PROV-R-018** | PROV-AC-018 | 7 | Edge Metadata | Map authoritative Edge metadata only: `en-US` → language `en`, accent `en-us`; `en-GB` → language `en`, accent `en-gb`. `vi-VN` → language `vi`, accent `null`/`undefined`. No heuristic accent guessing! | MUST |
| **PROV-R-019** | PROV-AC-019 | 8 | OpenAI Adapter | Implement OpenAI TTS provider adapter: `provider = "openai"`, UI brand "OpenAI TTS". Model and provider separated. | MUST |
| **PROV-R-020** | PROV-AC-020 | 9 | OpenAI Credentials | OpenAI credential state handled: if API key missing, show status "Chưa cấu hình" (VI) / "Not configured" (EN). Modal does not crash; other providers work normally. No fake synthesis. | MUST |
| **PROV-R-021** | PROV-AC-021 | 10 | OpenAI Catalog | Expose official OpenAI speech voices: alloy, echo, fable, onyx, nova, shimmer, ash, coral, sage. Centralized capability registry. | MUST |
| **PROV-R-022** | PROV-AC-022 | 11 | Google Adapter | Implement Google Translate TTS adapter: canonical `provider = "google_translate"`, UI brand "Google TTS". Distinct from Google Cloud TTS. | MUST |
| **PROV-R-023** | PROV-AC-023 | 12 | Google Capabilities | Represent real gTTS capabilities (language/regional), do not fabricate fake named voices (e.g. "Google Voice Female 1"). | MUST |
| **PROV-R-024** | PROV-AC-024 | 13 | Google Stability | Online integration with graceful failure: if gTTS unavailable, mark provider unavailable without crashing modal. Never silently fallback to paid Google Cloud API. | MUST |
| **PROV-R-025** | PROV-AC-025 | 14 | Unified Profile | Normalize all voice entries to unified `VoiceProfile`: `id`, `name`/`displayName`, `sourceType`, `provider`, `engine`/`model`, `supportedLanguages`, `accent`, `gender`, `style`, `ageGroup`, `previewAvailable`, `availability`, `isFavorite`, `modelCompatibility`. | MUST |
| **PROV-R-026** | PROV-AC-026 | 15 | Card Badge | Voice cards render a distinct provider badge: `Edge`, `OpenAI`, `Google`, `Local`, `Clone`. Never generic "Online" if provider badge applies. Not merged into metadata string. | MUST |
| **PROV-R-027** | PROV-AC-027 | 16 | Card Preview | Keep "Nghe thử" / "Preview" button with unified flow. Clicking preview does NOT select voice and does NOT close modal. Shows loading/error state gracefully. | MUST |
| **PROV-R-028** | PROV-AC-028 | 17 | Filter Logic | Source filter combines via logical AND with Language, Accent, Style, Gender, Age, and Search. | MUST |
| **PROV-R-029** | PROV-AC-029 | 18 | Taxonomy Reuse | Providers normalize languages and accents to existing canonical IDs (`vi`, `en`, `vi-north`, `en-us`, etc.). | MUST |
| **PROV-R-030** | PROV-AC-030 | 19 | I18N | Full I18N for all new labels in VI and EN: Nguồn / Source, Tất cả / All, Trực tuyến / Online, Cục bộ / Local, Giọng của tôi / My voices, Chưa cấu hình / Not configured, Không khả dụng / Unavailable, Nghe thử / Preview. No mixed locale. | MUST |
| **PROV-R-031** | PROV-AC-031 | 21 | Active Chip | Active source chip displays canonical mapped label: `Edge TTS ×`, `OpenAI TTS ×`, `Google TTS ×`, `Local ×`, `Clone ×`. Internal state stores canonical ID. | MUST |
| **PROV-R-032** | PROV-AC-032 | 23 | Model vs Source | Source answers "Where voice comes from", Model answers "Which engine processes". TTS Inspector manages active model; no duplicated model selector in Voice Picker. | MUST |
| **PROV-R-033** | PROV-AC-033 | 24 | Availability State | Provider unconfigured/unavailable state explicitly shown (disabled preview / status indicator) rather than pretending to work. | MUST |
| **PROV-R-034** | PROV-AC-034 | 25 | Failure Isolation | Failure in OpenAI or Edge does not crash other providers (Google, Local, Clone). | MUST |
| **PROV-R-035** | PROV-AC-035 | 26 | Catalog Caching | Online catalog cached appropriately; does not re-fetch voice list on every render. | MUST |
| **PROV-R-036** | PROV-AC-036 | 27 | Mock Restraint | No massive fake mock voices. Adapters use real catalog definitions. | MUST |
| **PROV-R-037** | PROV-AC-037 | 28, 29 | Regression | Verify OmniVoice, Chatterbox Turbo, Qwen TTS 1.7B, and Voice Clone continue working without regression. | MUST |
| **PROV-R-038** | PROV-AC-038 | 30 | Sorting | Sorting (popular, newest, A-Z, recent) operates deterministically with fallback for voices without usageCount. | MUST |
| **PROV-R-039** | PROV-AC-039 | 31, 32 | Accurate Branding | OpenAI TTS never marked "Free" / "Miễn phí". Google TTS never named Google Cloud, Neural2, WaveNet, Chirp. | MUST |
| **PROV-R-040** | PROV-AC-040 | 35 | Responsive | Test at 1920x1080, 1440x900, 1024x700. Adding Source filter does not introduce horizontal overflow. | MUST |
| **PROV-R-041** | PROV-AC-041 | 36 | Accessibility | Source filter is keyboard accessible (Tab, Enter/Space, Escape), focus visible, focus trap preserved. | MUST |
| **PROV-R-042** | PROV-AC-042 | 37, 38 | Runtime Tests | Execute 14 runtime test cases (Source All, Edge, OpenAI, Google, Local, Clone, combined filters, and reset). | MUST |
| **PROV-R-043** | PROV-AC-043 | 40 | Build | Verify `npx tsc --noEmit` and `npm run build` pass with 0 errors. | MUST |
| **PROV-R-044** | PROV-AC-044 | 41-43 | Report & Compliance | Generate `tasks/phase1-voice-providers-compliance.md` and output final report formatted per Section 43 ending with READY/NOT READY. | MUST |

---

### Detailed Acceptance Criteria

- **PROV-AC-001**: Online providers comprise Edge TTS, OpenAI TTS, Google TTS (gTTS); Local comprises OmniVoice, Chatterbox Turbo, Qwen 1.7B; Clone comprises Voice Clone.
- **PROV-AC-002**: No instances of Kokoro, Piper, ElevenLabs, Vbee, CapCut, Azure Speech, Google Cloud TTS, Amazon Polly, Coqui, XTTS exist in active provider lists.
- **PROV-AC-003**: `tasks/phase1-voice-providers-requirements.md` created before production implementation.
- **PROV-AC-004**: `VoiceProfile` interface contains `sourceType`, `provider`, `engine`/`model`, `availability`, `previewAvailable`.
- **PROV-AC-005**: Edge voices have `sourceType: "online"`, `provider: "edge"`, `engine: "edge_tts"`.
- **PROV-AC-006**: OpenAI voices have `sourceType: "online"`, `provider: "openai"`, `engine: "gpt_tts"`.
- **PROV-AC-007**: Google Translate voices have `sourceType: "online"`, `provider: "google_translate"`, `engine: "gtts"`.
- **PROV-AC-008**: Local voices have `sourceType: "local"`, `provider: "local"`, `engine: "omnivoice" | "chatterbox_turbo" | "qwen_tts_1_7b"`.
- **PROV-AC-009**: Clone voices have `sourceType: "clone"`, `provider: "clone"`.
- **PROV-AC-010**: Filter order in modal is strictly: Language → Accent → Source → Style → Gender → Age.
- **PROV-AC-011**: Zero `<input>` elements exist in the Source dropdown popover.
- **PROV-AC-012**: In Vietnamese UI, Source options display All, TRỰC TUYẾN (Edge TTS, OpenAI TTS, Google TTS), CỤC BỘ (Local), GIỌNG CỦA TÔI (Clone).
- **PROV-AC-013**: In English UI, Source options display All, ONLINE (Edge TTS, OpenAI TTS, Google TTS), LOCAL (Local), MY VOICES (Clone).
- **PROV-AC-014**: Selecting `local` filters voices where `sourceType === "local"` (covering OmniVoice, Chatterbox Turbo, Qwen 1.7B).
- **PROV-AC-015**: Local engine registry only accepts the 3 specified models.
- **PROV-AC-016**: Edge adapter defines `availability()`, `listVoices()`, `preview()`, `synthesize()`, `capabilities()`.
- **PROV-AC-017**: Edge voice catalog provided by adapter, not dumped as hundreds of entries in `mock/data.ts`.
- **PROV-AC-018**: Edge `vi-VN` voices do NOT have `accent` set to `vi-north`/`central`/`south`. English `en-US` maps to `en-us`, `en-GB` maps to `en-gb`.
- **PROV-AC-019**: OpenAI provider adapter exposes brand "OpenAI TTS", `provider = "openai"`.
- **PROV-AC-020**: When API key is absent, OpenAI provider indicates "Chưa cấu hình" / "Not configured", preview shows unconfigured notification, other providers continue working.
- **PROV-AC-021**: OpenAI catalog exposes `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`, `ash`, `coral`, `sage`.
- **PROV-AC-022**: Google provider uses `google_translate`, brand "Google TTS".
- **PROV-AC-023**: Google TTS reflects language-based capabilities without fake personal names.
- **PROV-AC-024**: Google Translate failure is handled gracefully without crash and without fallback to Google Cloud.
- **PROV-AC-025**: All voices conform to unified `VoiceProfile`.
- **PROV-AC-026**: Voice card renders small badge `Edge`, `OpenAI`, `Google`, `Local`, or `Clone` outside the metadata text row.
- **PROV-AC-027**: Clicking "Nghe thử" triggers audio preview, does not select voice, does not close modal.
- **PROV-AC-028**: Filtering by Source combines via logical AND with Language, Accent, Style, Gender, Age, and Search.
- **PROV-AC-029**: Canonical IDs reused across all providers.
- **PROV-AC-030**: Translations file contains all required keys for VI and EN.
- **PROV-AC-031**: Active chip renders localized provider label with removal button `×`.
- **PROV-AC-032**: TTS Inspector manages active model; Voice Picker does not duplicate model selector.
- **PROV-AC-033**: Unconfigured/unavailable providers reflect their status.
- **PROV-AC-034**: Each provider failure is isolated to its own domain.
- **PROV-AC-035**: Catalog caching prevents redundant fetching.
- **PROV-AC-036**: Verified voice catalog definitions used without massive mock bloat.
- **PROV-AC-037**: OmniVoice, Chatterbox Turbo, Qwen 1.7B, and Voice Clone function without regression.
- **PROV-AC-038**: Sorting works predictably with fallback for missing usage count.
- **PROV-AC-039**: No claims of "Free" for OpenAI, no claims of "Google Cloud/WaveNet" for Google.
- **PROV-AC-040**: Viewport tests at 1920x1080, 1440x900, 1024x700 show no horizontal overflow.
- **PROV-AC-041**: Keyboard navigation and focus trap work seamlessly for Source filter.
- **PROV-AC-042**: All 14 runtime test cases executed and verified in DevTools MCP.
- **PROV-AC-043**: `tsc --noEmit` and `npm run build` exit with code 0.
- **PROV-AC-044**: Compliance report generated and final report output matching Section 43 format.
