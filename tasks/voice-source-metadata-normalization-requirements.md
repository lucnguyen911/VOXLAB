# VOXLAB — FINAL VOICE SOURCE TAXONOMY + PROVIDER METADATA NORMALIZATION
## Requirements & Acceptance Criteria (Traceability Specification)

This specification formally establishes the requirements for normalizing the voice taxonomy across VoxLab: decoupling Source, Origin, and Engine into 3 distinct dimensions, eliminating "Clone" as a Source filter, strictly enforcing authoritative metadata for Edge and Google/gTTS, completely disabling heuristic auto-tagging for cloned/custom voices, and ensuring 100% architectural and runtime consistency.

---

### Requirement & Acceptance Criteria Mapping

| Requirement ID | Description | Acceptance Criteria ID | Acceptance Criteria Summary |
| :--- | :--- | :--- | :--- |
| **VOICE-R-001** | Full Requirements Mapping & Traceability | **VOICE-AC-001** | All 46 prompt sections are mapped to explicit requirement IDs before any code modification; zero unmapped items. |
| **VOICE-R-002** | 3-Dimensional Voice Taxonomy (Source, Origin, Engine) | **VOICE-AC-002** | `VoiceProfile` distinguishes `source` (`edge` \| `google` \| `local`), `origin` (`system` \| `clone`), and `engine` (`edge_tts` \| `gtts` \| `omnivoice` \| `chatterbox_turbo` \| `qwen_tts_1_7b`). |
| **VOICE-R-003** | Final "Nguồn" (Source) Filter Options | **VOICE-AC-003** | Filter dropdown contains exactly 4 options: All / Tất cả, Edge TTS, Google TTS, Local AI. Strictly NO "Clone" option. Strictly NO search box inside Source dropdown. |
| **VOICE-R-004** | Clone Classified Strictly as Origin, Not Source | **VOICE-AC-004** | Cloned voices have `source: "local"`, `origin: "clone"`, and `engine: <engine_id>`. No contradictory state `source = "clone"`. |
| **VOICE-R-005** | Tab "Giọng của tôi" (My Voices) Semantics | **VOICE-AC-005** | Displays voices where `origin === "clone"` (or user-created). No "Source -> Clone" filter required. |
| **VOICE-R-006** | Tab "Hệ thống" (System) Semantics | **VOICE-AC-006** | Displays voices where `origin === "system"` (Edge TTS, Google TTS, and Local AI preset voices). Provider does not dictate ownership. |
| **VOICE-R-007** | Local AI Strictly Limited to 3 Models | **VOICE-AC-007** | Local AI engines strictly consist of `omnivoice`, `chatterbox_turbo`, and `qwen_tts_1_7b`. Zero other local models exposed. |
| **VOICE-R-008** | Source Filter Logic & Tab Runtime Matrix (8 Cases) | **VOICE-AC-008** | Tab and Source filter combine with logical AND across all 8 runtime cases (System+All, System+Edge, System+Google, System+Local, MyVoices+All, MyVoices+Local, MyVoices+Edge=empty, Favorites+Source). |
| **VOICE-R-009** | Edge TTS Authoritative Locale & Accent | **VOICE-AC-009** | Edge voices derive language, country, and accent strictly from official catalog (e.g. `en-US` -> `en`, `US`, `en-us`; `vi-VN` -> `vi`, `VN` with NO fake `vi-north`). |
| **VOICE-R-010** | Edge TTS Gender Normalization | **VOICE-AC-010** | Edge catalog gender maps to canonical `female` / `male` and localized dynamically according to UI locale. |
| **VOICE-R-011** | Edge TTS Style Normalization (No Guessed Styles) | **VOICE-AC-011** | No style heuristic based on voice name or description. If not officially provided by Edge, `style = null`. |
| **VOICE-R-012** | Edge TTS Age Normalization (No Guessed Age) | **VOICE-AC-012** | No age heuristic. If not officially provided by Edge, `ageGroup = null`. |
| **VOICE-R-013** | Google TTS / gTTS Provider Representation | **VOICE-AC-013** | Represented as Google Translate TTS (gTTS) language/region presets (e.g. Google TTS — Tiếng Việt, Google TTS — English (US)), NOT Google Cloud TTS. |
| **VOICE-R-014** | Google TTS No Fake Gender | **VOICE-AC-014** | `gender = null` for all gTTS presets; no fake Male/Female personas. |
| **VOICE-R-015** | Google TTS No Fake Style / Age | **VOICE-AC-015** | `style = null` and `ageGroup = null` for all gTTS presets; no fake generic "Natural" tags. |
| **VOICE-R-016** | Google TTS Language / Region Capability Presets | **VOICE-AC-016** | Presets reflect actual capability (e.g. `vi` -> `VN`, `en-US` -> `US`/`en-us`, `en-GB` -> `GB`/`en-gb`). |
| **VOICE-R-017** | Local Preset Voices Metadata Preservation | **VOICE-AC-017** | Retain explicitly curated project metadata for local preset voices; no runtime re-inference. |
| **VOICE-R-018** | Local Clone / Custom Voices No Auto Tagging | **VOICE-AC-018** | Cloned/custom voices have `gender = null`, `accent = null`, `style = null`, `ageGroup = null`, `country = null` unless explicitly supplied by user. Zero heuristic inference. |
| **VOICE-R-019** | Safe Search & Filter with Untagged Voices | **VOICE-AC-019** | Untagged voices render safely, search by name, select, preview, and synthesize without crashing; match "All", exclude specific facet filters. |
| **VOICE-R-020** | Country & Flag Canonical Derivation | **VOICE-AC-020** | Country code derived from canonical voice locale/metadata, never from provider headquarters or voice name guessing. |
| **VOICE-R-021** | Country / Accent Deduplication | **VOICE-AC-021** | Redundant national accent tags (e.g. 🇺🇸 US + "US") suppressed if already represented by country flag; informative regional accents (e.g. 🇻🇳 + "Miền Bắc") retained. |
| **VOICE-R-022** | Voice Card Tag Order & Maximum Limit | **VOICE-AC-022** | Tag order strictly: 1. Gender, 2. Informative Accent, 3. Style, 4. Age. Max 3 visible, remainder displayed as `+N`. |
| **VOICE-R-023** | +N Tag Accessible Tooltip / Popover | **VOICE-AC-023** | Hidden tags under `+N` badge accessible via hover and keyboard focus tooltip/popover. |
| **VOICE-R-024** | Dedicated Provider Badge | **VOICE-AC-024** | Provider badges (`Edge`, `Google`, `Local`) rendered distinctly without encroaching on or truncating voice names. |
| **VOICE-R-025** | Filter "Nguồn" (Source) Full I18N | **VOICE-AC-025** | Fully localized in `vi` (Nguồn, Tất cả, Edge TTS, Google TTS, Local AI) and `en` (Source, All, Edge TTS, Google TTS, Local AI). Brand names untranslated. |
| **VOICE-R-026** | Active Source Filter Chip Format | **VOICE-AC-026** | Active filter chip displays `Edge TTS ×`, `Google TTS ×`, `Local AI ×`. Canonical ID stored in state. |
| **VOICE-R-027** | Inspector Model Selector Independence | **VOICE-AC-027** | Source filter ("Local AI") decoupled from Inspector Model selector (OmniVoice, Chatterbox Turbo, Qwen TTS 1.7B). |
| **VOICE-R-028** | Voice Picker & Voice Library Consistency | **VOICE-AC-028** | VoiceSelectionModal and VoiceLibraryWorkspace share identical canonical VoiceProfile schema and taxonomy. |
| **VOICE-R-029** | Legacy Data Migration | **VOICE-AC-029** | Existing voices migrated safely (`source = "local"`, `origin = "clone"`, `engine = "qwen_tts_1_7b"`). Zero loss of user voices, favorites, or active voice. |
| **VOICE-R-030** | Diacritic-Insensitive Search | **VOICE-AC-030** | Search works across voice name, provider, and authoritative metadata without relying on removed heuristic tags. |
| **VOICE-R-031** | Sorting Preservation | **VOICE-AC-031** | Popular, newest, A-Z, and recent sorting work identically with normalized taxonomy. |
| **VOICE-R-032** | Favorite & Active Voice Preservation | **VOICE-AC-032** | User favorites and current active voice ID preserved through normalization and migration. |
| **VOICE-R-033** | Strictly Exclude Unauthorized Providers | **VOICE-AC-033** | OpenAI, ElevenLabs, Vbee, CapCut, Azure, Google Cloud, Kokoro, Piper, System Voices, eSpeak are completely excluded from selectable sources and catalogs. |
| **VOICE-R-034** | Strictly NO Automatic Voice Fallback | **VOICE-AC-034** | On synthesis/preview error, system retries or notifies user; never automatically changes selected voice. |
| **VOICE-R-035** | 100% UI Locale Purity | **VOICE-AC-035** | Zero mixed language strings across all screens and components. |
| **VOICE-R-036** | Responsive Layout & Accessibility | **VOICE-AC-036** | Tested at 1920x1080, 1440x900, 1024x700; keyboard navigation, focus traps, and screen-reader labels intact. |
| **VOICE-R-037** | Verification, Compliance Matrix & Strict Done | **VOICE-AC-037** | `tsc --noEmit` and `npm run build` pass with 0 errors; compliance matrix verified in detail; ready report rendered. |
