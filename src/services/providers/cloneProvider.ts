import { VoiceProfile } from "../../types/ui";
import { SupportedLang } from "../../i18n/translations";
import { TtsProviderAdapter, ProviderCapabilities, PreviewResult } from "./types";

import { previewAudioPlayer } from "./audioPlayer";

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

  async preview(voice: VoiceProfile, _text?: string, onEnded?: () => void): Promise<PreviewResult> {
    try {
      let samplePath = voice.sampleAudioPath || (voice as any).refAudioPath;
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
        error: e?.message || "Failed to preview clone voice",
      };
    }
  }

  stop(): void {
    previewAudioPlayer.stop();
  }
}

export const cloneVoiceProvider = new CloneVoiceProvider();
