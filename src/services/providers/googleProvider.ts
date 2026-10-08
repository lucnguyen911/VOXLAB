import { VoiceProfile } from "../../types/ui";
import { SupportedLang } from "../../i18n/translations";
import {
  TtsProviderAdapter,
  ProviderCapabilities,
  PreviewResult,
  ProviderSynthesizeParams,
  ProviderSynthesizeResult,
} from "./types";
import { previewAudioPlayer } from "./audioPlayer";

export class GoogleTranslateTtsProvider implements TtsProviderAdapter {
  readonly id = "google_translate" as const;
  readonly sourceType = "online" as const;

  private cachedVoices: VoiceProfile[] | null = null;

  getDisplayName(_lang: SupportedLang): string {
    return "Google TTS";
  }

  getApiKey(): string | null {
    if (typeof window !== "undefined") {
      return localStorage.getItem("voxlab_google_tts_api_key") || null;
    }
    return null;
  }

  availability() {
    const hasKey = Boolean(this.getApiKey());
    return hasKey ? ("available" as const) : ("not_configured" as const);
  }

  capabilities(): ProviderCapabilities {
    return {
      streaming: false,
      requiresApiKey: true,
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

  async preview(voice: VoiceProfile, text?: string, onEnded?: () => void): Promise<PreviewResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return {
        success: false,
        isNotConfigured: true,
        unconfigured: true,
        errorCode: "AUTH_REQUIRED",
        error: "Chưa cấu hình Google TTS",
      };
    }

    try {
      const lang = voice.supportedLanguages[0] || "vi";
      const sampleText = text || (lang === "vi" ? "Xin chào, đây là giọng đọc thử nghiệm Google Cloud TTS." : "Hello, this is Google Cloud Text-to-Speech preview.");

      const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { text: sampleText },
          voice: {
            languageCode: lang === "vi" ? "vi-VN" : "en-US",
            name: voice.id.startsWith("google_") ? undefined : voice.id,
          },
          audioConfig: { audioEncoding: "MP3" },
        }),
      });

      if (!res.ok) {
        throw new Error(`Google Cloud TTS API error: ${res.statusText}`);
      }

      const data = await res.json();
      if (!data.audioContent) {
        throw new Error("No audioContent in Google Cloud response");
      }

      const byteCharacters = atob(data.audioContent);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: "audio/mpeg" });
      const audioUrl = URL.createObjectURL(blob);

      await previewAudioPlayer.play(audioUrl, onEnded);
      return { success: true, audioUrl };
    } catch (e: any) {
      return {
        success: false,
        errorCode: "PLAYBACK_FAILED",
        error: e?.message || "Failed to preview Google Cloud voice",
      };
    }
  }

  async synthesize(options: ProviderSynthesizeParams): Promise<ProviderSynthesizeResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error("Chưa cấu hình Google TTS. Vui lòng vào Cài đặt để thêm API Key.");
    }

    const isVi = options.voiceId.includes("vi");
    const langCode = isVi ? "vi-VN" : "en-US";
    options.onProgress?.(10, "connecting");

    const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text: options.text },
        voice: {
          languageCode: langCode,
          name: options.voiceId.startsWith("google_") ? undefined : options.voiceId,
        },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate: options.speed ?? 1.0,
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Google Cloud TTS API error: ${res.statusText}`);
    }

    const data = await res.json();
    if (!data.audioContent) {
      throw new Error("Không nhận được dữ liệu âm thanh từ Google Cloud TTS");
    }

    const byteCharacters = atob(data.audioContent);
    const bytes = new Uint8Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      bytes[i] = byteCharacters.charCodeAt(i);
    }

    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("fs_write_bytes", { path: options.outputPath, bytes: Array.from(bytes) });
    options.onProgress?.(100, "ready");

    return {
      outputPath: options.outputPath,
      durationSec: 0,
      sampleRate: 24000,
      sizeBytes: bytes.length,
      format: "mp3",
    };
  }

  stop(): void {
    previewAudioPlayer.stop();
  }
}

export const googleTranslateTtsProvider = new GoogleTranslateTtsProvider();
