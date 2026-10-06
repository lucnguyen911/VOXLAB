import { VoiceProfile } from "../../types/ui";
import { SupportedLang } from "../../i18n/translations";
import { TtsProviderAdapter, ProviderCapabilities, PreviewResult } from "./types";

export class GoogleTranslateTtsProvider implements TtsProviderAdapter {
  readonly id = "google_translate" as const;
  readonly sourceType = "online" as const;

  private cachedVoices: VoiceProfile[] | null = null;

  getDisplayName(_lang: SupportedLang): string {
    return "Google TTS";
  }

  availability() {
    return "available" as const;
  }

  capabilities(): ProviderCapabilities {
    return {
      streaming: false,
      requiresApiKey: false,
      supportsEmotions: false,
      supportsCustomPitch: false,
      supportsCustomSpeed: true,
    };
  }

  listVoices(): VoiceProfile[] {
    if (this.cachedVoices) {
      return this.cachedVoices;
    }

    // Google Translate TTS (gTTS) capabilities: language-based without fake character names (VOICE-R-013)
    // Strictly NO fake gender (VOICE-R-014) and NO fake style/age (VOICE-R-015)
    const catalog: VoiceProfile[] = [
      {
        id: "google_vi",
        name: "Google Tiếng Việt",
        source: "google",
        origin: "system",
        sourceType: "online",
        provider: "google_translate",
        engine: "gtts",
        gender: undefined,
        country: "VN",
        accent: undefined,
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Google TTS",
        tags: [],
        supportedLanguages: ["vi"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-blue-500 to-red-500",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "google_en_us",
        name: "Google English (US)",
        source: "google",
        origin: "system",
        sourceType: "online",
        provider: "google_translate",
        engine: "gtts",
        gender: undefined,
        country: "US",
        accent: "en-us",
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Google TTS",
        tags: [],
        supportedLanguages: ["en"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-blue-500 to-green-500",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "google_en_uk",
        name: "Google English (UK)",
        source: "google",
        origin: "system",
        sourceType: "online",
        provider: "google_translate",
        engine: "gtts",
        gender: undefined,
        country: "GB",
        accent: "en-gb",
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Google TTS",
        tags: [],
        supportedLanguages: ["en"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-blue-600 to-yellow-500",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "google_es",
        name: "Google Español",
        source: "google",
        origin: "system",
        sourceType: "online",
        provider: "google_translate",
        engine: "gtts",
        gender: undefined,
        country: "ES",
        accent: "es-es",
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Google TTS",
        tags: [],
        supportedLanguages: ["es"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-red-500 to-amber-500",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "google_fr",
        name: "Google Français",
        source: "google",
        origin: "system",
        sourceType: "online",
        provider: "google_translate",
        engine: "gtts",
        gender: undefined,
        country: "FR",
        accent: "fr-fr",
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Google TTS",
        tags: [],
        supportedLanguages: ["fr"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-blue-500 to-indigo-600",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "google_de",
        name: "Google Deutsch",
        source: "google",
        origin: "system",
        sourceType: "online",
        provider: "google_translate",
        engine: "gtts",
        gender: undefined,
        country: "DE",
        accent: "de-de",
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Google TTS",
        tags: [],
        supportedLanguages: ["de"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-yellow-500 to-red-600",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "google_ja",
        name: "Google 日本語",
        source: "google",
        origin: "system",
        sourceType: "online",
        provider: "google_translate",
        engine: "gtts",
        gender: undefined,
        country: "JP",
        accent: undefined,
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Google TTS",
        tags: [],
        supportedLanguages: ["ja"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-red-500 to-rose-600",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "google_zh",
        name: "Google 中文",
        source: "google",
        origin: "system",
        sourceType: "online",
        provider: "google_translate",
        engine: "gtts",
        gender: undefined,
        country: "CN",
        accent: undefined,
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Google TTS",
        tags: [],
        supportedLanguages: ["zh"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-red-600 to-yellow-600",
        availability: "available",
        previewAvailable: true,
      },
    ];

    this.cachedVoices = catalog;
    return catalog;
  }

  async preview(voice: VoiceProfile, _text?: string): Promise<PreviewResult> {
    try {
      const lang = voice.supportedLanguages[0] || "vi";
      const sampleText = lang === "vi" ? "Xin chào, đây là giọng đọc Google TTS." : "Hello, this is Google Text-to-Speech preview.";
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(lang)}&client=tw-ob&q=${encodeURIComponent(sampleText)}`;

      const audio = new Audio(url);
      await audio.play().catch(() => {
        // Fallback to speech synthesis if direct URL audio stream is blocked by browser CORS
        if (typeof window !== "undefined" && "speechSynthesis" in window) {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(sampleText);
          utterance.lang = lang === "vi" ? "vi-VN" : "en-US";
          window.speechSynthesis.speak(utterance);
        }
      });

      return { success: true, audioUrl: url };
    } catch (e: any) {
      // PROV-R-024: Graceful failure without crashing modal or falling back to paid Google Cloud
      return { success: false, error: e?.message || "Google TTS preview unavailable" };
    }
  }
}

export const googleTranslateTtsProvider = new GoogleTranslateTtsProvider();
