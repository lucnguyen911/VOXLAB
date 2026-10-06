import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  remapTimestampToOriginal,
  remapWhisperOutputToOriginalTimeline,
  remapSpeechUnitsToOriginalTimeline,
} from "../timing";
import { WhisperSegment, WhisperWord, SpeechUnit } from "../types";
import {
  getSubtitleProfile,
  loadSubtitleSettings,
  saveSubtitleSettings,
} from "../profiles";
import { generateSubtitlesFromText } from "../pipeline";
import {
  searchLanguages,
  getLocalizedLanguageName,
  WHISPER_AUDIO_LANGUAGES,
  TRANSLATION_TARGET_LANGUAGES,
} from "../languages";
import {
  TranslationManager,
  GoogleTranslateProvider,
  GeminiTranslateProvider,
  DeepSeekTranslateProvider,
  LmStudioTranslateProvider,
} from "../../translation";

describe("Subtitle & Translation Settings Verification Suite (Cases 1 - 16)", () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => mockStorage[k] || null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = String(v);
      },
      removeItem: (k: string) => {
        delete mockStorage[k];
      },
      clear: () => {
        mockStorage = {};
      },
      key: () => null,
      length: 0,
    };
  });

  // CASE 1 — ASR 1.0x
  it("CASE 1: ASR 1.0x maintains exact timestamps without alteration", () => {
    const originalSec = 45.25;
    const remapped = remapTimestampToOriginal(originalSec, 1.0);
    assert.equal(remapped, 45.25, "1.0x must preserve exact timestamp");

    const segments: WhisperSegment[] = [
      { id: 1, startSec: 10.0, endSec: 15.0, text: "Câu thử nghiệm." },
    ];
    const out = remapWhisperOutputToOriginalTimeline(segments, 1.0);
    assert.equal(out[0].startSec, 10.0);
    assert.equal(out[0].endSec, 15.0);
  });

  // CASE 2 — ASR 0.9x
  it("CASE 2: ASR 0.9x accurately remaps processed timestamps to original timeline", () => {
    const speed = 0.9;
    // Processed 10.0s on 0.9x audio -> original = 10.0 * 0.9 = 9.0s
    const processedSec = 10.0;
    const remapped = remapTimestampToOriginal(processedSec, speed);
    assert.equal(remapped, 9.0);

    const segments: WhisperSegment[] = [
      { id: 1, startSec: 20.0, endSec: 30.0, text: "Giọng nói bài giảng nhanh." },
    ];
    const out = remapWhisperOutputToOriginalTimeline(segments, speed);
    assert.equal(out[0].startSec, 18.0); // 20 * 0.9
    assert.equal(out[0].endSec, 27.0); // 30 * 0.9
  });

  // CASE 3 — ASR 0.8x
  it("CASE 3: ASR 0.8x satisfies hard requirement: original_time = processed_time * 0.8", () => {
    const speed = 0.8;
    // Spec example: processed timestamp = 50.000s -> original = 50 * 0.8 = 40.000s
    const processedSec = 50.0;
    const originalSec = remapTimestampToOriginal(processedSec, speed);
    assert.equal(originalSec, 40.0, "50.0s at 0.8x must remap exactly to 40.0s");

    const segments: WhisperSegment[] = [
      {
        id: 1,
        startSec: 50.0,
        endSec: 75.0,
        text: "Tin tức thể thao tốc độ cao.",
      },
    ];
    const out = remapWhisperOutputToOriginalTimeline(segments, speed);
    assert.equal(out[0].startSec, 40.0); // 50 * 0.8
    assert.equal(out[0].endSec, 60.0); // 75 * 0.8 (Original 60s audio!)
  });

  // CASE 4 — WORD TIMING
  it("CASE 4: Word level timestamps are mapped to original timeline in lockstep with segments", () => {
    const speed = 0.8;
    const words: WhisperWord[] = [
      { word: "Xin", startSec: 10.0, endSec: 10.5, confidence: 0.95 },
      { word: "chào", startSec: 10.6, endSec: 11.2, confidence: 0.98 },
    ];
    const segments: WhisperSegment[] = [
      { id: 1, startSec: 10.0, endSec: 11.2, text: "Xin chào", words },
    ];

    const out = remapWhisperOutputToOriginalTimeline(segments, speed);
    assert.equal(out[0].startSec, 8.0); // 10.0 * 0.8
    assert.equal(out[0].endSec, 8.96); // 11.2 * 0.8
    assert.ok(out[0].words);
    assert.equal(out[0].words[0].startSec, 8.0); // 10.0 * 0.8
    assert.equal(out[0].words[0].endSec, 8.4); // 10.5 * 0.8
    assert.equal(out[0].words[1].startSec, 8.48); // 10.6 * 0.8
    assert.equal(out[0].words[1].endSec, 8.96); // 11.2 * 0.8
  });

  // CASE 5 — LONG AUDIO
  it("CASE 5: Long audio timestamp scaling has zero cumulative drift", () => {
    const speed = 0.8;
    // 1 hour = 3600 seconds. Processed at 0.8x = 4500 seconds.
    const processedHour = 4500.0;
    const originalHour = remapTimestampToOriginal(processedHour, speed);
    assert.equal(originalHour, 3600.0, "1 hour timeline mapping must be exact");

    // Continuous checks across thousands of seconds
    for (let s = 0; s <= 3600; s += 300) {
      const processed = s / speed;
      const mapped = remapTimestampToOriginal(processed, speed);
      assert.ok(Math.abs(mapped - s) <= 0.001, `Drift exceeded at ${s}s`);
    }
  });

  // CASE 6 — VIDEO DURATION MATCH
  it("CASE 6: Video speech units retain duration consistency after timeline remapping", () => {
    const speed = 0.8;
    const units: SpeechUnit[] = [
      { id: 1, text: "Video demo", startSec: 12.5, endSec: 15.0, durationSec: 2.5 },
    ];
    const remapped = remapSpeechUnitsToOriginalTimeline(units, speed);
    assert.equal(remapped[0].startSec, 10.0); // 12.5 * 0.8
    assert.equal(remapped[0].endSec, 12.0); // 15.0 * 0.8
    assert.equal(remapped[0].durationSec, 2.0); // 12.0 - 10.0 = 2.0s
  });

  // CASE 7 — PROCESSING SPEED PRESETS
  it("CASE 7: Processing speed presets map cleanly without crashes", () => {
    const speeds = ["auto", "1x", "2x", "4x", "8x"] as const;
    for (const sp of speeds) {
      saveSubtitleSettings({ processingSpeed: sp });
      const loaded = loadSubtitleSettings();
      assert.equal(loaded.processingSpeed, sp);
    }
  });

  // CASE 8 — ASPECT RATIO ADAPTATION
  it("CASE 8: Aspect ratio correctly adapts layout profile limits", () => {
    const p16_9 = getSubtitleProfile("16:9");
    const p9_16 = getSubtitleProfile("9:16");
    const p1_1 = getSubtitleProfile("1:1");

    assert.equal(p16_9.maxWidth, 40);
    assert.equal(p9_16.maxWidth, 26);
    assert.equal(p1_1.maxWidth, 34);

    // 16:9 capacity > 1:1 capacity > 9:16 capacity
    assert.ok(p16_9.maxWidth > p1_1.maxWidth);
    assert.ok(p1_1.maxWidth > p9_16.maxWidth);
  });

  // CASE 9 — MAX LINES
  it("CASE 9: Max lines setting adapts profile and segmentation capacity", () => {
    const p1Line = getSubtitleProfile("16:9", 1);
    const p2Lines = getSubtitleProfile("16:9", 2);

    assert.equal(p1Line.maxLines, 1);
    assert.equal(p2Lines.maxLines, 2);

    const text =
      "Chào mừng các bạn đã quay trở lại với series sản xuất nội dung âm thanh VoxLab. Hôm nay chúng ta sẽ thử nghiệm.";

    const cues1Line = generateSubtitlesFromText(text, { aspectRatio: "16:9", maxLines: 1 });
    const cues2Lines = generateSubtitlesFromText(text, { aspectRatio: "16:9", maxLines: 2 });

    // 1-line mode must segment into equal or more cues because capacity per cue is halved
    assert.ok(
      cues1Line.length >= cues2Lines.length,
      `1-line cues (${cues1Line.length}) should be >= 2-line cues (${cues2Lines.length})`
    );
  });

  // CASE 10 — GOOGLE TRANSLATION
  it("CASE 10: GoogleTranslateProvider correctly instantiates and provides translation capability", () => {
    const google = new GoogleTranslateProvider();
    assert.equal(google.id, "google");
    assert.equal(google.badge, "Online");
    assert.equal(typeof google.translate, "function");
  });

  // CASE 11 — GEMINI PROVIDER
  it("CASE 11: Gemini provider handles missing key gracefully without crashing", async () => {
    const gemini = new GeminiTranslateProvider("");
    const test = await gemini.testConnection();
    assert.equal(test.ok, false);
    assert.ok(test.message?.includes("Chưa cấu hình Gemini API Key"));

    // Translation without key returns original text safely
    const translated = await gemini.translate("Xin chào", "en");
    assert.equal(translated, "Xin chào");
  });

  // CASE 12 — DEEPSEEK PROVIDER
  it("CASE 12: DeepSeek provider handles missing key gracefully without crashing", async () => {
    const deepseek = new DeepSeekTranslateProvider("");
    const test = await deepseek.testConnection();
    assert.equal(test.ok, false);
    assert.ok(test.message?.includes("Chưa cấu hình DeepSeek API Key"));

    const translated = await deepseek.translate("Xin chào", "en");
    assert.equal(translated, "Xin chào");
  });

  // CASE 13 — LM STUDIO PROVIDER
  it("CASE 13: LM Studio local provider conforms to OpenAI-compatible interface", () => {
    const lm = new LmStudioTranslateProvider("http://localhost:1234/v1", "qwen2.5-7b");
    assert.equal(lm.id, "lmstudio");
    assert.equal(lm.badge, "Local");
    assert.equal(lm.endpoint, "http://localhost:1234/v1");
  });

  // CASE 14 — LM STUDIO OFFLINE ERROR HANDLING
  it("CASE 14: LM Studio offline returns clean actionable error and does NOT crash", async () => {
    // Unreachable dummy local port
    const lm = new LmStudioTranslateProvider("http://127.0.0.1:54321/v1", "test-model");
    const test = await lm.testConnection();
    assert.equal(test.ok, false);
    assert.ok(test.message?.includes("Không thể kết nối tới model dịch"));
  });

  // CASE 15 — CUSTOM PROVIDER ADDITION & PERSISTENCE
  it("CASE 15: Custom provider can be added, persisted and retrieved via TranslationManager", () => {
    const manager = TranslationManager.getInstance();
    const created = manager.addCustomModel({
      name: "Local vLLM Server",
      type: "openai_compatible",
      endpoint: "http://localhost:8000/v1",
      model: "mistral-7b",
    });

    assert.ok(created.id.startsWith("custom_"));
    assert.equal(created.name, "Local vLLM Server");

    const all = manager.listProviders();
    const found = all.find((p) => p.id === created.id);
    assert.ok(found, "Custom model must be present in provider list");
    assert.equal(found.displayName, "Local vLLM Server");

    // Clean up
    manager.deleteCustomModel(created.id);
    const afterDelete = manager.listProviders();
    assert.ok(!afterDelete.find((p) => p.id === created.id));
  });

  // CASE 16 — LANGUAGE SEARCH
  it("CASE 16: Language search matches Vietnamese, Japanese, Arabic, Spanish correctly", () => {
    const matchVi = searchLanguages("Vietnamese", WHISPER_AUDIO_LANGUAGES);
    assert.ok(matchVi.some((l) => l.code === "vi"), "Should match Vietnamese by English name");

    const matchJa = searchLanguages("Japanese", WHISPER_AUDIO_LANGUAGES);
    assert.ok(matchJa.some((l) => l.code === "ja"), "Should match Japanese");

    const matchAr = searchLanguages("Arabic", WHISPER_AUDIO_LANGUAGES);
    assert.ok(matchAr.some((l) => l.code === "ar"), "Should match Arabic");

    const matchEs = searchLanguages("Spanish", WHISPER_AUDIO_LANGUAGES);
    assert.ok(matchEs.some((l) => l.code === "es"), "Should match Spanish");

    const matchCode = searchLanguages("ko", TRANSLATION_TARGET_LANGUAGES);
    assert.ok(matchCode.some((l) => l.code === "ko"), "Should match Korean by code");
  });

  // CASE 17 — LOCALIZED LANGUAGE NAMES ACCORDING TO UI LANGUAGE
  it("CASE 17: Localized language names dynamically adapt to UI language", () => {
    // Vietnamese UI
    assert.equal(getLocalizedLanguageName("en", "vi"), "Tiếng Anh");
    assert.equal(getLocalizedLanguageName("ja", "vi"), "Tiếng Nhật");
    assert.equal(getLocalizedLanguageName("zh", "vi"), "Tiếng Trung Giản thể");
    assert.equal(getLocalizedLanguageName("zh-TW", "vi"), "Tiếng Trung Phồn thể");
    assert.equal(getLocalizedLanguageName("auto", "vi"), "Tự động phát hiện");

    // English UI
    assert.equal(getLocalizedLanguageName("vi", "en"), "Vietnamese");
    assert.equal(getLocalizedLanguageName("en", "en"), "English");
    assert.equal(getLocalizedLanguageName("ja", "en"), "Japanese");
    assert.equal(getLocalizedLanguageName("zh", "en"), "Simplified Chinese");
    assert.equal(getLocalizedLanguageName("auto", "en"), "Auto Detect");

    // Chinese UI
    assert.equal(getLocalizedLanguageName("vi", "zh"), "越南语");
    assert.equal(getLocalizedLanguageName("en", "zh"), "英语");
    assert.equal(getLocalizedLanguageName("ja", "zh"), "日语");
    assert.equal(getLocalizedLanguageName("zh", "zh"), "简体中文");
    assert.equal(getLocalizedLanguageName("auto", "zh"), "自动检测");

    // Japanese UI
    assert.equal(getLocalizedLanguageName("vi", "ja"), "ベトナム語");
    assert.equal(getLocalizedLanguageName("en", "ja"), "英語");
    assert.equal(getLocalizedLanguageName("ja", "ja"), "日本語");
    assert.equal(getLocalizedLanguageName("auto", "ja"), "自動検出");
  });
});
