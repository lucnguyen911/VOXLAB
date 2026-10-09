import {
  TranslationProvider,
  TranslationStyle,
  TranslationContext,
  CustomTranslationModel,
} from "./types";
import { GoogleTranslateProvider } from "./providers/google";
import { GeminiTranslateProvider } from "./providers/gemini";
import { DeepSeekTranslateProvider } from "./providers/deepseek";
import { LmStudioTranslateProvider } from "./providers/lmstudio";
import { OllamaTranslateProvider } from "./providers/ollama";
import {
  loadTranslationSettings,
  saveTranslationSettings,
} from "./settings";
import { SubtitleCue } from "../subtitle/types";
import { OriginalCue, TranslatedCue } from "../../types/dubbing";
import { validateTranslationResponse1to1 } from "./validator";
import { adaptCueToCinemaStyle } from "./cinemaAdaptation";

export class TranslationManager {
  private static instance: TranslationManager;

  private builtInProviders: Map<string, TranslationProvider> = new Map();

  private constructor() {
    this.initBuiltIn();
  }

  static getInstance(): TranslationManager {
    if (!TranslationManager.instance) {
      TranslationManager.instance = new TranslationManager();
    }
    return TranslationManager.instance;
  }

  private initBuiltIn() {
    this.builtInProviders.set("google", new GoogleTranslateProvider());
    this.builtInProviders.set("lmstudio", new LmStudioTranslateProvider());
    this.builtInProviders.set("ollama", new OllamaTranslateProvider());
    this.builtInProviders.set("gemini", new GeminiTranslateProvider());
    this.builtInProviders.set("deepseek", new DeepSeekTranslateProvider());
  }

  /**
   * Returns all available providers, combining built-in and user-added custom models.
   * Reads strictly from TranslationSettings (TASK-08).
   */
  listProviders(): TranslationProvider[] {
    const list: TranslationProvider[] = Array.from(this.builtInProviders.values());

    const settings = loadTranslationSettings();
    if (settings.customModels && Array.isArray(settings.customModels)) {
      for (const custom of settings.customModels) {
        const customProvider = new LmStudioTranslateProvider(
          custom.endpoint,
          custom.model,
          custom.apiKey,
          custom.id,
          custom.name
        );
        customProvider.badge = custom.type === "lmstudio" ? "Local" : "API";
        customProvider.description = `${custom.endpoint} (${custom.model})`;
        list.push(customProvider);
      }
    }

    return list;
  }

  /**
   * Retrieves a specific provider by ID.
   */
  getProvider(id: string): TranslationProvider {
    const all = this.listProviders();
    const found = all.find((p) => p.id === id);
    const settings = loadTranslationSettings();

    const provider = found || this.builtInProviders.get("google") || new GoogleTranslateProvider();

    if (provider.id === "gemini" && settings.geminiApiKey) {
      (provider as GeminiTranslateProvider).apiKey = settings.geminiApiKey;
    }
    if (provider.id === "deepseek" && settings.deepseekApiKey) {
      (provider as DeepSeekTranslateProvider).apiKey = settings.deepseekApiKey;
    }

    return provider;
  }

  /**
   * Adds and persists a new custom translation model into TranslationSettings.
   */
  addCustomModel(model: Omit<CustomTranslationModel, "id" | "createdAt">): CustomTranslationModel {
    const id = `custom_${Date.now()}`;
    const newEntry: CustomTranslationModel = {
      ...model,
      id,
      createdAt: Date.now(),
    };

    const current = loadTranslationSettings();
    const existing = current.customModels || [];
    saveTranslationSettings({
      customModels: [...existing, newEntry],
      translationProviderId: id, // Automatically switch to newly added model
    });

    return newEntry;
  }

  /**
   * Removes a custom model by ID from TranslationSettings.
   */
  deleteCustomModel(id: string): void {
    const current = loadTranslationSettings();
    const filtered = (current.customModels || []).filter((m) => m.id !== id);
    const newActive =
      current.translationProviderId === id ? "google" : current.translationProviderId;

    saveTranslationSettings({
      customModels: filtered,
      translationProviderId: newActive,
    });
  }

  /**
   * Translates an array of immutable OriginalCues into TranslatedCues.
   * HARD INVARIANT (TASK-09):
   * 1. 1:1 mapping is strictly validated.
   * 2. Timestamps and index are strictly preserved from OriginalCue.
   * 3. Rejects response if count or timestamps mismatch.
   */
  async translateOriginalCues(
    cues: OriginalCue[],
    targetLang: string,
    providerId?: string,
    onProgress?: (done: number, total: number) => void,
    style?: TranslationStyle,
    options?: {
      sourceLang?: string;
      isPaused?: () => boolean;
      isCancelled?: () => boolean;
      /** Batch: a provider failure fails the call instead of keeping the source text. */
      strict?: boolean;
    }
  ): Promise<TranslatedCue[]> {
    if (!cues || cues.length === 0) return [];

    const activeSettings = loadTranslationSettings();
    const activeId = providerId || activeSettings.translationProviderId || "google";
    const activeStyle: TranslationStyle = style || activeSettings.translationStyle || "default";
    const activeSourceLang = options?.sourceLang || activeSettings.sourceLanguage || "auto";
    const provider = this.getProvider(activeId);

    const translatedCues: TranslatedCue[] = [];
    const total = cues.length;

    for (let i = 0; i < total; i++) {
      if (options?.isCancelled?.()) {
        break;
      }

      while (options?.isPaused?.() && !options?.isCancelled?.()) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      if (options?.isCancelled?.()) {
        break;
      }

      const cue = cues[i];
      let translatedText = cue.text;

      // Extract conversational scene context: 3 preceding cues and 3 upcoming cues
      const prevCues = cues.slice(Math.max(0, i - 3), i);
      const nextCues = cues.slice(i + 1, i + 4);
      const durationSec = Number((cue.endSec - cue.startSec).toFixed(3));

      const context: TranslationContext = {
        style: activeStyle,
        cue,
        prevCues,
        nextCues,
        durationSec,
        allCues: cues,
        cueIndex: i,
      };

      try {
        const result = await provider.translate(cue.text, targetLang, activeSourceLang, context);
        if (result && result.trim()) {
          translatedText = result.trim();
        }
      } catch (err: any) {
        // If primary provider (LM Studio, Ollama, etc.) fails, attempt fallback to Google Translate so cues are actually translated
        let fallbackSucceeded = false;
        if (provider.id !== "google") {
          try {
            const googleFallback = this.builtInProviders.get("google") || new GoogleTranslateProvider();
            const fallbackResult = await googleFallback.translate(cue.text, targetLang, activeSourceLang, context);
            if (fallbackResult && fallbackResult.trim()) {
              translatedText = fallbackResult.trim();
              fallbackSucceeded = true;
            }
          } catch (fbErr: any) {
            // fallback also failed
          }
        }

        if (!fallbackSucceeded) {
          if (options?.strict) {
            throw new Error(`Dịch câu #${cue.index} thất bại: ${err?.message || err}`);
          }
          console.warn(`Translation failed for cue #${cue.index}:`, err?.message);
        }
      }

      // If cinema style is active, apply smart adaptation to eliminate overflow and polish dialogue cadence
      if (activeStyle === "cinema") {
        translatedText = adaptCueToCinemaStyle({
          cue,
          prevCues,
          nextCues,
          rawTranslation: translatedText,
          targetLang,
        });
      }

      translatedCues.push({
        index: cue.index,
        startSec: cue.startSec,
        endSec: cue.endSec,
        originalText: cue.text,
        text: translatedText,
        isEdited: false,
      });

      if (onProgress) {
        onProgress(i + 1, total);
      }
    }

    if (options?.isCancelled?.()) {
      return translatedCues;
    }

    // Verify 1:1 invariant before returning
    const validation = validateTranslationResponse1to1(cues, translatedCues);
    if (!validation.valid) {
      throw new Error(`Xác thực 1:1 dịch thuật không hợp lệ: ${validation.errors.join("; ")}`);
    }

    return translatedCues;
  }

  /**
   * Translates an array of legacy SubtitleCues.
   * Preserves timestamps and indices.
   */
  async translateSubtitleCues(
    cues: SubtitleCue[],
    targetLang: string,
    providerId?: string,
    onProgress?: (done: number, total: number) => void
  ): Promise<SubtitleCue[]> {
    if (!cues || cues.length === 0) return [];

    const activeId = providerId || loadTranslationSettings().translationProviderId || "google";
    const provider = this.getProvider(activeId);

    const translatedCues: SubtitleCue[] = [];
    const total = cues.length;

    for (let i = 0; i < total; i++) {
      const cue = cues[i];
      let translatedText = cue.text;

      try {
        const result = await provider.translate(cue.text, targetLang);
        if (result && result.trim()) {
          translatedText = result.trim();
        }
      } catch (err: any) {
        console.warn(`Translation failed for cue #${cue.index}:`, err?.message);
      }

      translatedCues.push({
        ...cue,
        text: translatedText,
      });

      if (onProgress) {
        onProgress(i + 1, total);
      }
    }

    return translatedCues;
  }
}

export const translationManager = TranslationManager.getInstance();
