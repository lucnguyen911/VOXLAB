import { TranslationProvider, TranslationConnectionResult, TranslationContext } from "../types";
import { buildCinemaPrompt } from "../cinemaAdaptation";

export class GeminiTranslateProvider implements TranslationProvider {
  readonly id = "gemini";
  readonly displayName = "Gemini";
  readonly type = "gemini" as const;
  readonly badge = "API";
  readonly description = "Google Gemini Flash (Cloud API)";
  apiKey = "";
  model = "gemini-1.5-flash";

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
      console.warn("Gemini API key is not configured.");
      return trimmed;
    }

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        this.model
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
      } else {
        prompt = `Translate the following subtitle text to ${targetLang}. Return ONLY the translation, without quotes, explanations or extra words:\n${trimmed}`;
      }

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 200 },
        }),
      });

      if (!res.ok) {
        throw new Error(`Gemini API HTTP ${res.status}`);
      }

      const data = await res.json();
      const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;
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
      const result = await this.translate("Hello", "vi", "en");
      return { ok: Boolean(result), message: `Kết nối Gemini API (${this.model}) thành công!` };
    } catch (err: any) {
      return { ok: false, message: `Lỗi kết nối Gemini: ${err?.message}` };
    }
  }
}
