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
import { appHttpRequest } from "../http/nativeClient";
import {
  getGeminiKeyEntriesSync,
  getGeminiVaultStatus,
  loadGeminiKeyEntriesFromVault,
  loadTranslationSettings,
} from "../translation";

interface GoogleVoiceTargetMapping {
  lang: string;
  cloudLanguageCode: string;
  geminiVoiceName: string;
}

const GOOGLE_VOICE_MAPPINGS: Record<string, GoogleVoiceTargetMapping> = {
  google_vi: { lang: "vi", cloudLanguageCode: "vi-VN", geminiVoiceName: "Kore" },
  google_en_us: { lang: "en", cloudLanguageCode: "en-US", geminiVoiceName: "Puck" },
  google_en_uk: { lang: "en", cloudLanguageCode: "en-GB", geminiVoiceName: "Charon" },
  google_es: { lang: "es", cloudLanguageCode: "es-ES", geminiVoiceName: "Aoede" },
  google_fr: { lang: "fr", cloudLanguageCode: "fr-FR", geminiVoiceName: "Leda" },
  google_de: { lang: "de", cloudLanguageCode: "de-DE", geminiVoiceName: "Fenrir" },
  google_ja: { lang: "ja", cloudLanguageCode: "ja-JP", geminiVoiceName: "Kore" },
  google_zh: { lang: "zh", cloudLanguageCode: "cmn-CN", geminiVoiceName: "Aoede" },
};

function resolveGoogleVoiceMapping(voiceId: string, fallbackLang?: string): GoogleVoiceTargetMapping {
  if (GOOGLE_VOICE_MAPPINGS[voiceId]) {
    return GOOGLE_VOICE_MAPPINGS[voiceId];
  }
  const normalized = (fallbackLang || (voiceId.includes("vi") ? "vi" : "en")).toLowerCase();
  if (normalized.startsWith("vi")) {
    return GOOGLE_VOICE_MAPPINGS.google_vi;
  }
  if (normalized.startsWith("ja")) {
    return GOOGLE_VOICE_MAPPINGS.google_ja;
  }
  if (normalized.startsWith("zh")) {
    return GOOGLE_VOICE_MAPPINGS.google_zh;
  }
  if (normalized.startsWith("es")) {
    return GOOGLE_VOICE_MAPPINGS.google_es;
  }
  if (normalized.startsWith("fr")) {
    return GOOGLE_VOICE_MAPPINGS.google_fr;
  }
  if (normalized.startsWith("de")) {
    return GOOGLE_VOICE_MAPPINGS.google_de;
  }
  return GOOGLE_VOICE_MAPPINGS.google_en_us;
}

function decodeBase64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, "");
  if (typeof atob === "function") {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  }
  return new Uint8Array(Buffer.from(clean, "base64"));
}

/**
 * Ensures raw signed 16-bit LE mono PCM (`audio/L16`) or Google Cloud `LINEAR16` WAV
 * is formatted as a valid canonical RIFF PCM_16 WAV with exact non-zero durationSec.
 */
export function ensureCanonicalGoogleWav(
  rawBytes: Uint8Array,
  defaultSampleRate = 24000
): { wavBytes: Uint8Array; durationSec: number; sampleRate: number } {
  if (
    rawBytes.length >= 44 &&
    rawBytes[0] === 0x52 && // 'R'
    rawBytes[1] === 0x49 && // 'I'
    rawBytes[2] === 0x46 && // 'F'
    rawBytes[3] === 0x46 // 'F'
  ) {
    const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
    const sr = view.getUint32(24, true) || defaultSampleRate;
    const byteRate = view.getUint32(28, true) || sr * 2;
    let offset = 12;
    let dataSize = Math.max(0, rawBytes.length - 44);
    while (offset + 8 <= rawBytes.length) {
      const id0 = rawBytes[offset];
      const id1 = rawBytes[offset + 1];
      const id2 = rawBytes[offset + 2];
      const id3 = rawBytes[offset + 3];
      const chunkSize = view.getUint32(offset + 4, true);
      if (id0 === 0x64 && id1 === 0x61 && id2 === 0x74 && id3 === 0x61) {
        dataSize = Math.min(chunkSize, rawBytes.length - (offset + 8));
        break;
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }
    const durationSec = byteRate > 0 ? Number((dataSize / byteRate).toFixed(3)) : 0;
    return {
      wavBytes: rawBytes,
      durationSec: Math.max(0.01, durationSec),
      sampleRate: sr,
    };
  }

  const pcmByteLen = rawBytes.length & ~1;
  const wavBytes = new Uint8Array(44 + pcmByteLen);
  const view = new DataView(wavBytes.buffer);
  const writeAscii = (pos: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      wavBytes[pos + i] = str.charCodeAt(i);
    }
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + pcmByteLen, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM format = 1
  view.setUint16(22, 1, true); // Mono = 1 channel
  view.setUint32(24, defaultSampleRate, true);
  view.setUint32(28, defaultSampleRate * 2, true); // byteRate = sr * 1 * 2
  view.setUint16(32, 2, true); // blockAlign = 2
  view.setUint16(34, 16, true); // bitsPerSample = 16
  writeAscii(36, "data");
  view.setUint32(40, pcmByteLen, true);
  wavBytes.set(rawBytes.subarray(0, pcmByteLen), 44);

  const durationSec =
    pcmByteLen > 0 ? Number((pcmByteLen / (defaultSampleRate * 2)).toFixed(3)) : 0;
  return {
    wavBytes,
    durationSec: Math.max(0.01, durationSec),
    sampleRate: defaultSampleRate,
  };
}

function isTauriDesktopRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

export class GoogleTranslateTtsProvider implements TtsProviderAdapter {
  readonly id = "google_translate" as const;
  readonly sourceType = "online" as const;

  private static readonly cloudTtsUnsupportedKeys = new Set<string>();
  private cachedVoices: VoiceProfile[] | null = null;

  getDisplayName(_lang: SupportedLang): string {
    return "Google TTS";
  }

  getCandidateApiKeys(): string[] {
    const keys: string[] = [];
    const pushKey = (k?: string | null) => {
      const trimmed = (k || "").trim();
      if (trimmed && !keys.includes(trimmed)) {
        keys.push(trimmed);
      }
    };

    try {
      if (typeof globalThis.localStorage !== "undefined") {
        pushKey(globalThis.localStorage.getItem("voxlab_google_tts_api_key"));
      }
    } catch {
      // ignore storage access errors
    }

    try {
      const vaultEntries = getGeminiKeyEntriesSync();
      for (const entry of vaultEntries) {
        if (entry.role === "primary") pushKey(entry.apiKey);
      }
      for (const entry of vaultEntries) {
        if (entry.role !== "primary") pushKey(entry.apiKey);
      }
    } catch {
      // ignore vault sync access errors
    }

    try {
      pushKey(loadTranslationSettings().geminiApiKey);
    } catch {
      // ignore settings read errors
    }

    return keys;
  }

  getApiKey(): string | null {
    return this.getCandidateApiKeys()[0] || null;
  }

  private async ensureVaultHydrated(): Promise<void> {
    if (isTauriDesktopRuntime() && getGeminiVaultStatus() === "idle") {
      try {
        await loadGeminiKeyEntriesFromVault();
      } catch {
        // ignore vault load errors; getCandidateApiKeys will reflect availability
      }
    }
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

  private async requestGoogleSpeechWav(params: {
    spokenText: string;
    voiceId: string;
    fallbackLang?: string;
    speed?: number;
    candidateKeys: string[];
  }): Promise<{ wavBytes: Uint8Array; durationSec: number; sampleRate: number }> {
    const mapping = resolveGoogleVoiceMapping(params.voiceId, params.fallbackLang);
    const speed = Math.max(0.5, Math.min(2.0, params.speed ?? 1.0));
    let lastError = "Không thể kết nối tới dịch vụ Google TTS.";

    for (const key of params.candidateKeys) {
      // 1. Attempt GCP Cloud Text-to-Speech v1 first unless this key is known to be AI Studio / Gemini-only
      if (!GoogleTranslateTtsProvider.cloudTtsUnsupportedKeys.has(key)) {
        try {
          const cloudRes = await appHttpRequest(
            `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: {
                input: { text: params.spokenText },
                voice: {
                  languageCode: mapping.cloudLanguageCode,
                  name: params.voiceId.startsWith("google_") ? undefined : params.voiceId,
                },
                audioConfig: {
                  audioEncoding: "LINEAR16",
                  sampleRateHertz: 24000,
                  speakingRate: speed,
                },
              },
              timeoutSec: 45,
            }
          );

          if (cloudRes.ok && cloudRes.data?.audioContent) {
            const raw = decodeBase64ToBytes(String(cloudRes.data.audioContent));
            if (raw.length > 0) {
              return ensureCanonicalGoogleWav(raw, 24000);
            }
          }

          if ([400, 401, 403, 404].includes(cloudRes.status)) {
            GoogleTranslateTtsProvider.cloudTtsUnsupportedKeys.add(key);
          } else if (cloudRes.status === 429) {
            lastError = "Google Cloud TTS vượt giới hạn tốc độ (429).";
            continue;
          }
        } catch (err: any) {
          lastError = err?.message || lastError;
        }
      }

      // 2. Synthesize via Google Gemini Audio TTS (`gemini-2.5-flash-preview-tts`) using the same Google API key
      try {
        const paceHint =
          speed <= 0.85
            ? " at a slightly slower, deliberate pace"
            : speed >= 1.15
            ? " at a brisk, slightly faster pace"
            : "";
        const promptText = `Read the following text aloud verbatim${paceHint}, without adding, translating, or omitting any words:\n\n${params.spokenText}`;

        const geminiRes = await appHttpRequest(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${encodeURIComponent(key)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: {
              contents: [{ parts: [{ text: promptText }] }],
              generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: mapping.geminiVoiceName,
                    },
                  },
                },
              },
            },
            timeoutSec: 60,
          }
        );

        if (geminiRes.ok) {
          const parts = geminiRes.data?.candidates?.[0]?.content?.parts || [];
          const audioPart = parts.find(
            (p: any) => p?.inlineData?.data || p?.inline_data?.data
          );
          const inlineObj = audioPart?.inlineData || audioPart?.inline_data;
          if (inlineObj?.data) {
            const mime = String(inlineObj.mimeType || inlineObj.mime_type || "");
            const rateMatch = /rate=(\d+)/i.exec(mime);
            const sampleRate = rateMatch ? Number(rateMatch[1]) || 24000 : 24000;
            const raw = decodeBase64ToBytes(String(inlineObj.data));
            if (raw.length > 0) {
              return ensureCanonicalGoogleWav(raw, sampleRate);
            }
          }
          lastError = "Phản hồi từ Google Gemini TTS không chứa dữ liệu âm thanh.";
        } else {
          const apiErrMsg =
            geminiRes.data?.error?.message ||
            geminiRes.statusText ||
            `HTTP ${geminiRes.status}`;
          lastError = `Google TTS API lỗi (${geminiRes.status}): ${apiErrMsg}`;
          if (geminiRes.status === 429 || geminiRes.status === 503) {
            continue;
          }
        }
      } catch (err: any) {
        lastError = err?.message || lastError;
      }
    }

    throw new Error(lastError);
  }

  async preview(voice: VoiceProfile, text?: string, onEnded?: () => void): Promise<PreviewResult> {
    await this.ensureVaultHydrated();
    const candidateKeys = this.getCandidateApiKeys();
    if (candidateKeys.length === 0) {
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
      const sampleText =
        text ||
        (lang === "vi"
          ? "Xin chào, đây là giọng đọc thử nghiệm Google TTS trên VoxLab."
          : "Hello, this is a Google Text-to-Speech voice preview on VoxLab.");
      const { getEffectiveRules, prepareSpokenText } = await import("../pronunciation");
      const spokenSample = prepareSpokenText(sampleText, {
        rules: getEffectiveRules(),
        language: lang,
        engine: "google_translate",
      }).spokenText;

      const { wavBytes } = await this.requestGoogleSpeechWav({
        spokenText: spokenSample,
        voiceId: voice.id,
        fallbackLang: lang,
        speed: 1.0,
        candidateKeys,
      });

      const blob = new Blob([wavBytes.buffer as ArrayBuffer], { type: "audio/wav" });
      const audioUrl = URL.createObjectURL(blob);

      await previewAudioPlayer.play(audioUrl, onEnded);
      return { success: true, audioUrl };
    } catch (e: any) {
      return {
        success: false,
        errorCode: "PLAYBACK_FAILED",
        error: e?.message || "Failed to preview Google TTS voice",
      };
    }
  }

  async synthesize(options: ProviderSynthesizeParams): Promise<ProviderSynthesizeResult> {
    await this.ensureVaultHydrated();
    const candidateKeys = this.getCandidateApiKeys();
    if (candidateKeys.length === 0) {
      throw new Error(
        "Chưa cấu hình Google API Key. Vui lòng vào Cài đặt → Nhà cung cấp AI → Google Gemini để thêm API Key."
      );
    }

    const mapping = resolveGoogleVoiceMapping(options.voiceId);
    const { getEffectiveRules, prepareSpokenText } = await import("../pronunciation");
    const spokenText = prepareSpokenText(options.text, {
      rules: getEffectiveRules(),
      language: mapping.lang,
      engine: "google_translate",
    }).spokenText;
    options.onProgress?.(10, "connecting");

    const { wavBytes, durationSec, sampleRate } = await this.requestGoogleSpeechWav({
      spokenText,
      voiceId: options.voiceId,
      fallbackLang: mapping.lang,
      speed: options.speed ?? 1.0,
      candidateKeys,
    });

    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("fs_write_bytes", { path: options.outputPath, bytes: Array.from(wavBytes) });
    options.onProgress?.(100, "ready");

    return {
      outputPath: options.outputPath,
      durationSec,
      sampleRate,
      sizeBytes: wavBytes.length,
      format: "wav",
    };
  }

  stop(): void {
    previewAudioPlayer.stop();
  }
}

export const googleTranslateTtsProvider = new GoogleTranslateTtsProvider();
