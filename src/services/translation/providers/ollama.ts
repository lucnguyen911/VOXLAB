import { TranslationProvider, TranslationConnectionResult, TranslationContext } from "../types";
import { buildCinemaPrompt } from "../cinemaAdaptation";

export class OllamaTranslateProvider implements TranslationProvider {
  id = "ollama";
  displayName = "Ollama";
  type = "ollama" as const;
  badge = "Local";
  description = "Máy cục bộ • Offline (http://localhost:11434/v1)";
  endpoint = "http://localhost:11434/v1";
  apiKey = "";
  model = "qwen2.5";

  constructor(endpoint?: string, model?: string, apiKey?: string, id = "ollama", displayName = "Ollama") {
    if (endpoint) this.endpoint = endpoint;
    if (model) this.model = model;
    if (apiKey) this.apiKey = apiKey;
    this.id = id;
    this.displayName = displayName;
  }

  async testConnection(): Promise<TranslationConnectionResult> {
    try {
      const cleanEndpoint = this.endpoint.replace(/\/+$/, "");
      const res = await fetch(`${cleanEndpoint}/models`, {
        method: "GET",
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
      });

      if (!res.ok) {
        return {
          ok: false,
          message: `Không thể kết nối tới Ollama (${res.status} ${res.statusText})`,
        };
      }

      const data = await res.json();
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
    const trimmed = text.trim();
    if (!trimmed) return "";

    try {
      const cleanEndpoint = this.endpoint.replace(/\/+$/, "");

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
                content: `You are a professional subtitle translator. Translate the text into ${targetLang}. Return ONLY the direct natural translation without preamble, markdown quotes, notes, or explanations.`,
              },
              { role: "user", content: trimmed },
            ];

      const res = await fetch(`${cleanEndpoint}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model || "qwen2.5",
          messages,
          temperature: 0.3,
        }),
      });

      if (!res.ok) {
        throw new Error(`Ollama HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content === "string" && content.trim()) {
        return content.trim().replace(/^["'“”„«»]+|["'“”„«»]+$/g, "").trim();
      }

      throw new Error("Ollama trả về phản hồi rỗng.");
    } catch (err: any) {
      throw new Error(`Ollama translation error: ${err?.message || "Không thể kết nối"}`);
    }
  }
}
