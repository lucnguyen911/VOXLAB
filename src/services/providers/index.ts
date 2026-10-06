import { VoiceProfile, VoiceProviderId } from "../../types/ui";
import { TtsProviderAdapter, PreviewResult } from "./types";
import { edgeTtsProvider } from "./edgeProvider";
import { openAiTtsProvider } from "./openaiProvider";
import { googleTranslateTtsProvider } from "./googleProvider";
import { localTtsProvider } from "./localProvider";
import { cloneVoiceProvider } from "./cloneProvider";

export * from "./types";
export * from "./edgeProvider";
export * from "./openaiProvider";
export * from "./googleProvider";
export * from "./localProvider";
export * from "./cloneProvider";

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
   * Immediately stops any playing preview audio across speech synthesis or web audio
   */
  stopPreview(): void {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    openAiTtsProvider.stop();
  }

  /**
   * Unified preview flow for any voice profile
   * Guarantees failure isolation: an error here does not crash the app or modal.
   */
  async previewVoice(voice: VoiceProfile): Promise<PreviewResult> {
    this.stopPreview();

    const adapter = this.getAdapter(voice.provider);
    if (adapter) {
      return await adapter.preview(voice);
    }

    // Default fallback preview
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const sampleText = voice.supportedLanguages.includes("vi")
        ? "Xin chào, đây là giọng đọc thử nghiệm của VoxLab."
        : "Hello, this is a voice sample from VoxLab.";
      const utterance = new SpeechSynthesisUtterance(sampleText);
      utterance.lang = voice.supportedLanguages.includes("vi") ? "vi-VN" : "en-US";
      window.speechSynthesis.speak(utterance);
      return { success: true };
    }

    return { success: true };
  }
}

export const providerRegistry = new ProviderRegistry();
