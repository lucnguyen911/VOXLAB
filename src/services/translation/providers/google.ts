import { TranslationProvider, TranslationConnectionResult, TranslationContext } from "../types";

/**
 * Free Google Translate integration.
 * No API key required.
 */
export class GoogleTranslateProvider implements TranslationProvider {
  readonly id = "google";
  readonly displayName = "Google Translate";
  readonly type = "google" as const;
  readonly badge = "Online";
  readonly description = "Dịch trực tuyến qua Google — Không cần API Key";

  async translate(
    text: string,
    targetLang: string,
    sourceLang = "auto",
    _context?: TranslationContext
  ): Promise<string> {
    const trimmed = text.trim();
    if (!trimmed) return "";

    {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(
        sourceLang
      )}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(trimmed)}`;

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Google Translate HTTP ${res.status}`);
      }
      const data = await res.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        return data[0].map((item: any) => item[0]).join("");
      }
      // Unexpected payload: surface it instead of passing the source text off as a translation.
      throw new Error("Google Translate trả về dữ liệu không hợp lệ.");
    }
  }

  async testConnection(): Promise<TranslationConnectionResult> {
    try {
      const test = await this.translate("Hello", "vi", "en");
      if (test && test.length > 0) {
        return { ok: true, message: "Kết nối Google Translate thành công." };
      }
      return { ok: false, message: "Không nhận được phản hồi từ dịch vụ Google." };
    } catch (err: any) {
      return { ok: false, message: `Lỗi kết nối: ${err?.message || "Không xác định"}` };
    }
  }
}
