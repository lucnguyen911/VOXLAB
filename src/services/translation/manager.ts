import {
  TranslationProvider,
  TranslationStyle,
  TranslationContext,
  CustomTranslationModel,
  BatchItem,
  BatchTranslationContext,
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
import {
  OriginalCue,
  TranslatedCue,
  DubbingSpeechGroup,
  DubbingMode,
  normalizeDubbingMode,
} from "../../types/dubbing";
import { validateTranslationResponse1to1 } from "./validator";
import { adaptCueToCinemaStyle } from "./cinemaAdaptation";
import {
  planDubbingSpeechGroups,
  normalizeCueTextForSpeech,
  joinCueTextsForSpeech,
} from "../dubbing/speechPlanner";
import { projectGroupTranslationToCues } from "./groupProjection";
import {
  chunkArrayAdaptive,
  buildGlobalScriptSummary,
} from "./batchTranslationHelper";

export class TranslationManager {
  private static instance: TranslationManager;

  private builtInProviders: Map<string, TranslationProvider> = new Map();
  private lastSpeechGroups: DubbingSpeechGroup[] = [];

  private constructor() {
    this.initBuiltIn();
  }

  static getInstance(): TranslationManager {
    if (!TranslationManager.instance) {
      TranslationManager.instance = new TranslationManager();
    }
    return TranslationManager.instance;
  }

  getLastSpeechGroups(): DubbingSpeechGroup[] {
    return this.lastSpeechGroups;
  }

  private initBuiltIn() {
    this.builtInProviders.set("google", new GoogleTranslateProvider());
    this.builtInProviders.set("lmstudio", new LmStudioTranslateProvider());
    this.builtInProviders.set("ollama", new OllamaTranslateProvider());
    this.builtInProviders.set("gemini", new GeminiTranslateProvider());
    this.builtInProviders.set("deepseek", new DeepSeekTranslateProvider());

    const openaiProvider = new LmStudioTranslateProvider(
      "https://api.openai.com/v1",
      "gpt-4o-mini",
      "",
      "openai",
      "OpenAI GPT",
      60,
      4096,
      "openai"
    );
    openaiProvider.badge = "API";
    openaiProvider.description = "OpenAI GPT (Cloud API)";
    this.builtInProviders.set("openai", openaiProvider);

    const qwenProvider = new LmStudioTranslateProvider(
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      "qwen-turbo",
      "",
      "qwen",
      "Alibaba Qwen",
      60,
      4096,
      "qwen"
    );
    qwenProvider.badge = "API";
    qwenProvider.description = "Alibaba Qwen (Cloud API)";
    this.builtInProviders.set("qwen", qwenProvider);
  }

  private loadRuntimeConfigs(): Record<string, any> {
    if (typeof localStorage === "undefined") return {};
    try {
      const raw = localStorage.getItem("voxlab_provider_configs_v4");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  private syncBuiltInProviderConfig(provider: TranslationProvider): void {
    const settings = loadTranslationSettings();
    const runtimeConfigs = this.loadRuntimeConfigs();
    const cfg = runtimeConfigs[provider.id];

    if (provider.id === "gemini") {
      const p = provider as GeminiTranslateProvider;
      p.apiKey = cfg?.apiKey !== undefined ? cfg.apiKey : (settings.geminiApiKey || p.apiKey);
      if (cfg?.model) p.model = cfg.model;
      if (cfg?.timeout !== undefined) p.timeout = Number(cfg.timeout) || 60;
      if (cfg?.maxTokens !== undefined) p.maxTokens = Number(cfg.maxTokens);
      p.description = `Google Gemini (${p.model || "gemini-1.5-flash"})`;
    } else if (provider.id === "deepseek") {
      const p = provider as DeepSeekTranslateProvider;
      p.apiKey = cfg?.apiKey !== undefined ? cfg.apiKey : (settings.deepseekApiKey || p.apiKey);
      if (cfg?.endpoint) p.endpoint = cfg.endpoint;
      if (cfg?.model) p.model = cfg.model;
      if (cfg?.timeout !== undefined) p.timeout = Number(cfg.timeout) || 60;
      if (cfg?.maxTokens !== undefined) p.maxTokens = Number(cfg.maxTokens);
      p.description = `DeepSeek (${p.model || "deepseek-chat"})`;
    } else if (provider.id === "openai") {
      const p = provider as LmStudioTranslateProvider;
      const legacyOpenAiKey = typeof localStorage !== "undefined" ? localStorage.getItem("voxlab_openai_api_key") || "" : "";
      p.apiKey = cfg?.apiKey !== undefined ? cfg.apiKey : (legacyOpenAiKey || p.apiKey);
      if (cfg?.endpoint) p.endpoint = cfg.endpoint;
      if (cfg?.model) p.model = cfg.model;
      if (cfg?.timeout !== undefined) p.timeout = Number(cfg.timeout) || 60;
      if (cfg?.maxTokens !== undefined) p.maxTokens = Number(cfg.maxTokens);
      p.description = `OpenAI GPT (${p.model || "gpt-4o-mini"})`;
    } else if (provider.id === "qwen") {
      const p = provider as LmStudioTranslateProvider;
      if (cfg?.apiKey !== undefined) p.apiKey = cfg.apiKey;
      if (cfg?.endpoint) p.endpoint = cfg.endpoint;
      if (cfg?.model) p.model = cfg.model;
      if (cfg?.timeout !== undefined) p.timeout = Number(cfg.timeout) || 60;
      if (cfg?.maxTokens !== undefined) p.maxTokens = Number(cfg.maxTokens);
      p.description = `Alibaba Qwen (${p.model || "qwen-turbo"})`;
    } else if (provider.id === "lmstudio") {
      const p = provider as LmStudioTranslateProvider;
      if (cfg?.endpoint) p.endpoint = cfg.endpoint;
      if (cfg?.model) p.model = cfg.model;
      if (cfg?.apiKey !== undefined) p.apiKey = cfg.apiKey;
      if (cfg?.timeout !== undefined) p.timeout = Number(cfg.timeout) || 60;
      if (cfg?.maxTokens !== undefined) p.maxTokens = Number(cfg.maxTokens);
      p.description = `Máy cục bộ • ${p.endpoint} (${p.model || "local-model"})`;
    } else if (provider.id === "ollama") {
      const p = provider as OllamaTranslateProvider;
      if (cfg?.endpoint) p.endpoint = cfg.endpoint;
      if (cfg?.model) p.model = cfg.model;
      if (cfg?.apiKey !== undefined) p.apiKey = cfg.apiKey;
      if (cfg?.timeout !== undefined) p.timeout = Number(cfg.timeout) || 60;
      if (cfg?.maxTokens !== undefined) p.maxTokens = Number(cfg.maxTokens);
      p.description = `Máy cục bộ • ${p.endpoint} (${p.model || "qwen2.5"})`;
    }
  }

  /**
   * Returns all available providers, combining built-in and user-added custom models.
   * Reads strictly from TranslationSettings & runtime configs (TASK-08).
   */
  listProviders(): TranslationProvider[] {
    const list: TranslationProvider[] = Array.from(this.builtInProviders.values());
    for (const builtIn of list) {
      this.syncBuiltInProviderConfig(builtIn);
    }

    const settings = loadTranslationSettings();
    const runtimeConfigs = this.loadRuntimeConfigs();
    if (settings.customModels && Array.isArray(settings.customModels)) {
      for (const custom of settings.customModels) {
        const cfg = runtimeConfigs[custom.id];
        const endpoint = cfg?.endpoint || custom.endpoint;
        const model = cfg?.model || custom.model;
        const apiKey = cfg?.apiKey !== undefined ? cfg.apiKey : custom.apiKey;
        const timeout = cfg?.timeout !== undefined ? Number(cfg.timeout) : (custom.timeout ?? 60);
        const maxTokens = cfg?.maxTokens !== undefined ? Number(cfg.maxTokens) : (custom.maxTokens ?? 4096);

        const customProvider = new LmStudioTranslateProvider(
          endpoint,
          model,
          apiKey,
          custom.id,
          cfg?.name || custom.name,
          timeout,
          maxTokens,
          "custom"
        );
        customProvider.badge = custom.type === "lmstudio" ? "Local" : "API";
        customProvider.description = `${endpoint} (${model})`;
        list.push(customProvider);
      }
    }

    return list;
  }

  /**
   * Retrieves a specific provider by ID with latest runtime settings applied.
   */
  getProvider(id: string): TranslationProvider {
    const all = this.listProviders();
    const found = all.find((p) => p.id === id);
    const provider = found || this.builtInProviders.get("google") || new GoogleTranslateProvider();
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

  private async translateTextWithFallback(
    provider: TranslationProvider,
    rawText: string,
    targetLang: string,
    sourceLang: string,
    context: TranslationContext,
    strict?: boolean,
    label = ""
  ): Promise<string> {
    const normalizedInput = normalizeCueTextForSpeech(rawText);
    if (!normalizedInput) return rawText.trim();

    try {
      const result = await provider.translate(normalizedInput, targetLang, sourceLang, context);
      if (result && result.trim()) {
        return normalizeCueTextForSpeech(result);
      }
    } catch (err: any) {
      let fallbackSucceeded = false;
      if (provider.id !== "google") {
        try {
          const googleFallback =
            this.builtInProviders.get("google") || new GoogleTranslateProvider();
          const fallbackResult = await googleFallback.translate(
            normalizedInput,
            targetLang,
            sourceLang,
            context
          );
          if (fallbackResult && fallbackResult.trim()) {
            fallbackSucceeded = true;
            return normalizeCueTextForSpeech(fallbackResult);
          }
        } catch {
          // fallback also failed
        }
      }

      if (!fallbackSucceeded) {
        if (strict) {
          throw new Error(`Dịch ${label} thất bại: ${err?.message || err}`);
        }
        console.warn(`Translation failed for ${label}:`, err?.message);
      }
    }

    return normalizedInput;
  }

  /**
   * Translates an array of immutable OriginalCues into TranslatedCues.
   * HARD INVARIANT (TASK-09):
   * 1. 1:1 mapping is strictly validated.
   * 2. Timestamps and index are strictly preserved from OriginalCue.
   * 3. Display line breaks (\n) are stripped before translation so phrases are never split mid-line.
   * 4. In sentence_group mode (default), complete sentences are translated together for natural grammar
   *    and projected back onto constituent cues along grammatical phrase boundaries.
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
      dubbingMode?: DubbingMode;
      useSpeechGroups?: boolean;
    }
  ): Promise<TranslatedCue[]> {
    if (!cues || cues.length === 0) {
      this.lastSpeechGroups = [];
      return [];
    }

    const activeSettings = loadTranslationSettings();
    const activeId = providerId || activeSettings.translationProviderId || "google";
    const activeStyle: TranslationStyle = style || activeSettings.translationStyle || "default";
    const activeSourceLang = options?.sourceLang || activeSettings.sourceLanguage || "auto";
    const provider = this.getProvider(activeId);

    const dubbingMode = normalizeDubbingMode(options?.dubbingMode);
    const useGroups =
      options?.useSpeechGroups !== undefined
        ? options.useSpeechGroups
        : true;

    const cuePosByIndex = new Map<number, number>();
    for (let i = 0; i < cues.length; i++) {
      cuePosByIndex.set(cues[i].index, i);
    }

    const plannedGroups = planDubbingSpeechGroups(cues);
    const translatedCues: TranslatedCue[] = [];
    const updatedGroups: DubbingSpeechGroup[] = [];
    const total = cues.length;
    let completedCues = 0;

    if (!useGroups) {
      // Mode 1 (cue_strict): 1:1 per-cue translation with display \n stripped
      const groupByCueIdx = new Map<number, DubbingSpeechGroup>();
      for (const g of plannedGroups) {
        for (const id of g.sourceCueIds) groupByCueIdx.set(id, g);
      }

      const canBatch = typeof provider.translateBatch === "function";
      const batches = canBatch ? chunkArrayAdaptive(cues) : cues.map((c) => [c]);
      const globalSummary =
        canBatch && batches.length > 1
          ? buildGlobalScriptSummary(cues.map((c) => c.text))
          : undefined;
      let prevLines: { source: string; translated: string }[] = [];

      for (const batch of batches) {
        if (options?.isCancelled?.()) break;
        while (options?.isPaused?.() && !options?.isCancelled?.()) {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        if (options?.isCancelled?.()) break;

        let batchResults: Map<number, string> | null = null;
        if (canBatch && batch.length > 1) {
          try {
            const items: BatchItem[] = batch.map((c) => ({
              id: c.index,
              text: normalizeCueTextForSpeech(c.text),
            }));
            const batchContext: BatchTranslationContext = {
              isFullScriptSinglePass: batches.length === 1,
              globalSummary,
              prevLines: prevLines.length > 0 ? prevLines : undefined,
              dubbingMode,
            };
            batchResults = await provider.translateBatch!(
              items,
              targetLang,
              activeSourceLang,
              activeStyle,
              batchContext
            );
          } catch (e) {
            console.warn("Batch translation error, falling back to per-cue:", e);
          }
        }

        const currentBatchPairs: { source: string; translated: string }[] = [];

        for (let b = 0; b < batch.length; b++) {
          const cue = batch[b];
          const i = cuePosByIndex.get(cue.index) ?? 0;
          const parentGroup = groupByCueIdx.get(cue.index);
          const prevCues = cues.slice(Math.max(0, i - 3), i);
          const nextCues = cues.slice(i + 1, i + 4);
          const durationSec = Number((cue.endSec - cue.startSec).toFixed(3));

          let translatedText = batchResults?.get(cue.index);

          if (!translatedText || !translatedText.trim()) {
            const context: TranslationContext = {
              style: activeStyle,
              cue: { ...cue, text: normalizeCueTextForSpeech(cue.text) },
              prevCues,
              nextCues,
              durationSec,
              allCues: cues,
              cueIndex: i,
              groupSourceText: parentGroup?.sourceText,
              groupId: parentGroup?.groupId,
              dubbingMode,
            };

            translatedText = await this.translateTextWithFallback(
              provider,
              cue.text,
              targetLang,
              activeSourceLang,
              context,
              options?.strict,
              `câu #${cue.index}`
            );
          }

          if (activeStyle === "cinema") {
            translatedText = adaptCueToCinemaStyle({
              cue,
              prevCues,
              nextCues,
              rawTranslation: translatedText,
              targetLang,
            });
          }

          const cleanSpeech = normalizeCueTextForSpeech(translatedText);
          currentBatchPairs.push({
            source: normalizeCueTextForSpeech(cue.text),
            translated: cleanSpeech,
          });

          translatedCues.push({
            index: cue.index,
            startSec: cue.startSec,
            endSec: cue.endSec,
            originalText: cue.text,
            text: translatedText,
            subtitleText: translatedText,
            speechFragmentText: cleanSpeech,
            groupId: parentGroup?.groupId,
            isEdited: false,
          });

          completedCues++;
          if (onProgress) onProgress(completedCues, total);
        }

        prevLines = currentBatchPairs.slice(-3);
      }

      this.lastSpeechGroups = planDubbingSpeechGroups(cues, translatedCues);
    } else {
      // Mode 2 (sentence_group): Adaptive Full-Context Batching for sentence groups
      const canBatch = typeof provider.translateBatch === "function";
      const groupBatches = canBatch
        ? chunkArrayAdaptive(plannedGroups)
        : plannedGroups.map((g) => [g]);
      const globalSummary =
        canBatch && groupBatches.length > 1
          ? buildGlobalScriptSummary(plannedGroups.map((g) => g.sourceText))
          : undefined;
      let prevLines: { source: string; translated: string }[] = [];

      for (let bIdx = 0; bIdx < groupBatches.length; bIdx++) {
        if (options?.isCancelled?.()) break;
        while (options?.isPaused?.() && !options?.isCancelled?.()) {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        if (options?.isCancelled?.()) break;

        const currentGroupBatch = groupBatches[bIdx];
        let batchResults: Map<number, string> | null = null;

        if (canBatch && currentGroupBatch.length > 1) {
          try {
            const items: BatchItem[] = currentGroupBatch.map((g, idx) => ({
              id: idx,
              text: g.sourceText,
            }));
            const batchContext: BatchTranslationContext = {
              isFullScriptSinglePass: groupBatches.length === 1,
              globalSummary,
              prevLines: prevLines.length > 0 ? prevLines : undefined,
              dubbingMode,
            };
            batchResults = await provider.translateBatch!(
              items,
              targetLang,
              activeSourceLang,
              activeStyle,
              batchContext
            );
          } catch (e) {
            console.warn("Group batch translation failed, falling back to individual group:", e);
          }
        }

        const currentBatchPairs: { source: string; translated: string }[] = [];

        for (let gIdx = 0; gIdx < currentGroupBatch.length; gIdx++) {
          const group = currentGroupBatch[gIdx];
          const groupCues = group.sourceCueIds
            .map((id) => {
              const pos = cuePosByIndex.get(id);
              return pos !== undefined ? cues[pos] : undefined;
            })
            .filter((c): c is OriginalCue => Boolean(c));

          if (groupCues.length === 0) continue;

          const firstPos = cuePosByIndex.get(groupCues[0].index) ?? 0;
          const lastPos = cuePosByIndex.get(groupCues[groupCues.length - 1].index) ?? firstPos;
          const prevCues = cues.slice(Math.max(0, firstPos - 3), firstPos);
          const nextCues = cues.slice(lastPos + 1, lastPos + 4);
          const groupDurationSec = Number((group.endSec - group.startSec).toFixed(3));

          let preTranslatedText = batchResults?.get(gIdx);

          if (groupCues.length === 1) {
            const cue = groupCues[0];
            let translatedText = preTranslatedText;

            if (!translatedText || !translatedText.trim()) {
              const context: TranslationContext = {
                style: activeStyle,
                cue: { ...cue, text: group.sourceText },
                prevCues,
                nextCues,
                durationSec: groupDurationSec,
                allCues: cues,
                cueIndex: firstPos,
                groupSourceText: group.sourceText,
                groupId: group.groupId,
                dubbingMode,
              };

              translatedText = await this.translateTextWithFallback(
                provider,
                group.sourceText,
                targetLang,
                activeSourceLang,
                context,
                options?.strict,
                `câu #${cue.index}`
              );
            }

            if (activeStyle === "cinema") {
              translatedText = adaptCueToCinemaStyle({
                cue,
                prevCues,
                nextCues,
                rawTranslation: translatedText,
                targetLang,
              });
            }

            const cleanSpeech = normalizeCueTextForSpeech(translatedText);
            currentBatchPairs.push({ source: group.sourceText, translated: cleanSpeech });

            translatedCues.push({
              index: cue.index,
              startSec: cue.startSec,
              endSec: cue.endSec,
              originalText: cue.text,
              text: translatedText,
              subtitleText: translatedText,
              speechFragmentText: cleanSpeech,
              groupId: group.groupId,
              projectionNeedsReview: false,
              isEdited: false,
            });
            updatedGroups.push({
              ...group,
              translatedText: translatedText,
              speechText: cleanSpeech,
            });

            completedCues++;
            if (onProgress) onProgress(completedCues, total);
            continue;
          }

          // Multi-cue group: translate the full sentence group first
          let groupTranslated = preTranslatedText;
          if (!groupTranslated || !groupTranslated.trim()) {
            const groupContext: TranslationContext = {
              style: activeStyle,
              cue: {
                index: groupCues[0].index,
                startSec: group.startSec,
                endSec: group.endSec,
                text: group.sourceText,
              },
              prevCues,
              nextCues,
              durationSec: groupDurationSec,
              allCues: cues,
              cueIndex: firstPos,
              groupSourceText: group.sourceText,
              groupId: group.groupId,
              dubbingMode,
            };

            groupTranslated = await this.translateTextWithFallback(
              provider,
              group.sourceText,
              targetLang,
              activeSourceLang,
              groupContext,
              options?.strict,
              `nhóm câu #${group.sourceCueIds.join("-")}`
            );
          }

          const projection = projectGroupTranslationToCues(groupCues, groupTranslated);

          if (projection.reliable && projection.projectedTexts.length === groupCues.length) {
            for (let k = 0; k < groupCues.length; k++) {
              const cue = groupCues[k];
              const projectedText = projection.projectedTexts[k];
              translatedCues.push({
                index: cue.index,
                startSec: cue.startSec,
                endSec: cue.endSec,
                originalText: cue.text,
                text: projectedText,
                subtitleText: projectedText,
                speechFragmentText: projectedText,
                groupId: group.groupId,
                projectionNeedsReview: false,
                isEdited: false,
              });
              completedCues++;
              if (onProgress) onProgress(completedCues, total);
            }

            currentBatchPairs.push({
              source: group.sourceText,
              translated: projection.speechText,
            });

            updatedGroups.push({
              ...group,
              translatedText: groupTranslated || projection.speechText,
              speechText: projection.speechText,
            });
          } else {
            // Safe fallback: translate each cue in the group with full sentence context
            const fallbackFragments: string[] = [];
            for (let k = 0; k < groupCues.length; k++) {
              const cue = groupCues[k];
              const cuePos = cuePosByIndex.get(cue.index) ?? firstPos + k;
              const cueContext: TranslationContext = {
                style: activeStyle,
                cue: { ...cue, text: normalizeCueTextForSpeech(cue.text) },
                prevCues: cues.slice(Math.max(0, cuePos - 3), cuePos),
                nextCues: cues.slice(cuePos + 1, cuePos + 4),
                durationSec: Number((cue.endSec - cue.startSec).toFixed(3)),
                allCues: cues,
                cueIndex: cuePos,
                groupSourceText: group.sourceText,
                groupId: group.groupId,
                dubbingMode,
              };

              const fallbackTrans = await this.translateTextWithFallback(
                provider,
                cue.text,
                targetLang,
                activeSourceLang,
                cueContext,
                options?.strict,
                `câu #${cue.index}`
              );

              fallbackFragments.push(fallbackTrans);
              translatedCues.push({
                index: cue.index,
                startSec: cue.startSec,
                endSec: cue.endSec,
                originalText: cue.text,
                text: fallbackTrans,
                subtitleText: fallbackTrans,
                speechFragmentText: normalizeCueTextForSpeech(fallbackTrans),
                groupId: group.groupId,
                projectionNeedsReview: true,
                isEdited: false,
              });
              completedCues++;
              if (onProgress) onProgress(completedCues, total);
            }

            const combinedSpeech = joinCueTextsForSpeech(fallbackFragments, true);
            currentBatchPairs.push({ source: group.sourceText, translated: combinedSpeech });

            updatedGroups.push({
              ...group,
              translatedText: combinedSpeech,
              speechText: combinedSpeech,
            });
          }
        }

        prevLines = currentBatchPairs.slice(-3);
      }

      this.lastSpeechGroups = updatedGroups;
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
   * Translates an array of legacy SubtitleCues using Adaptive Full-Context Batching.
   * Preserves timestamps and indices while stripping display newlines before sending to provider.
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

    const canBatch = typeof provider.translateBatch === "function";
    const batches = canBatch ? chunkArrayAdaptive(cues) : cues.map((c) => [c]);
    const globalSummary =
      canBatch && batches.length > 1
        ? buildGlobalScriptSummary(cues.map((c) => c.text))
        : undefined;
    let prevLines: { source: string; translated: string }[] = [];

    for (const batch of batches) {
      let batchResults: Map<number, string> | null = null;
      if (canBatch && batch.length > 1) {
        try {
          const items: BatchItem[] = batch.map((c) => ({
            id: c.index,
            text: normalizeCueTextForSpeech(c.text),
          }));
          const batchContext: BatchTranslationContext = {
            isFullScriptSinglePass: batches.length === 1,
            globalSummary,
            prevLines: prevLines.length > 0 ? prevLines : undefined,
          };
          batchResults = await provider.translateBatch!(
            items,
            targetLang,
            undefined,
            undefined,
            batchContext
          );
        } catch (e) {
          console.warn("Subtitle batch translation error, falling back:", e);
        }
      }

      const currentBatchPairs: { source: string; translated: string }[] = [];

      for (const cue of batch) {
        const normalized = normalizeCueTextForSpeech(cue.text);
        let translatedText = batchResults?.get(cue.index) || "";

        if (!translatedText || !translatedText.trim()) {
          try {
            const result = await provider.translate(normalized, targetLang);
            if (result && result.trim()) {
              translatedText = result.trim();
            }
          } catch (err: any) {
            console.warn(`Translation failed for cue #${cue.index}:`, err?.message);
            translatedText = normalized || cue.text;
          }
        }

        currentBatchPairs.push({ source: normalized, translated: translatedText });

        translatedCues.push({
          ...cue,
          text: translatedText,
        });

        if (onProgress) {
          onProgress(translatedCues.length, total);
        }
      }

      prevLines = currentBatchPairs.slice(-3);
    }

    return translatedCues;
  }
}

export const translationManager = TranslationManager.getInstance();
