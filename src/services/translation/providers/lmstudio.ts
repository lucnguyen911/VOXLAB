import {
  TranslationProvider,
  TranslationProviderType,
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

export class LmStudioTranslateProvider implements TranslationProvider {
  id = "lmstudio";
  displayName = "LM Studio";
  type: TranslationProviderType = "lmstudio";
  badge = "Local";
  description = "Máy cục bộ • Offline (http://localhost:1234/v1)";
  endpoint = "http://localhost:1234/v1";
  apiKey = "";
  model = "local-model";
  timeout = 60;
  maxTokens = 4096;

  constructor(
    endpoint?: string,
    model?: string,
    apiKey?: string,
    id = "lmstudio",
    displayName = "LM Studio",
    timeout?: number,
    maxTokens?: number,
    type: TranslationProviderType = "lmstudio"
  ) {
    if (endpoint) this.endpoint = endpoint;
    if (model) this.model = model;
    if (apiKey) this.apiKey = apiKey;
    this.id = id;
    this.displayName = displayName;
    if (timeout !== undefined) this.timeout = timeout;
    if (maxTokens !== undefined) this.maxTokens = maxTokens;
    this.type = type;
  }

  async testConnection(): Promise<TranslationConnectionResult> {
    if ((this.type === "openai" || this.type === "qwen") && !this.apiKey) {
      return {
        ok: false,
        message: `Chưa cấu hình ${this.displayName} API Key.`,
      };
    }

    try {
      const cleanEndpoint = resolveOpenAiBaseUrl(this.endpoint, "http://localhost:1234/v1");
      const timeoutSec = Math.max(5, this.timeout || 60);
      const res = await appHttpRequest(`${cleanEndpoint}/models`, {
        method: "GET",
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
        timeoutSec,
      });

      if (!res.ok) {
        return {
          ok: false,
          message: `Không thể kết nối tới model dịch (${res.status} ${res.statusText})`,
        };
      }

      const data = res.data;
      const models: string[] = [];
      if (Array.isArray(data?.data)) {
        for (const m of data.data) {
          if (m?.id) models.push(m.id);
        }
      }

      const activeModelText = models.length > 0 ? ` (${models[0]})` : "";
      return {
        ok: true,
        message: `Kết nối thành công! Đã tìm thấy ${models.length} model${activeModelText}`,
        models,
      };
    } catch (err: any) {
      return {
        ok: false,
        message: `Không thể kết nối tới model dịch tại ${this.endpoint}. Vui lòng kiểm tra server.`,
      };
    }
  }

  async translate(
    text: string,
    targetLang: string,
    _sourceLang = "auto",
    context?: TranslationContext
  ): Promise<string> {
    const trimmed = text.replace(/\r\n|\r|\n/g, " ").replace(/\s+/g, " ").trim();
    if (!trimmed) return "";

    if ((this.type === "openai" || this.type === "qwen") && !this.apiKey) {
      console.warn(`${this.displayName} API key is not configured.`);
      return trimmed;
    }

    try {
      const cleanEndpoint = resolveOpenAiBaseUrl(this.endpoint, "http://localhost:1234/v1");

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
                  ? `You are a subtitle translator. Full sentence context: "${context.groupSourceText}". Translate ONLY the user's phrase into ${targetLang} without preamble, quotation marks or explanations.`
                  : `You are a subtitle translator. Translate the text into ${targetLang}. Return ONLY the direct translation without preamble, quotation marks or explanations.`,
              },
              { role: "user", content: trimmed },
            ];

      const timeoutSec = Math.max(5, this.timeout || 60);
      const bodyPayload: Record<string, any> = {
        model: this.model || "local-model",
        messages,
        temperature: context?.style === "cinema" ? 0.3 : 0.1,
      };
      if (this.maxTokens && this.maxTokens > 0) {
        bodyPayload.max_tokens = this.maxTokens;
      }

      const res = await appHttpRequest(`${cleanEndpoint}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: bodyPayload,
        timeoutSec,
      });

      if (!res.ok) {
        throw new Error(`${this.displayName} HTTP ${res.status}`);
      }

      const content = stripThinkingTags(res.data?.choices?.[0]?.message?.content || "");
      return content ? content.trim() : trimmed;
    } catch (err: any) {
      console.warn(`${this.displayName} translation error:`, err?.message);
      return trimmed;
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
    if ((this.type === "openai" || this.type === "qwen") && !this.apiKey) {
      return new Map(items.map((it) => [it.id, it.text]));
    }

    try {
      const cleanEndpoint = resolveOpenAiBaseUrl(this.endpoint, "http://localhost:1234/v1");
      const { system, user } = buildBatchTranslationPrompt(items, targetLang, style, batchContext);
      const timeoutSec = Math.max(30, (this.timeout || 60) * 3);

      const bodyPayload: Record<string, any> = {
        model: this.model || "local-model",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.1,
      };
      if (this.maxTokens && this.maxTokens > 0) {
        bodyPayload.max_tokens = Math.max(this.maxTokens, items.length * 120);
      }

      const res = await appHttpRequest(`${cleanEndpoint}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: bodyPayload,
        timeoutSec,
      });

      if (!res.ok) {
        throw new Error(`${this.displayName} HTTP ${res.status}`);
      }

      const content = res.data?.choices?.[0]?.message?.content;
      return parseBatchTranslationResponse(content || "", items);
    } catch (err: any) {
      console.warn(`${this.displayName} batch translation error:`, err?.message);
      return new Map();
    }
  }
}
