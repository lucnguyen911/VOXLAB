import { VoiceProfile } from "../../types/ui";
import { SupportedLang } from "../../i18n/translations";
import { TtsProviderAdapter, ProviderCapabilities, PreviewResult } from "./types";

export class OpenAiTtsProvider implements TtsProviderAdapter {
  readonly id = "openai" as const;
  readonly sourceType = "online" as const;

  private cachedVoices: VoiceProfile[] | null = null;

  getDisplayName(_lang: SupportedLang): string {
    return "OpenAI TTS";
  }

  getApiKey(): string | null {
    if (typeof window !== "undefined") {
      return localStorage.getItem("voxlab_openai_api_key") || null;
    }
    return null;
  }

  availability() {
    const hasKey = Boolean(this.getApiKey());
    return hasKey ? ("available" as const) : ("not_configured" as const);
  }

  capabilities(): ProviderCapabilities {
    return {
      streaming: true,
      requiresApiKey: true,
      supportsEmotions: true,
      supportsCustomPitch: false,
      supportsCustomSpeed: true,
    };
  }

  listVoices(): VoiceProfile[] {
    if (this.cachedVoices) {
      return this.cachedVoices;
    }

    const isConfigured = this.availability() === "available";

    // Official OpenAI Speech voices: alloy, echo, fable, onyx, nova, shimmer, ash, coral, sage
    const catalog: VoiceProfile[] = [
      {
        id: "openai_alloy",
        name: "Alloy (OpenAI)",
        source: "online",
        sourceType: "online",
        provider: "openai",
        engine: "gpt_tts",
        gender: "female",
        accent: undefined,
        style: "conversational",
        ageGroup: "young",
        category: "conversational",
        isOnline: true,
        providerName: "OpenAI TTS",
        tags: ["OpenAI", "Đàm thoại", "Cân bằng"],
        supportedLanguages: ["en", "vi", "es", "fr", "de", "zh", "ja", "ko", "pt", "ar"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-emerald-500 to-teal-700",
        availability: isConfigured ? "available" : "not_configured",
        previewAvailable: isConfigured,
      },
      {
        id: "openai_echo",
        name: "Echo (OpenAI)",
        source: "online",
        sourceType: "online",
        provider: "openai",
        engine: "gpt_tts",
        gender: "male",
        accent: undefined,
        style: "natural",
        ageGroup: "middle_aged",
        category: "natural",
        isOnline: true,
        providerName: "OpenAI TTS",
        tags: ["OpenAI", "Tự nhiên", "Ấm áp"],
        supportedLanguages: ["en", "vi", "es", "fr", "de", "zh", "ja", "ko", "pt", "ar"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-blue-600 to-cyan-700",
        availability: isConfigured ? "available" : "not_configured",
        previewAvailable: isConfigured,
      },
      {
        id: "openai_fable",
        name: "Fable (OpenAI)",
        source: "online",
        sourceType: "online",
        provider: "openai",
        engine: "gpt_tts",
        gender: "male",
        accent: "en-gb", // Fable has a distinct British accent quality
        style: "storytelling",
        ageGroup: "young",
        category: "storytelling",
        isOnline: true,
        providerName: "OpenAI TTS",
        tags: ["OpenAI", "Kể chuyện", "UK"],
        supportedLanguages: ["en", "vi", "es", "fr", "de", "zh", "ja", "ko", "pt", "ar"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-amber-500 to-orange-600",
        availability: isConfigured ? "available" : "not_configured",
        previewAvailable: isConfigured,
      },
      {
        id: "openai_onyx",
        name: "Onyx (OpenAI)",
        source: "online",
        sourceType: "online",
        provider: "openai",
        engine: "gpt_tts",
        gender: "male",
        accent: undefined,
        style: "narration",
        ageGroup: "middle_aged",
        category: "narration",
        isOnline: true,
        providerName: "OpenAI TTS",
        tags: ["OpenAI", "Thuyết minh", "Trầm"],
        supportedLanguages: ["en", "vi", "es", "fr", "de", "zh", "ja", "ko", "pt", "ar"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-zinc-700 to-stone-900",
        availability: isConfigured ? "available" : "not_configured",
        previewAvailable: isConfigured,
      },
      {
        id: "openai_nova",
        name: "Nova (OpenAI)",
        source: "online",
        sourceType: "online",
        provider: "openai",
        engine: "gpt_tts",
        gender: "female",
        accent: undefined,
        style: "podcast",
        ageGroup: "young",
        category: "podcast",
        isOnline: true,
        providerName: "OpenAI TTS",
        tags: ["OpenAI", "Podcast", "Năng động"],
        supportedLanguages: ["en", "vi", "es", "fr", "de", "zh", "ja", "ko", "pt", "ar"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-violet-500 to-purple-700",
        availability: isConfigured ? "available" : "not_configured",
        previewAvailable: isConfigured,
      },
      {
        id: "openai_shimmer",
        name: "Shimmer (OpenAI)",
        source: "online",
        sourceType: "online",
        provider: "openai",
        engine: "gpt_tts",
        gender: "female",
        accent: undefined,
        style: "natural",
        ageGroup: "young",
        category: "natural",
        isOnline: true,
        providerName: "OpenAI TTS",
        tags: ["OpenAI", "Tự nhiên", "Trong trẻo"],
        supportedLanguages: ["en", "vi", "es", "fr", "de", "zh", "ja", "ko", "pt", "ar"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-rose-400 to-pink-600",
        availability: isConfigured ? "available" : "not_configured",
        previewAvailable: isConfigured,
      },
      {
        id: "openai_ash",
        name: "Ash (OpenAI)",
        source: "online",
        sourceType: "online",
        provider: "openai",
        engine: "gpt_tts",
        gender: "male",
        accent: undefined,
        style: "conversational",
        ageGroup: "young",
        category: "conversational",
        isOnline: true,
        providerName: "OpenAI TTS",
        tags: ["OpenAI", "Đàm thoại", "Tự nhiên"],
        supportedLanguages: ["en", "vi", "es", "fr", "de", "zh", "ja", "ko", "pt", "ar"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-slate-500 to-zinc-700",
        availability: isConfigured ? "available" : "not_configured",
        previewAvailable: isConfigured,
      },
      {
        id: "openai_coral",
        name: "Coral (OpenAI)",
        source: "online",
        sourceType: "online",
        provider: "openai",
        engine: "gpt_tts",
        gender: "female",
        accent: undefined,
        style: "natural",
        ageGroup: "young",
        category: "natural",
        isOnline: true,
        providerName: "OpenAI TTS",
        tags: ["OpenAI", "Tự nhiên", "Ấm áp"],
        supportedLanguages: ["en", "vi", "es", "fr", "de", "zh", "ja", "ko", "pt", "ar"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-orange-400 to-rose-500",
        availability: isConfigured ? "available" : "not_configured",
        previewAvailable: isConfigured,
      },
      {
        id: "openai_sage",
        name: "Sage (OpenAI)",
        source: "online",
        sourceType: "online",
        provider: "openai",
        engine: "gpt_tts",
        gender: "female",
        accent: undefined,
        style: "narration",
        ageGroup: "middle_aged",
        category: "narration",
        isOnline: true,
        providerName: "OpenAI TTS",
        tags: ["OpenAI", "Thuyết minh", "Điềm đạm"],
        supportedLanguages: ["en", "vi", "es", "fr", "de", "zh", "ja", "ko", "pt", "ar"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-emerald-600 to-green-800",
        availability: isConfigured ? "available" : "not_configured",
        previewAvailable: isConfigured,
      },
    ];

    this.cachedVoices = catalog;
    return catalog;
  }

  private currentAudio: HTMLAudioElement | null = null;

  stop() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
  }

  async preview(voice: VoiceProfile, _text?: string): Promise<PreviewResult> {
    this.stop();
    const apiKey = this.getApiKey();
    if (!apiKey) {
      // PROV-R-020: Graceful unconfigured state without crashing or faking
      return {
        success: false,
        isNotConfigured: true,
        unconfigured: true,
        error: "not_configured",
      };
    }

    try {
      // Real API synthesis if key is present
      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "tts-1",
          voice: voice.name.split(" ")[0].toLowerCase(),
          input: "Hello, this is a sample of OpenAI Text-to-Speech.",
        }),
      });

      if (!res.ok) {
        throw new Error(`OpenAI API error: ${res.statusText}`);
      }

      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      this.currentAudio = audio;
      audio.onended = () => {
        if (this.currentAudio === audio) {
          this.currentAudio = null;
        }
      };
      await audio.play();

      return { success: true, audioUrl };
    } catch (e: any) {
      return { success: false, error: e?.message || "Failed to preview OpenAI voice" };
    }
  }
}

export const openAiTtsProvider = new OpenAiTtsProvider();
