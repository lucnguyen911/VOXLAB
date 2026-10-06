# Compliance Matrix: Phase 1 Voice Providers (Edge TTS + OpenAI TTS + Google TTS + 3 Local Models)

Date: 2026-09-11
Status: 100% PASS (44/44 Requirements Met)

## Traceability Table

| ID | Requirement / Rule | Implementation & Location | Status |
| :--- | :--- | :--- | :--- |
| **PROV-R-001** | Only 3 Online Providers: Edge TTS, OpenAI TTS, Google Translate TTS | `src/services/providers/index.ts`, `edgeProvider.ts`, `openaiProvider.ts`, `googleProvider.ts` | **PASS** |
| **PROV-R-002** | Strictly 3 Local Models: OmniVoice, Chatterbox Turbo, Qwen TTS 1.7B | `src/services/providers/localProvider.ts`, `src/mock/data.ts` | **PASS** |
| **PROV-R-003** | Retain Voice Clone capability | `src/services/providers/cloneProvider.ts`, `src/types/ui.ts` | **PASS** |
| **PROV-R-004** | Forbidden providers (Kokoro, Piper, ElevenLabs, etc.) excluded | Audited catalog across `src/mock/data.ts` and `src/services/providers/` | **PASS** |
| **PROV-R-005** | No auto-expanding local models beyond the 3 | `src/services/providers/localProvider.ts` | **PASS** |
| **PROV-R-006** | Edge TTS provider abstraction (`edge`, `edge_tts`) | `src/services/providers/edgeProvider.ts` | **PASS** |
| **PROV-R-007** | Edge dynamic catalog & vi-VN no fake accent | `src/services/providers/edgeProvider.ts` (lines 40-75) | **PASS** |
| **PROV-R-008** | Edge en-US accent mapping | `src/services/providers/edgeProvider.ts` (lines 80-110) | **PASS** |
| **PROV-R-009** | Edge fallback & synthesis API preview | `src/services/providers/edgeProvider.ts` (lines 200-240) | **PASS** |
| **PROV-R-010** | OpenAI TTS provider abstraction (`openai`, `gpt_tts`) | `src/services/providers/openaiProvider.ts` | **PASS** |
| **PROV-R-011** | Official OpenAI voices only (alloy, echo, fable, onyx, nova, shimmer, ash, coral, sage) | `src/services/providers/openaiProvider.ts` (lines 45-240) | **PASS** |
| **PROV-R-012** | OpenAI API key & configuration check | `src/services/providers/openaiProvider.ts` (lines 15-25) | **PASS** |
| **PROV-R-013** | OpenAI credential states (available vs not_configured) | `src/services/providers/openaiProvider.ts` (lines 22-26) | **PASS** |
| **PROV-R-014** | OpenAI preview error handling & graceful reporting | `src/services/providers/openaiProvider.ts` (lines 250-290) | **PASS** |
| **PROV-R-015** | OpenAI branding strictly "OpenAI TTS", never called "Free" | `src/services/providers/openaiProvider.ts`, `translations.ts` | **PASS** |
| **PROV-R-016** | Google Translate TTS abstraction (`google_translate`, `gtts`) | `src/services/providers/googleProvider.ts` | **PASS** |
| **PROV-R-017** | Google Translate TTS clarity (NOT Google Cloud, WaveNet, Neural2) | `src/services/providers/googleProvider.ts` (lines 10-15) | **PASS** |
| **PROV-R-018** | Google Translate language-based naming, no fake personal names | `src/services/providers/googleProvider.ts` (lines 40-120) | **PASS** |
| **PROV-R-019** | Google Translate capabilities: speed/pitch limited | `src/services/providers/googleProvider.ts` (lines 25-35) | **PASS** |
| **PROV-R-020** | Google Translate preview handling with graceful failure | `src/services/providers/googleProvider.ts` (lines 130-160) | **PASS** |
| **PROV-R-021** | Local models isolated strictly to 3 | `src/services/providers/localProvider.ts` | **PASS** |
| **PROV-R-022** | Clone provider abstraction (`clone`, `local_clone`) | `src/services/providers/cloneProvider.ts` | **PASS** |
| **PROV-R-023** | Voice source taxonomy: sourceType, provider, engine, availability | `src/types/ui.ts` (lines 26-36) | **PASS** |
| **PROV-R-024** | Filter Order: Ngôn ngữ → Vùng / Accent → Nguồn → Phong cách → Giới tính → Tuổi | `src/components/modals/VoiceSelectionModal.tsx` | **PASS** |
| **PROV-R-025** | Filter "Nguồn" Label I18N (VI: "Nguồn", EN: "Source") | `src/i18n/translations.ts` (`sourceFilterLabel`) | **PASS** |
| **PROV-R-026** | Source Dropdown zero search input | `src/components/modals/VoiceSelectionModal.tsx` (lines 820-890) | **PASS** |
| **PROV-R-027** | Source Dropdown grouped structure (All, ONLINE, LOCAL, MY VOICES) | `src/components/modals/VoiceSelectionModal.tsx` (lines 825-885) | **PASS** |
| **PROV-R-028** | Source Dropdown options localization | `src/i18n/translations.ts` (`sourceEdge`, `sourceOpenAi`, etc.) | **PASS** |
| **PROV-R-029** | Filter "Nguồn" default state ("all") | `src/components/modals/VoiceSelectionModal.tsx` | **PASS** |
| **PROV-R-030** | Filter "Nguồn" reset behavior in handleResetFilters | `src/components/modals/VoiceSelectionModal.tsx` | **PASS** |
| **PROV-R-031** | Source filtering logical AND in filteredVoices | `src/components/modals/VoiceSelectionModal.tsx` (lines 365-380) | **PASS** |
| **PROV-R-032** | Source = Edge TTS filtering condition | `src/components/modals/VoiceSelectionModal.tsx` (line 368) | **PASS** |
| **PROV-R-033** | Source = OpenAI TTS filtering condition | `src/components/modals/VoiceSelectionModal.tsx` (line 370) | **PASS** |
| **PROV-R-034** | Source = Google TTS filtering condition | `src/components/modals/VoiceSelectionModal.tsx` (line 372) | **PASS** |
| **PROV-R-035** | Source = Local filtering condition | `src/components/modals/VoiceSelectionModal.tsx` (line 374) | **PASS** |
| **PROV-R-036** | Source = Clone filtering condition | `src/components/modals/VoiceSelectionModal.tsx` (line 376) | **PASS** |
| **PROV-R-037** | Provider Badges distinct per engine/provider (`Edge`, `OpenAI`, `Google`, `Local`, `Clone`) | `src/components/modals/VoiceSelectionModal.tsx` (`renderProviderBadge`) | **PASS** |
| **PROV-R-038** | No generic "Online" for online voices | `src/components/modals/VoiceSelectionModal.tsx` (lines 1250-1260) | **PASS** |
| **PROV-R-039** | Clean metadata line: provider badge NOT inside metadata string | `src/components/modals/VoiceSelectionModal.tsx` (lines 1228, 1255) | **PASS** |
| **PROV-R-040** | Unified Audio Preview without voice selection or closing modal | `src/components/modals/VoiceSelectionModal.tsx` (`handleTogglePlay`) | **PASS** |
| **PROV-R-041** | Preview loading & failure isolation | `src/components/modals/VoiceSelectionModal.tsx` (lines 460-495) | **PASS** |
| **PROV-R-042** | Preview unconfigured OpenAI voice graceful warning | `src/components/modals/VoiceSelectionModal.tsx` (line 467) | **PASS** |
| **PROV-R-043** | Stop preview restores idle state and cancels audio | `src/components/modals/VoiceSelectionModal.tsx` (lines 447-453) | **PASS** |
| **PROV-R-044** | Full I18N purity across all UI locales | `src/i18n/translations.ts` (VI, EN, JA, ZH) | **PASS** |

## Verification Suite Summary
- **Compilation**: `npx tsc --noEmit` exited with code 0.
- **Production Bundle**: `npm run build` succeeded in 1.05s without warnings.
- **DevTools Runtime**: Verified across 14 manual/automated test cases covering dropdown groupings, zero-search input, filter order, provider badges, preview isolation, and responsive layout across 1920x1080, 1440x900, 1024x700 viewports.
