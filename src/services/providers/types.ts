import { VoiceProfile, VoiceProviderId, VoiceSourceType, VoiceAvailability } from "../../types/ui";
import { SupportedLang } from "../../i18n/translations";

export interface ProviderCapabilities {
  streaming: boolean;
  requiresApiKey: boolean;
  supportsEmotions: boolean;
  supportsCustomPitch: boolean;
  supportsCustomSpeed: boolean;
}

export interface PreviewResult {
  success: boolean;
  audioUrl?: string;
  error?: string;
  errorCode?: string;
  isNotConfigured?: boolean;
  unconfigured?: boolean;
}

export interface ProviderSynthesizeParams {
  voiceId: string;
  text: string;
  outputPath: string;
  speed?: number;
  pitch?: number;
  volume?: number;
  onProgress?: (pct: number, stage: string) => void;
}

export interface ProviderSynthesizeResult {
  outputPath: string;
  durationSec: number;
  sampleRate: number;
  sizeBytes?: number;
  format: string;
}

export interface TtsProviderAdapter {
  readonly id: VoiceProviderId;
  readonly sourceType: VoiceSourceType;
  getDisplayName(lang: SupportedLang): string;
  availability(): Promise<VoiceAvailability> | VoiceAvailability;
  listVoices(): Promise<VoiceProfile[]> | VoiceProfile[];
  preview(voice: VoiceProfile, text?: string, onEnded?: () => void): Promise<PreviewResult>;
  synthesize?(params: ProviderSynthesizeParams): Promise<ProviderSynthesizeResult>;
  stop?(): void;
  capabilities(): ProviderCapabilities;
}
