import { VoiceProfile } from "../../types/ui";
import { SupportedLang } from "../../i18n/translations";
import { TtsProviderAdapter, ProviderCapabilities, PreviewResult } from "./types";

export class EdgeTtsProvider implements TtsProviderAdapter {
  readonly id = "edge" as const;
  readonly sourceType = "online" as const;

  private cachedVoices: VoiceProfile[] | null = null;

  getDisplayName(_lang: SupportedLang): string {
    return "Edge TTS";
  }

  availability() {
    return "available" as const;
  }

  capabilities(): ProviderCapabilities {
    return {
      streaming: true,
      requiresApiKey: false,
      supportsEmotions: false,
      supportsCustomPitch: true,
      supportsCustomSpeed: true,
    };
  }

  listVoices(): VoiceProfile[] {
    if (this.cachedVoices) {
      return this.cachedVoices;
    }

    // Normalized Edge TTS voice catalog with authoritative metadata strictly
    // Note: vi-VN does not provide regional accent info, so accent is undefined (VOICE-R-009)
    // Style and Age are undefined since Edge does not provide authoritative style/age (VOICE-R-011, VOICE-R-012)
    const catalog: VoiceProfile[] = [
      {
        id: "edge_vi_hoaimy",
        name: "Hoài My (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "female",
        country: "VN",
        accent: undefined,
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Female"],
        supportedLanguages: ["vi"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-sky-500 to-blue-600",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "edge_vi_namminh",
        name: "Nam Minh (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "male",
        country: "VN",
        accent: undefined,
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Male"],
        supportedLanguages: ["vi"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-blue-600 to-indigo-600",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "edge_en_jenny",
        name: "Jenny (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "female",
        country: "US",
        accent: "en-us", // Authoritative: en-US
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Female"],
        supportedLanguages: ["en"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-teal-500 to-cyan-600",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "edge_en_guy",
        name: "Guy (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "male",
        country: "US",
        accent: "en-us", // Authoritative: en-US
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Male"],
        supportedLanguages: ["en"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-slate-600 to-slate-800",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "edge_en_sonia",
        name: "Sonia (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "female",
        country: "GB",
        accent: "en-gb", // Authoritative: en-GB
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Female"],
        supportedLanguages: ["en"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-purple-500 to-indigo-600",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "edge_es_elvira",
        name: "Elvira (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "female",
        country: "ES",
        accent: "es-es", // Authoritative: es-ES
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Female"],
        supportedLanguages: ["es"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-amber-500 to-red-600",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "edge_fr_denise",
        name: "Denise (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "female",
        country: "FR",
        accent: "fr-fr", // Authoritative: fr-FR
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Female"],
        supportedLanguages: ["fr"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-rose-500 to-pink-600",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "edge_de_katja",
        name: "Katja (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "female",
        country: "DE",
        accent: "de-de", // Authoritative: de-DE
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Female"],
        supportedLanguages: ["de"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-yellow-600 to-amber-700",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "edge_ja_nanami",
        name: "Nanami (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "female",
        country: "JP",
        accent: undefined,
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Female"],
        supportedLanguages: ["ja"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-pink-400 to-rose-500",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "edge_zh_xiaoxiao",
        name: "Xiaoxiao (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "female",
        country: "CN",
        accent: undefined,
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Female"],
        supportedLanguages: ["zh"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-red-500 to-orange-500",
        availability: "available",
        previewAvailable: true,
      },
    ];

    this.cachedVoices = catalog;
    return catalog;
  }

  async preview(voice: VoiceProfile, _text?: string): Promise<PreviewResult> {
    try {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance("Xin chào, đây là giọng đọc thử nghiệm của Edge TTS.");
        utterance.rate = 1.0;
        if (voice.supportedLanguages.includes("vi")) {
          utterance.lang = "vi-VN";
        } else if (voice.supportedLanguages.includes("en")) {
          utterance.lang = "en-US";
        }
        window.speechSynthesis.speak(utterance);
        return { success: true };
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || "Failed to preview Edge voice" };
    }
  }
}

export const edgeTtsProvider = new EdgeTtsProvider();
