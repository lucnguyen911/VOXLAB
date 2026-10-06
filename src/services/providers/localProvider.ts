import { VoiceProfile } from "../../types/ui";
import { SupportedLang } from "../../i18n/translations";
import { TtsProviderAdapter, ProviderCapabilities, PreviewResult } from "./types";

export class LocalTtsProvider implements TtsProviderAdapter {
  readonly id = "local" as const;
  readonly sourceType = "local" as const;

  // PROV-R-001 / PROV-R-015: Local engines strictly limited to OmniVoice, Chatterbox Turbo, Qwen TTS 1.7B
  readonly supportedEngines = ["omnivoice", "chatterbox_turbo", "qwen_tts_1_7b"] as const;

  getDisplayName(_lang: SupportedLang): string {
    return "Local";
  }

  availability() {
    return "available" as const;
  }

  capabilities(): ProviderCapabilities {
    return {
      streaming: true,
      requiresApiKey: false,
      supportsEmotions: true,
      supportsCustomPitch: true,
      supportsCustomSpeed: true,
    };
  }

  listVoices(): VoiceProfile[] {
    return [];
  }

  async preview(voice: VoiceProfile, _text?: string): Promise<PreviewResult> {
    try {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const sampleText = voice.supportedLanguages.includes("vi")
          ? "Xin chào, đây là bản nghe thử giọng đọc cục bộ của VoxLab."
          : "Hello, this is a local voice preview in VoxLab.";
        const utterance = new SpeechSynthesisUtterance(sampleText);
        utterance.lang = voice.supportedLanguages.includes("vi") ? "vi-VN" : "en-US";
        window.speechSynthesis.speak(utterance);
        return { success: true };
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || "Failed to preview local voice" };
    }
  }
}

export const localTtsProvider = new LocalTtsProvider();
