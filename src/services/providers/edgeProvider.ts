import { VoiceProfile } from "../../types/ui";
import { SupportedLang } from "../../i18n/translations";
import {
  TtsProviderAdapter,
  ProviderCapabilities,
  PreviewResult,
  ProviderSynthesizeParams,
  ProviderSynthesizeResult,
} from "./types";
import { isTauriRuntime } from "../ai/tauriBackend";
import { readAudioFileBlobUrl } from "../batch/batchRuntime";
import { previewAudioPlayer } from "./audioPlayer";

export const EDGE_VOICE_MAP: Record<string, { voiceName: string; previewText: string }> = {
  edge_vi_hoaimy: {
    voiceName: "vi-VN-HoaiMyNeural",
    previewText: "Xin chào, đây là giọng đọc Hoài My của Microsoft Edge trên VoxLab.",
  },
  edge_vi_namminh: {
    voiceName: "vi-VN-NamMinhNeural",
    previewText: "Xin chào, đây là giọng đọc Nam Minh của Microsoft Edge trên VoxLab.",
  },
  edge_en_jenny: {
    voiceName: "en-US-JennyNeural",
    previewText: "Hello, this is Jenny's voice preview from Microsoft Edge on VoxLab.",
  },
  edge_en_guy: {
    voiceName: "en-US-GuyNeural",
    previewText: "Hello, this is Guy's voice preview from Microsoft Edge on VoxLab.",
  },
  edge_en_sonia: {
    voiceName: "en-GB-SoniaNeural",
    previewText: "Hello, this is Sonia's voice preview from Microsoft Edge on VoxLab.",
  },
  edge_es_elvira: {
    voiceName: "es-ES-ElviraNeural",
    previewText: "Hola, esta es una muestra de voz de Elvira en VoxLab.",
  },
  edge_fr_denise: {
    voiceName: "fr-FR-DeniseNeural",
    previewText: "Bonjour, ceci est un aperçu de la voix de Denise sur VoxLab.",
  },
  edge_de_katja: {
    voiceName: "de-DE-KatjaNeural",
    previewText: "Hallo, dies ist eine Sprachprobe von Katja auf VoxLab.",
  },
  edge_ja_nanami: {
    voiceName: "ja-JP-NanamiNeural",
    previewText: "こんにちは、VoxLabでの音声プレビューです。",
  },
  edge_zh_xiaoxiao: {
    voiceName: "zh-CN-XiaoxiaoNeural",
    previewText: "你好，这是晓晓在 VoxLab 的语音试听。",
  },
  edge_en_ava_multi: {
    voiceName: "en-US-AvaMultilingualNeural",
    previewText: "Hello, this is Ava Multilingual's voice preview from Microsoft Edge on VoxLab.",
  },
  edge_en_andrew_multi: {
    voiceName: "en-US-AndrewMultilingualNeural",
    previewText: "Hello, this is Andrew Multilingual's voice preview from Microsoft Edge on VoxLab.",
  },
  edge_en_emma_multi: {
    voiceName: "en-US-EmmaMultilingualNeural",
    previewText: "Hello, this is Emma Multilingual's voice preview from Microsoft Edge on VoxLab.",
  },
  edge_en_brian_multi: {
    voiceName: "en-US-BrianMultilingualNeural",
    previewText: "Hello, this is Brian Multilingual's voice preview from Microsoft Edge on VoxLab.",
  },
  edge_en_aria: {
    voiceName: "en-US-AriaNeural",
    previewText: "Hello, this is Aria's voice preview from Microsoft Edge on VoxLab.",
  },
  edge_en_christopher: {
    voiceName: "en-US-ChristopherNeural",
    previewText: "Hello, this is Christopher's voice preview from Microsoft Edge on VoxLab.",
  },
  edge_en_roger: {
    voiceName: "en-US-RogerNeural",
    previewText: "Hello, this is Roger's voice preview from Microsoft Edge on VoxLab.",
  },
  edge_en_ryan: {
    voiceName: "en-GB-RyanNeural",
    previewText: "Hello, this is Ryan's voice preview from Microsoft Edge on VoxLab.",
  },
  edge_en_libby: {
    voiceName: "en-GB-LibbyNeural",
    previewText: "Hello, this is Libby's voice preview from Microsoft Edge on VoxLab.",
  },
  edge_fr_vivienne_multi: {
    voiceName: "fr-FR-VivienneMultilingualNeural",
    previewText: "Bonjour, ceci est un aperçu de la voix multilingue de Vivienne sur VoxLab.",
  },
  edge_fr_remy_multi: {
    voiceName: "fr-FR-RemyMultilingualNeural",
    previewText: "Bonjour, ceci est un aperçu de la voix multilingue de Remy sur VoxLab.",
  },
  edge_de_seraphina_multi: {
    voiceName: "de-DE-SeraphinaMultilingualNeural",
    previewText: "Hallo, dies ist eine mehrsprachige Sprachprobe von Seraphina auf VoxLab.",
  },
  edge_de_florian_multi: {
    voiceName: "de-DE-FlorianMultilingualNeural",
    previewText: "Hallo, dies ist eine mehrsprachige Sprachprobe von Florian auf VoxLab.",
  },
  edge_zh_yunxi: {
    voiceName: "zh-CN-YunxiNeural",
    previewText: "你好，这是云希在 VoxLab 的语音试听。",
  },
  edge_zh_xiaoyi: {
    voiceName: "zh-CN-XiaoyiNeural",
    previewText: "你好，这是晓伊在 VoxLab 的语音试听。",
  },
  edge_ja_keita: {
    voiceName: "ja-JP-KeitaNeural",
    previewText: "こんにちは、圭太のVoxLabでの音声プレビューです。",
  },
  edge_ko_sunhi: {
    voiceName: "ko-KR-SunHiNeural",
    previewText: "안녕하세요, VoxLab에서 제공하는 선희 음성 미리듣기입니다.",
  },
  edge_ko_injoon: {
    voiceName: "ko-KR-InJoonNeural",
    previewText: "안녕하세요, VoxLab에서 제공하는 인준 음성 미리듣기입니다.",
  },
};

export function resolveEdgeVoiceName(voiceId: string): string | null {
  if (EDGE_VOICE_MAP[voiceId]) {
    return EDGE_VOICE_MAP[voiceId].voiceName;
  }
  if (voiceId.includes("Neural")) {
    return voiceId;
  }
  return null;
}

export function formatEdgeRate(speed = 1.0): string {
  const percent = Math.round((speed - 1.0) * 100);
  return `${percent >= 0 ? "+" : ""}${percent}%`;
}

export function formatEdgePitch(pitch = 1.0): string {
  const hz = Math.round((pitch - 1.0) * 50);
  return `${hz >= 0 ? "+" : ""}${hz}Hz`;
}

export function formatEdgeVolume(volume = 1.0): string {
  const percent = Math.round((volume - 1.0) * 100);
  return `${percent >= 0 ? "+" : ""}${percent}%`;
}

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
      {
        id: "edge_en_ava_multi",
        name: "Ava Multilingual (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "female",
        country: "US",
        accent: "en-us",
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Female", "Đa ngữ"],
        supportedLanguages: ["en", "vi", "fr", "de", "es", "ja", "zh", "ko"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-fuchsia-500 to-purple-600",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "edge_en_andrew_multi",
        name: "Andrew Multilingual (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "male",
        country: "US",
        accent: "en-us",
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Male", "Đa ngữ"],
        supportedLanguages: ["en", "vi", "fr", "de", "es", "ja", "zh", "ko"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-indigo-500 to-blue-600",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "edge_en_emma_multi",
        name: "Emma Multilingual (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "female",
        country: "US",
        accent: "en-us",
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Female", "Đa ngữ"],
        supportedLanguages: ["en", "vi", "fr", "de", "es", "ja", "zh", "ko"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-pink-500 to-rose-600",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "edge_en_brian_multi",
        name: "Brian Multilingual (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "male",
        country: "US",
        accent: "en-us",
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Male", "Đa ngữ"],
        supportedLanguages: ["en", "vi", "fr", "de", "es", "ja", "zh", "ko"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-cyan-600 to-blue-700",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "edge_en_aria",
        name: "Aria (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "female",
        country: "US",
        accent: "en-us",
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Female"],
        supportedLanguages: ["en"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-violet-500 to-indigo-600",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "edge_en_christopher",
        name: "Christopher (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "male",
        country: "US",
        accent: "en-us",
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Male"],
        supportedLanguages: ["en"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-emerald-600 to-teal-700",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "edge_en_roger",
        name: "Roger (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "male",
        country: "US",
        accent: "en-us",
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Male"],
        supportedLanguages: ["en"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-slate-700 to-zinc-800",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "edge_en_ryan",
        name: "Ryan (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "male",
        country: "GB",
        accent: "en-gb",
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Male"],
        supportedLanguages: ["en"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-blue-500 to-indigo-700",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "edge_en_libby",
        name: "Libby (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "female",
        country: "GB",
        accent: "en-gb",
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Female"],
        supportedLanguages: ["en"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-rose-400 to-pink-600",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "edge_fr_vivienne_multi",
        name: "Vivienne Multilingual (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "female",
        country: "FR",
        accent: "fr-fr",
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Female", "Đa ngữ"],
        supportedLanguages: ["fr", "en", "es", "de"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-pink-600 to-purple-600",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "edge_fr_remy_multi",
        name: "Remy Multilingual (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "male",
        country: "FR",
        accent: "fr-fr",
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Male", "Đa ngữ"],
        supportedLanguages: ["fr", "en", "es", "de"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-blue-600 to-cyan-600",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "edge_de_seraphina_multi",
        name: "Seraphina Multilingual (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "female",
        country: "DE",
        accent: "de-de",
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Female", "Đa ngữ"],
        supportedLanguages: ["de", "en", "fr", "es"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-amber-500 to-orange-600",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "edge_de_florian_multi",
        name: "Florian Multilingual (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "male",
        country: "DE",
        accent: "de-de",
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Male", "Đa ngữ"],
        supportedLanguages: ["de", "en", "fr", "es"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-yellow-600 to-orange-700",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "edge_zh_yunxi",
        name: "Yunxi (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "male",
        country: "CN",
        accent: undefined,
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Male"],
        supportedLanguages: ["zh"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-red-600 to-rose-700",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "edge_zh_xiaoyi",
        name: "Xiaoyi (Edge)",
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
        avatarColor: "from-orange-500 to-red-600",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "edge_ja_keita",
        name: "Keita (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "male",
        country: "JP",
        accent: undefined,
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Male"],
        supportedLanguages: ["ja"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-indigo-500 to-purple-600",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "edge_ko_sunhi",
        name: "SunHi (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "female",
        country: "KR",
        accent: undefined,
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Female"],
        supportedLanguages: ["ko"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-sky-500 to-indigo-600",
        availability: "available",
        previewAvailable: true,
      },
      {
        id: "edge_ko_injoon",
        name: "InJoon (Edge)",
        source: "edge",
        origin: "system",
        sourceType: "online",
        provider: "edge",
        engine: "edge_tts",
        gender: "male",
        country: "KR",
        accent: undefined,
        style: undefined,
        ageGroup: undefined,
        category: undefined,
        isOnline: true,
        providerName: "Edge TTS",
        tags: ["Male"],
        supportedLanguages: ["ko"],
        modelCompatibility: ["Omni Voice", "Chatterbox Turbo", "Qwen 1.7B"],
        isFavorite: false,
        avatarColor: "from-blue-600 to-slate-800",
        availability: "available",
        previewAvailable: true,
      },
    ];

    this.cachedVoices = catalog;
    return catalog;
  }

  async preview(voice: VoiceProfile, text?: string, onEnded?: () => void): Promise<PreviewResult> {
    try {
      if (!isTauriRuntime()) {
        return {
          success: false,
          errorCode: "PROVIDER_UNAVAILABLE",
          error: "Sidecar runtime not available in browser mode",
        };
      }

      const mapping = EDGE_VOICE_MAP[voice.id];
      let edgeVoiceName = mapping?.voiceName;
      if (!edgeVoiceName) {
        if (voice.id.includes("Neural")) {
          edgeVoiceName = voice.id;
        } else if (voice.supportedLanguages.includes("vi")) {
          edgeVoiceName = "vi-VN-HoaiMyNeural";
        } else {
          edgeVoiceName = "en-US-JennyNeural";
        }
      }

      const isVi = voice.supportedLanguages.includes("vi");
      const sampleText = text || mapping?.previewText || (isVi
        ? "Xin chào, đây là giọng đọc thử nghiệm của Microsoft Edge trên VoxLab."
        : "Hello, this is a voice sample preview from Microsoft Edge on VoxLab.");
      const { getEffectiveRules, prepareSpokenText } = await import("../pronunciation");
      const rules = getEffectiveRules();
      const spokenSample = prepareSpokenText(sampleText, { rules, engine: "edge" }).spokenText;

      const { invoke } = await import("@tauri-apps/api/core");
      let synthResult: {
        outputPath: string;
        durationSec: number;
        sampleRate: number;
        sizeBytes: number;
        format: string;
      } | null = null;
      for (let busyAttempt = 0; ; busyAttempt++) {
        try {
          synthResult = await invoke<{
            outputPath: string;
            durationSec: number;
            sampleRate: number;
            sizeBytes: number;
            format: string;
          }>("ai_request", {
            runtime: "core",
            method: "tts.edge_preview",
            params: {
              voice: edgeVoiceName,
              text: spokenSample,
              pronunciationRules: rules,
            },
          });
          break;
        } catch (err: any) {
          const msg = String(err?.message || err || "");
          if ((err?.code === "BUSY" || msg.includes("[BUSY]")) && busyAttempt < 12) {
            await new Promise((r) => setTimeout(r, Math.min(800, 150 * (busyAttempt + 1))));
            continue;
          }
          throw err;
        }
      }

      if (!synthResult || !synthResult.outputPath) {
        return {
          success: false,
          errorCode: "PROVIDER_UNAVAILABLE",
          error: "Edge TTS service did not return an audio file",
        };
      }

      const blobUrl = await readAudioFileBlobUrl(synthResult.outputPath);
      await previewAudioPlayer.play(blobUrl, onEnded);

      return {
        success: true,
        audioUrl: blobUrl,
      };
    } catch (e: any) {
      const code = e?.code || (e?.message?.includes("Network") || e?.message?.includes("connect")
        ? "NETWORK_ERROR"
        : e?.message?.includes("not found")
        ? "VOICE_NOT_FOUND"
        : "PLAYBACK_FAILED");
      return {
        success: false,
        errorCode: code,
        error: e?.message || "Failed to preview Edge voice",
      };
    }
  }

  async synthesize(options: ProviderSynthesizeParams): Promise<ProviderSynthesizeResult> {
    if (!isTauriRuntime()) {
      throw new Error("Sidecar runtime not available in browser mode");
    }

    const edgeVoiceName = resolveEdgeVoiceName(options.voiceId);
    if (!edgeVoiceName) {
      throw new Error(`Giọng Edge "${options.voiceId}" không hợp lệ hoặc không tìm thấy.`);
    }

    const { getEffectiveRules, prepareSpokenText } = await import("../pronunciation");
    const rules = getEffectiveRules();
    const spokenText = prepareSpokenText(options.text, { rules, engine: "edge" }).spokenText;

    const { invoke } = await import("@tauri-apps/api/core");
    options.onProgress?.(10, "connecting");

    let synthResult: {
      outputPath: string;
      durationSec: number;
      sampleRate: number;
      sizeBytes: number;
      format: string;
    } | null = null;
    for (let busyAttempt = 0; ; busyAttempt++) {
      try {
        synthResult = await invoke<{
          outputPath: string;
          durationSec: number;
          sampleRate: number;
          sizeBytes: number;
          format: string;
        }>("ai_request", {
          runtime: "core",
          method: "tts.edge_synthesize",
          params: {
            voice: edgeVoiceName,
            text: spokenText,
            outputPath: options.outputPath,
            rate: formatEdgeRate(options.speed),
            pitch: formatEdgePitch(options.pitch),
            volume: formatEdgeVolume(options.volume),
            pronunciationRules: rules,
          },
        });
        break;
      } catch (err: any) {
        const msg = String(err?.message || err || "");
        if ((err?.code === "BUSY" || msg.includes("[BUSY]")) && busyAttempt < 12) {
          await new Promise((r) => setTimeout(r, Math.min(800, 150 * (busyAttempt + 1))));
          continue;
        }
        throw err;
      }
    }

    if (!synthResult || !synthResult.outputPath) {
      throw new Error("Edge TTS synthesis did not return an output file");
    }

    options.onProgress?.(100, "ready");
    return synthResult;
  }

  stop(): void {
    previewAudioPlayer.stop();
  }
}

export const edgeTtsProvider = new EdgeTtsProvider();
