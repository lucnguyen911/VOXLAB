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

export class OllamaTranslateProvider implements TranslationProvider {
  id = "ollama";
  displayName = "Ollama";
  type = "ollama" as const;
  badge = "Local";
  description = "Máy cục bộ • Offline (http://localhost:11434/v1)";
  endpoint = "http://localhost:11434/v1";
  apiKey = "";
  model = "qwen2.5";
  timeout = 60;
  maxTokens = 4096;

  constructor(
    endpoint?: string,
    model?: string,
    apiKey?: string,
    id = "ollama",
    displayName = "Ollama",
    timeout?: number,
    maxTokens?: number
  ) {
    if (endpoint) this.endpoint = endpoint;
    if (model) this.model = model;
    if (apiKey) this.apiKey = apiKey;
    this.id = id;
    this.displayName = displayName;
    if (timeout !== undefined) this.timeout = timeout;
    if (maxTokens !== undefined) this.maxTokens = maxTokens;
  }

  async testConnection(): Promise<TranslationConnectionResult> {
    try {
      const cleanEndpoint = resolveOpenAiBaseUrl(this.endpoint, "http://localhost:11434/v1");
      const timeoutSec = Math.max(5, this.timeout || 60);
      const res = await appHttpRequest(`${cleanEndpoint}/models`, {
        method: "GET",
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
        timeoutSec,
      });

      if (!res.ok) {
        return {
          ok: false,
          message: `Không thể kết nối tới Ollama (${res.status} ${res.statusText})`,
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
    } catch {
      return {
        ok: false,
        message: `Không thể kết nối tới Ollama tại ${this.endpoint}. Vui lòng đảm bảo Ollama đang chạy.`,
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

    try {
      const cleanEndpoint = resolveOpenAiBaseUrl(this.endpoint, "http://localhost:11434/v1");

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
                  ? `You are a professional subtitle translator. Full sentence context: "${context.groupSourceText}". Translate ONLY the user's phrase into ${targetLang} without preamble, markdown quotes, notes, or explanations.`
                  : `You are a professional subtitle translator. Translate the text into ${targetLang}. Return ONLY the direct natural translation without preamble, markdown quotes, notes, or explanations.`,
              },
              { role: "user", content: trimmed },
            ];

      const timeoutSec = Math.max(5, this.timeout || 60);
      const bodyPayload: Record<string, any> = {
        model: this.model || "qwen2.5",
        messages,
        temperature: 0.3,
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
        throw new Error(`Ollama HTTP ${res.status}: ${res.statusText}`);
      }

      const content = stripThinkingTags(res.data?.choices?.[0]?.message?.content || "");
      if (typeof content === "string" && content.trim()) {
        return content.trim().replace(/^["'“”„«»]+|["'“”„«»]+$/g, "").trim();
      }

      throw new Error("Ollama trả về phản hồi rỗng.");
    } catch (err: any) {
      throw new Error(`Ollama translation error: ${err?.message || "Không thể kết nối"}`);
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

    try {
      const cleanEndpoint = resolveOpenAiBaseUrl(this.endpoint, "http://localhost:11434/v1");
      const { system, user } = buildBatchTranslationPrompt(items, targetLang, style, batchContext);
      const timeoutSec = Math.max(30, (this.timeout || 60) * 3);

      const bodyPayload: Record<string, any> = {
        model: this.model || "qwen2.5",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.2,
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
        throw new Error(`Ollama HTTP ${res.status}: ${res.statusText}`);
      }

      const content = res.data?.choices?.[0]?.message?.content;
      return parseBatchTranslationResponse(content || "", items);
    } catch (err: any) {
      console.warn("Ollama batch translation error:", err?.message);
      return new Map();
    }
  }
}
