import { TranslationProvider, TranslationConnectionResult, TranslationContext } from "../types";
import { buildCinemaPrompt } from "../cinemaAdaptation";

export class DeepSeekTranslateProvider implements TranslationProvider {
  readonly id = "deepseek";
  readonly displayName = "DeepSeek";
  readonly type = "deepseek" as const;
  readonly badge = "API";
  readonly description = "DeepSeek V3 / R1 (Cloud API)";
  apiKey = "";
  model = "deepseek-chat";
  endpoint = "https://api.deepseek.com/v1";

  constructor(apiKey?: string, model?: string) {
    if (apiKey) this.apiKey = apiKey;
    if (model) this.model = model;
  }

  async translate(
    text: string,
    targetLang: string,
    _sourceLang = "auto",
    context?: TranslationContext
  ): Promise<string> {
    const trimmed = text.trim();
    if (!trimmed) return "";
    if (!this.apiKey) {
      console.warn("DeepSeek API key is not configured.");
      return trimmed;
    }

    try {
      const url = `${this.endpoint}/chat/completions`;

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
                content: `You are a professional subtitle translator. Translate the given subtitle line directly into target language (${targetLang}). Preserve punctuation and tone. Output ONLY the translated line, nothing else.`,
              },
              { role: "user", content: trimmed },
            ];

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: context?.style === "cinema" ? 0.3 : 0.2,
        }),
      });

      if (!res.ok) {
        throw new Error(`DeepSeek API HTTP ${res.status}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
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
      const result = await this.translate("Hello", "vi", "en");
      return { ok: Boolean(result), message: `Kết nối DeepSeek API (${this.model}) thành công!` };
    } catch (err: any) {
      return { ok: false, message: `Lỗi kết nối DeepSeek: ${err?.message}` };
    }
  }
}
