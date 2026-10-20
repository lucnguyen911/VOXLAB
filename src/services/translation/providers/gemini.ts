import {
  TranslationProvider,
  TranslationConnectionResult,
  TranslationContext,
  TranslationStyle,
  BatchItem,
  BatchTranslationContext,
} from "../types";
import { buildCinemaPrompt } from "../cinemaAdaptation";
import { appHttpRequest } from "../../http/nativeClient";
import {
  buildBatchTranslationPrompt,
  parseBatchTranslationResponse,
  stripThinkingTags,
} from "../batchTranslationHelper";

export class GeminiTranslateProvider implements TranslationProvider {
  readonly id = "gemini";
  readonly displayName = "Gemini";
  readonly type = "gemini" as const;
  readonly badge = "API";
  description = "Google Gemini Flash (Cloud API)";
  apiKey = "";
  model = "gemini-1.5-flash";
  timeout = 60;
  maxTokens = 4096;

  constructor(apiKey?: string, model?: string, timeout?: number, maxTokens?: number) {
    if (apiKey) this.apiKey = apiKey;
    if (model) this.model = model;
    if (timeout !== undefined) this.timeout = timeout;
    if (maxTokens !== undefined) this.maxTokens = maxTokens;
  }

  async translate(
    text: string,
    targetLang: string,
    _sourceLang = "auto",
    context?: TranslationContext
  ): Promise<string> {
    const trimmed = text.replace(/\r\n|\r|\n/g, " ").replace(/\s+/g, " ").trim();
    if (!trimmed) return "";
    if (!this.apiKey) {
      console.warn("Gemini API key is not configured.");
      return trimmed;
    }

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        this.model || "gemini-1.5-flash"
      )}:generateContent`;

      let prompt: string;
      if (context?.style === "cinema") {
        prompt = buildCinemaPrompt({
          cue: context.cue || { index: 0, startSec: 0, endSec: 3, text: trimmed },
          prevCues: context.prevCues || [],
          nextCues: context.nextCues || [],
          rawTranslation: trimmed,
          targetLang,
        });
      } else if (context?.groupSourceText && context.groupSourceText !== trimmed) {
        prompt = `Full sentence context: "${context.groupSourceText}"\nTranslate the following specific phrase from that sentence into ${targetLang}. Return ONLY the translation of the phrase, without quotes or explanations:\n${trimmed}`;
      } else {
        prompt = `Translate the following subtitle text to ${targetLang}. Return ONLY the translation, without quotes, explanations or extra words:\n${trimmed}`;
      }

      const timeoutMs = Math.max(5, this.timeout || 60) * 1000;
      const maxOutputTokens = this.maxTokens && this.maxTokens > 0 ? this.maxTokens : 2048;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens },
        }),
        signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
      });

      if (!res.ok) {
        throw new Error(`Gemini API HTTP ${res.status}`);
      }

      const data = await res.json();
      const candidate = stripThinkingTags(data.candidates?.[0]?.content?.parts?.[0]?.text || "");
      return candidate ? candidate.trim() : trimmed;
    } catch (err: any) {
      console.warn("Gemini translation error:", err?.message);
      return trimmed;
    }
  }

  async testConnection(): Promise<TranslationConnectionResult> {
    if (!this.apiKey) {
      return { ok: false, message: "Chưa cấu hình Gemini API Key." };
    }
    try {
      const modelId = this.model || "gemini-1.5-flash";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}`;
      const timeoutMs = Math.max(5, this.timeout || 60) * 1000;
      const res = await fetch(url, {
        method: "GET",
        headers: { "x-goog-api-key": this.apiKey },
        signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
      });
      if (!res.ok) {
        return { ok: false, message: `Lỗi kết nối Gemini API (HTTP ${res.status}: ${res.statusText})` };
      }
      return { ok: true, message: `Kết nối Gemini API (${modelId}) thành công!` };
    } catch (err: any) {
      return { ok: false, message: `Lỗi kết nối Gemini: ${err?.message}` };
    }
  }

  async translateBatch(
    items: BatchItem[],
    targetLang: string,
    _sourceLang = "auto",
    style: TranslationStyle = "default",
    batchContext?: BatchTranslationContext
  ): Promise<Map<number, string>> {
    if (!items || items.length === 0) return new Map();
    if (!this.apiKey) {
      return new Map(items.map((it) => [it.id, it.text]));
    }

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        this.model || "gemini-1.5-flash"
      )}:generateContent`;
      const { system, user } = buildBatchTranslationPrompt(items, targetLang, style, batchContext);
      const fullPrompt = `${system}\n\n${user}`;
      const timeoutSec = Math.max(20, (this.timeout || 60) * 2);
      const maxOutputTokens = Math.max(this.maxTokens || 4096, items.length * 120);

      const res = await appHttpRequest(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: {
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens },
        },
        timeoutSec,
      });

      if (!res.ok) {
        throw new Error(`Gemini API HTTP ${res.status}`);
      }

      const candidate = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      return parseBatchTranslationResponse(candidate || "", items);
    } catch (err: any) {
      console.warn("Gemini batch translation error:", err?.message);
      return new Map();
    }
  }
}
