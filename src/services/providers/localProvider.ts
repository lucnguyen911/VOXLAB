import { VoiceProfile } from "../../types/ui";
import { SupportedLang } from "../../i18n/translations";
import { TtsProviderAdapter, ProviderCapabilities, PreviewResult } from "./types";
import { previewAudioPlayer } from "./audioPlayer";

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

  async preview(voice: VoiceProfile, _text?: string, onEnded?: () => void): Promise<PreviewResult> {
    try {
      let samplePath = voice.sampleAudioPath;
      if (!samplePath || (!samplePath.includes(":") && !samplePath.startsWith("/") && !samplePath.startsWith("\\"))) {
        try {
          const { resolveUnifiedVoiceReference } = await import("../ai/presetVoiceRegistry");
          const ref = resolveUnifiedVoiceReference(voice.id);
          if (ref?.refAudioPath) {
            samplePath = ref.refAudioPath;
          }
        } catch {
          // ignore
        }
      }
      samplePath = samplePath || "/audio/samples/default_local.mp3";
      await previewAudioPlayer.play(samplePath, onEnded);
      return { success: true, audioUrl: samplePath };
    } catch (e: any) {
      return {
        success: false,
        errorCode: "PLAYBACK_FAILED",
        error: e?.message || "Failed to preview local voice",
      };
    }
  }

  stop(): void {
    previewAudioPlayer.stop();
  }
}

export const localTtsProvider = new LocalTtsProvider();
