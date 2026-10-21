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

export class ClaudeTranslateProvider implements TranslationProvider {
  readonly id = "claude";
  readonly displayName = "Anthropic Claude";
  readonly type = "claude" as const;
  readonly badge = "API";
  description = "Anthropic Claude (Cloud API)";
  apiKey = "";
  model = "claude-3-5-haiku-20241022";
  endpoint = "https://api.anthropic.com/v1";
  timeout = 60;
  maxTokens = 4096;

  constructor(
    apiKey?: string,
    model?: string,
    endpoint?: string,
    timeout?: number,
    maxTokens?: number
  ) {
    if (apiKey) this.apiKey = apiKey;
    if (model) this.model = model;
    if (endpoint) this.endpoint = endpoint;
    if (timeout !== undefined) this.timeout = timeout;
    if (maxTokens !== undefined) this.maxTokens = maxTokens;
  }

  private resolveMessagesUrl(): string {
    const clean = (this.endpoint || "https://api.anthropic.com/v1").trim().replace(/\/+$/, "");
    return clean.endsWith("/messages") ? clean : `${clean}/messages`;
  }

  async translate(
    text: string,
    targetLang: string,
    _sourceLang = "auto",
    context?: TranslationContext
  ): Promise<string> {
    const trimmed = text.replace(/\r\n|\r|\n/g, " ").replace(/\s+/g, " ").trim();
    if (!trimmed) return "";
    if (!this.apiKey.trim()) {
      console.warn("Anthropic Claude API key is not configured.");
      return trimmed;
    }

    try {
      const url = this.resolveMessagesUrl();

      let systemPrompt = `You are an expert subtitle and video translation specialist. Translate the given subtitle text accurately and naturally into ${targetLang}. Preserve emotional tone, punctuation, numbers, and proper nouns. Output ONLY the translated text, without markdown, quotes, explanations, or notes.`;
      let userPrompt = trimmed;

      if (context?.style === "cinema") {
        systemPrompt = `You are an elite cinematic dialogue adapter and film subtitle specialist. Translate dialogue into ${targetLang} with natural cadence, high emotional resonance, and concise rhythm suited for on-screen subtitles. Output ONLY the translated text, without quotes or commentary.`;
        userPrompt = buildCinemaPrompt({
          cue: context.cue || { index: 0, startSec: 0, endSec: 3, text: trimmed },
          prevCues: context.prevCues || [],
          nextCues: context.nextCues || [],
          rawTranslation: trimmed,
          targetLang,
        });
      } else if (context?.groupSourceText && context.groupSourceText !== trimmed) {
        systemPrompt = `You are a professional subtitle translator. Full sentence context: "${context.groupSourceText}". Translate ONLY the specified phrase into ${targetLang} to perfectly complete the sentence. Output ONLY the translated phrase.`;
        userPrompt = trimmed;
      }

      const timeoutSec = Math.max(5, this.timeout || 60);
      const bodyPayload: Record<string, any> = {
        model: this.model || "claude-3-5-haiku-20241022",
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        max_tokens: this.maxTokens && this.maxTokens > 0 ? this.maxTokens : 4096,
        temperature: context?.style === "cinema" ? 0.3 : 0.2,
      };

      const res = await appHttpRequest(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey.trim(),
          "anthropic-version": "2023-06-01",
        },
        body: bodyPayload,
        timeoutSec,
      });

      if (!res.ok) {
        throw new Error(
          res.data?.error?.message || `Anthropic Claude API HTTP ${res.status}: ${res.statusText}`
        );
      }

      let resultText = "";
      if (Array.isArray(res.data?.content)) {
        for (const block of res.data.content) {
          if (block?.type === "text" && typeof block?.text === "string") {
            resultText += block.text;
          }
        }
      } else if (typeof res.data?.content === "string") {
        resultText = res.data.content;
      }

      const cleaned = stripThinkingTags(resultText || "");
      return cleaned ? cleaned.trim() : trimmed;
    } catch (err: any) {
      console.warn("Claude translation error:", err?.message || err);
      return trimmed;
    }
  }

  async testConnection(): Promise<TranslationConnectionResult> {
    if (!this.apiKey.trim()) {
      return { ok: false, message: "Chưa cấu hình Anthropic Claude API Key." };
    }

    try {
      const url = this.resolveMessagesUrl();
      const timeoutSec = Math.max(5, this.timeout || 30);
      const res = await appHttpRequest(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey.trim(),
          "anthropic-version": "2023-06-01",
        },
        body: {
          model: this.model || "claude-3-5-haiku-20241022",
          max_tokens: 10,
          messages: [{ role: "user", content: "Hello" }],
        },
        timeoutSec,
      });

      if (!res.ok) {
        const errorMsg =
          res.data?.error?.message ||
          res.data?.message ||
          `Lỗi kết nối Anthropic Claude (HTTP ${res.status}: ${res.statusText})`;
        return { ok: false, message: errorMsg };
      }

      return {
        ok: true,
        message: `Kết nối Anthropic Claude (${this.model || "claude-3-5-haiku-20241022"}) thành công!`,
      };
    } catch (err: any) {
      return { ok: false, message: `Lỗi kết nối Anthropic Claude: ${err?.message || err}` };
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
    if (!this.apiKey.trim()) {
      return new Map(items.map((it) => [it.id, it.text]));
    }

    try {
      const url = this.resolveMessagesUrl();
      const { system, user } = buildBatchTranslationPrompt(items, targetLang, style, batchContext);
      const timeoutSec = Math.max(25, (this.timeout || 60) * 2);

      const bodyPayload: Record<string, any> = {
        model: this.model || "claude-3-5-haiku-20241022",
        system,
        messages: [{ role: "user", content: user }],
        max_tokens:
          this.maxTokens && this.maxTokens > 0
            ? Math.max(this.maxTokens, items.length * 120)
            : Math.max(4096, items.length * 120),
        temperature: 0.1,
      };

      const res = await appHttpRequest(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey.trim(),
          "anthropic-version": "2023-06-01",
        },
        body: bodyPayload,
        timeoutSec,
      });

      if (!res.ok) {
        throw new Error(
          res.data?.error?.message || `Anthropic Claude API HTTP ${res.status}: ${res.statusText}`
        );
      }

      let text = "";
      if (Array.isArray(res.data?.content)) {
        for (const block of res.data.content) {
          if (block?.type === "text" && typeof block?.text === "string") {
            text += block.text;
          }
        }
      } else if (typeof res.data?.content === "string") {
        text = res.data.content;
      }

      return parseBatchTranslationResponse(text || "", items);
    } catch (err: any) {
      console.warn("Claude batch translation error:", err?.message || err);
      return new Map();
    }
  }
}
