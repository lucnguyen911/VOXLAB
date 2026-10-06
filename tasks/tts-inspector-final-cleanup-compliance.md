# TTS INSPECTOR FINAL CLEANUP & PROCESSING SPEED UX — COMPLIANCE MATRIX

**Generated Date**: 2026-09-12T19:10:00+07:00  
**Status**: READY  
**Scope**: TTS Inspector Final Cleanup, Voice Settings Simplification & Processing Speed Concurrency  

---

## Compliance Matrix

| Requirement | Status | Code Evidence | Runtime Evidence |
| :--- | :--- | :--- | :--- |
| **SPEC-01: Remove "Sắc thái" entirely** | **PASS** | `src/components/inspector/TtsInspector.tsx`: "Sắc thái" section, emotion dropdown, and emotion state completely removed. No replacement control at this position. | DevTools evaluation: `hasSacThai === false`. Inspecting Inspector DOM reveals zero emotion/style controls. |
| **SPEC-02: Voice Card Metadata Simplification** | **PASS** | `src/components/inspector/TtsInspector.tsx`: Reduced metadata to max 2 short items: `<CountryFlag ... /> <span>{langInfo.name}</span> · <span>{accentOrTag}</span>`. | Runtime screenshot at 1920, 1440, 1024px: Voice card shows `🇻🇳 Tiếng Việt · vi-north` with `Đổi giọng >` and zero ellipsis overflow. |
| **SPEC-03: Model directly below Voice Card** | **PASS** | `src/components/inspector/TtsInspector.tsx`: Model selector directly follows Voice card in logical group, followed by subtle divider `border-t border-borderDefault/60 pt-1`. | Visual DOM hierarchy confirmed: GIỌNG ĐỌC -> MODEL -> Divider -> CÀI ĐẶT. |
| **SPEC-04: Unified CÀI ĐẶT Group without Slider Cards** | **PASS** | `src/components/inspector/TtsInspector.tsx`: Speed, Pitch, Volume grouped in `space-y-3.5`. Outer wrapper card boxes (`bg-surface2/40 border p-3 rounded-lg`) removed. | DevTools evaluation: `slidersCount === 3`, `containerClasses === "space-y-3.5"`, zero individual slider cards. |
| **SPEC-05: Relocate Reset button inline with CÀI ĐẶT** | **PASS** | `src/components/inspector/TtsInspector.tsx`: Header has `<label>CÀI ĐẶT</label>` and `<button title="Đặt lại cài đặt giọng"><RotateCcw /> Đặt lại</button>`. Bottom footer removed completely. | DevTools evaluation: `resetButtonText === "Đặt lại"`, footer element eliminated. Clicking resets speed=1, pitch=1, volume=1. |
| **SPEC-06: Lighten "Ngắt nghỉ" (No nested cards)** | **PASS** | `src/components/inspector/TtsInspector.tsx`: 2-column grid (`grid grid-cols-2 gap-3`), individual punctuation card wrappers removed. Only inputs have borders (`border border-borderDefault rounded-lg px-2`). | Runtime inspection: 4 clean input fields with `giây` suffix, inter-sentence pause slider at 400ms. No card-in-card visual noise. |
| **SPEC-07: Accordion Headers Styling** | **PASS** | `src/components/inspector/TtsInspector.tsx`: Header buttons have transparent background with `hover:bg-surface2/40`, `focus-visible:ring-1`, and dynamic rotating chevron (`rotate-90`). | Verified normal state has no black/heavy border. Hover and focus states work cleanly. |
| **SPEC-08: NÂNG CAO Collapsed by Default** | **PASS** | `src/components/inspector/TtsInspector.tsx`: `isAdvancedOpen` initialized to `false`. | Verified upon fresh load / reload: NÂNG CAO and NGẮT NGHỈ are collapsed. Expanding displays content smoothly. |
| **SPEC-09: Processing Speed Terminology** | **PASS** | `src/i18n/translations.ts`: Replaced "Xử lý song song (Batch)" with `processingSpeed: "Tốc độ xử lý"` (EN: "Processing speed", JA: "処理速度", ZH: "处理速度"). | DevTools inspection: label displayed is "Tốc độ xử lý". Old string "Xử lý song song" is completely gone. |
| **SPEC-10: Processing Speed Options** | **PASS** | `src/i18n/translations.ts`, `src/components/inspector/TtsInspector.tsx`: Options are `1x · Mặc định`, `2x · Nhanh`, `3x · Hiệu suất cao`, `4x · Tối đa`. | Select options verified: values `[1, 2, 3, 4]` with localized labels. |
| **SPEC-11: Remove duplicate badge** | **PASS** | `src/components/inspector/TtsInspector.tsx`: `[2 luồng]` badge completely removed. | DevTools evaluation: `hasTwoLuongBadge === false`. |
| **SPEC-12: Backend Mapping (1x -> 1, 2x -> 2, 3x -> 3, 4x -> 4)** | **PASS** | `src/services/concurrencyExecutor.ts`, `src/views/TtsWorkspace.tsx`: Value mapped directly to `concurrency` integer `[1, 2, 3, 4]`. | Runtime telemetry verified via DevTools: `concurrencyLevel` matches selected integer. |
| **SPEC-13: 3x Real Concurrency Execution** | **PASS** | `src/services/concurrencyExecutor.ts`: Worker pool dynamically instantiates `Math.min(concurrency, items.length)` concurrent workers. | DevTools verification: `test3x` produced `concurrencyLevel: 3, maxObservedActive: 3, completedCount: 7, pass: true`. |
| **SPEC-14: Real Concurrency 1x, 2x, 4x Execution** | **PASS** | `src/services/concurrencyExecutor.ts`: Concurrency pool strictly limits in-flight tasks. | DevTools verification: `test1x` max active = 1; `test2x` max active = 2; `test4x` max active = 4. 100% real queue concurrency. |
| **SPEC-15: Default Concurrency = 1x** | **PASS** | `DEFAULT_TTS_SETTINGS.concurrency = 1`. Legacy value 8 clamped to 4. | Default select value is `1` (`1x · Mặc định`). |
| **SPEC-16: Honest Helper Text (No fake VRAM, No "4x faster")** | **PASS** | `src/i18n/translations.ts`: "Tăng mức xử lý sẽ render nhiều đoạn đồng thời và sử dụng thêm VRAM. Tốc độ thực tế phụ thuộc model, GPU và nội dung." | Verified no hardcoded GB numbers and no claim that 4x equals 4 times faster. |
| **SPEC-17: Settings Persistence (`localStorage`)** | **PASS** | `STORAGE_KEY = "voxlab_tts_settings"`: Persists `speed`, `pitch`, `volume`, `pauses`, `sentencePauseMs`, `concurrency`. | DevTools verified: `localStorage.getItem("voxlab_tts_settings")` correctly updates on change and reset. |
| **SPEC-18: Responsive Layout (1920x1080, 1440x900, 1024x700)** | **PASS** | Viewport resizing handled with flexbox layout and preserved vertical rhythm. | Verified at 1920x1080, 1440x900, and 1024x700 via Chrome DevTools screenshots with 0 horizontal overflow. |
| **SPEC-19: Light and Dark Theme Support** | **PASS** | Styled with theme tokens (`bg-panel`, `bg-surface1`, `border-borderDefault`, `text-textPrimary`, etc.). | Both Light and Dark modes inspected visually via DevTools. All borders, controls, and text contrast are sharp and clear. |
| **SPEC-20: Keyboard Accessibility** | **PASS** | TabIndex, ARIA roles, enter/space handlers, and labels attached to all buttons, selects, and inputs. | Tested: `resetBtnFocusable: true`, `pausesBtnFocusable: true`, `advancedBtnFocusable: true`, `processingSelectFocusable: true`. |
| **SPEC-21: Zero Regressions** | **PASS** | Single chunk regeneration, batch invalid regeneration, voice modal, model selector, export validation intact. | Verified via UI interactions and compilation checks. |
| **SPEC-22: TypeScript & Production Build** | **PASS** | `npx tsc --noEmit` and `npm run build` executed cleanly. | `tsc` passed with 0 errors; `vite build` completed in 1.04s. |
