import { TranslationProvider, TranslationConnectionResult, TranslationContext } from "../types";
import { buildCinemaPrompt } from "../cinemaAdaptation";

export class LmStudioTranslateProvider implements TranslationProvider {
  id = "lmstudio";
  displayName = "LM Studio";
  type = "lmstudio" as const;
  badge = "Local";
  description = "Máy cục bộ • Offline (http://localhost:1234/v1)";
  endpoint = "http://localhost:1234/v1";
  apiKey = "";
  model = "local-model";

  constructor(endpoint?: string, model?: string, apiKey?: string, id = "lmstudio", displayName = "LM Studio") {
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
          message: `Không thể kết nối tới model dịch (${res.status} ${res.statusText})`,
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
                content: `You are a subtitle translator. Translate the text into ${targetLang}. Return ONLY the direct translation without preamble, quotation marks or explanations.`,
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
          model: this.model || "local-model",
          messages,
          temperature: context?.style === "cinema" ? 0.3 : 0.1,
          max_tokens: 300,
        }),
      });

      if (!res.ok) {
        throw new Error(`LM Studio HTTP ${res.status}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      return content ? content.trim() : trimmed;
    } catch (err: any) {
      console.warn("LM Studio translation error:", err?.message);
      return trimmed;
    }
  }
}
