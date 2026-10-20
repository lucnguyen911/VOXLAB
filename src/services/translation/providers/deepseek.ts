import {
  TranslationProvider,
  TranslationConnectionResult,
  TranslationContext,
  TranslationStyle,
  BatchItem,
  BatchTranslationContext,
  resolveOpenAiBaseUrl,
} from "../types";
import { buildCinemaPrompt } from "../cinemaAdaptation";
import { appHttpRequest } from "../../http/nativeClient";
import {
  buildBatchTranslationPrompt,
  parseBatchTranslationResponse,
  stripThinkingTags,
} from "../batchTranslationHelper";

export class DeepSeekTranslateProvider implements TranslationProvider {
  readonly id = "deepseek";
  readonly displayName = "DeepSeek";
  readonly type = "deepseek" as const;
  readonly badge = "API";
  description = "DeepSeek V3 / R1 (Cloud API)";
  apiKey = "";
  model = "deepseek-chat";
  endpoint = "https://api.deepseek.com/v1";
  timeout = 60;
  maxTokens = 4096;

  constructor(apiKey?: string, model?: string, endpoint?: string, timeout?: number, maxTokens?: number) {
    if (apiKey) this.apiKey = apiKey;
    if (model) this.model = model;
    if (endpoint) this.endpoint = endpoint;
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
      console.warn("DeepSeek API key is not configured.");
      return trimmed;
    }

    try {
      const baseUrl = resolveOpenAiBaseUrl(this.endpoint, "https://api.deepseek.com/v1");
      const url = `${baseUrl}/chat/completions`;

      const messages =
        context?.style === "cinema"
          ? [
              {
                role: "user",
                content: buildCinemaPrompt({
                  cue: context.cue || { index: 0, startSec: 0, endSec: 3, text: trimmed },
                  prevCues: context.prevCues || [],
                  nextCues: context.nextCues || [],
                  rawTranslation: trimmed,
                  targetLang,
                }),
              },
            ]
          : [
              {
                role: "system",
                content: context?.groupSourceText && context.groupSourceText !== trimmed
                  ? `You are a professional subtitle translator. Full sentence context: "${context.groupSourceText}". Translate ONLY the user's phrase into ${targetLang} matching the full sentence grammar. Output ONLY the translated phrase.`
                  : `You are a professional subtitle translator. Translate the given subtitle line directly into target language (${targetLang}). Preserve punctuation and tone. Output ONLY the translated line, nothing else.`,
              },
              { role: "user", content: trimmed },
            ];

      const timeoutSec = Math.max(5, this.timeout || 60);
      const bodyPayload: Record<string, any> = {
        model: this.model || "deepseek-chat",
        messages,
        temperature: context?.style === "cinema" ? 0.3 : 0.2,
      };
      if (this.maxTokens && this.maxTokens > 0) {
        bodyPayload.max_tokens = this.maxTokens;
      }

      const res = await appHttpRequest(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: bodyPayload,
        timeoutSec,
      });

      if (!res.ok) {
        throw new Error(`DeepSeek API HTTP ${res.status}`);
      }

      const content = stripThinkingTags(res.data?.choices?.[0]?.message?.content || "");
      return content ? content.trim() : trimmed;
    } catch (err: any) {
      console.warn("DeepSeek translation error:", err?.message);
      return trimmed;
    }
  }

  async testConnection(): Promise<TranslationConnectionResult> {
    if (!this.apiKey) {
      return { ok: false, message: "Chưa cấu hình DeepSeek API Key." };
    }
    try {
      const baseUrl = resolveOpenAiBaseUrl(this.endpoint, "https://api.deepseek.com/v1");
      const timeoutSec = Math.max(5, this.timeout || 60);
      const res = await appHttpRequest(`${baseUrl}/models`, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        timeoutSec,
      });
      if (!res.ok) {
        return { ok: false, message: `Lỗi kết nối DeepSeek API (HTTP ${res.status}: ${res.statusText})` };
      }
      return { ok: true, message: `Kết nối DeepSeek API (${this.model || "deepseek-chat"}) thành công!` };
    } catch (err: any) {
      return { ok: false, message: `Lỗi kết nối DeepSeek: ${err?.message}` };
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
      const baseUrl = resolveOpenAiBaseUrl(this.endpoint, "https://api.deepseek.com/v1");
      const url = `${baseUrl}/chat/completions`;
      const { system, user } = buildBatchTranslationPrompt(items, targetLang, style, batchContext);
      const timeoutSec = Math.max(25, (this.timeout || 60) * 2);

      const bodyPayload: Record<string, any> = {
        model: this.model || "deepseek-chat",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.1,
      };
      if (this.maxTokens && this.maxTokens > 0) {
        bodyPayload.max_tokens = Math.max(this.maxTokens, items.length * 120);
      }

      const res = await appHttpRequest(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: bodyPayload,
        timeoutSec,
      });

      if (!res.ok) {
        throw new Error(`DeepSeek API HTTP ${res.status}`);
      }

      const content = res.data?.choices?.[0]?.message?.content;
      return parseBatchTranslationResponse(content || "", items);
    } catch (err: any) {
      console.warn("DeepSeek batch translation error:", err?.message);
      return new Map();
    }
  }
}
