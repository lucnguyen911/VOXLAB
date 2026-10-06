import { VoiceProfile } from "../../types/ui";
import { SupportedLang } from "../../i18n/translations";
import { TtsProviderAdapter, ProviderCapabilities, PreviewResult } from "./types";

export class CloneVoiceProvider implements TtsProviderAdapter {
  readonly id = "clone" as const;
  readonly sourceType = "clone" as const;

  getDisplayName(_lang: SupportedLang): string {
    return "Clone";
  }

  availability() {
    return "available" as const;
  }

  capabilities(): ProviderCapabilities {
    return {
      streaming: false,
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
          ? "Xin chào, đây là bản nghe thử giọng nhân bản của bạn."
          : "Hello, this is a preview of your cloned voice.";
        const utterance = new SpeechSynthesisUtterance(sampleText);
        utterance.lang = voice.supportedLanguages.includes("vi") ? "vi-VN" : "en-US";
        window.speechSynthesis.speak(utterance);
        return { success: true };
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || "Failed to preview clone voice" };
    }
  }
}

export const cloneVoiceProvider = new CloneVoiceProvider();
