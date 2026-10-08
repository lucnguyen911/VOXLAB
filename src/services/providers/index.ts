import { VoiceProfile, VoiceProviderId } from "../../types/ui";
import { TtsProviderAdapter, PreviewResult } from "./types";
import { edgeTtsProvider } from "./edgeProvider";
import { openAiTtsProvider } from "./openaiProvider";
import { googleTranslateTtsProvider } from "./googleProvider";
import { localTtsProvider } from "./localProvider";
import { cloneVoiceProvider } from "./cloneProvider";

import { previewAudioPlayer } from "./audioPlayer";

export * from "./types";
export * from "./audioPlayer";
export * from "./edgeProvider";
export * from "./openaiProvider";
export * from "./googleProvider";
export * from "./localProvider";
export * from "./cloneProvider";
export * from "./voiceSnapshot";
export * from "./unifiedSynthesis";

class ProviderRegistry {
  private adapters: Map<VoiceProviderId, TtsProviderAdapter> = new Map();

  constructor() {
    this.register(edgeTtsProvider);
    this.register(openAiTtsProvider);
    this.register(googleTranslateTtsProvider);
    this.register(localTtsProvider);
    this.register(cloneVoiceProvider);
  }

  register(adapter: TtsProviderAdapter) {
    this.adapters.set(adapter.id, adapter);
  }

  getAdapter(providerId?: VoiceProviderId): TtsProviderAdapter | undefined {
    if (!providerId) return undefined;
    return this.adapters.get(providerId);
  }

  /**
   * Returns normalized voices from all online providers (Edge, OpenAI, Google)
   * Cached inside each adapter to avoid redundant processing.
   */
  getOnlineProviderVoices(): VoiceProfile[] {
    const edgeVoices = edgeTtsProvider.listVoices();
    const googleVoices = googleTranslateTtsProvider.listVoices();

    return [...edgeVoices, ...googleVoices];
  }

  /**
   * Play an audio URL (blob URL or asset URL) with guaranteed end-of-audio callback.
   */
  async playAudio(audioUrl: string, onEnded?: () => void): Promise<void> {
    await previewAudioPlayer.play(audioUrl, onEnded);
  }

  /**
   * Immediately stops any playing preview audio
   */
  stopPreview(): void {
    previewAudioPlayer.stop();
    for (const adapter of this.adapters.values()) {
      if (adapter.stop) {
        try {
          adapter.stop();
        } catch {}
      }
    }
  }

  /**
   * Unified preview flow for any voice profile
   * Guarantees failure isolation: an error here does not crash the app or modal.
   */
  async previewVoice(voice: VoiceProfile, onEnded?: () => void): Promise<PreviewResult> {
    this.stopPreview();

    const adapter = this.getAdapter(voice.provider);
    if (adapter) {
      return await adapter.preview(voice, undefined, onEnded);
    }

    return {
      success: false,
      errorCode: "PROVIDER_UNAVAILABLE",
      error: `Chưa hỗ trợ provider '${voice.provider}'`,
    };
  }
}

export const providerRegistry = new ProviderRegistry();
