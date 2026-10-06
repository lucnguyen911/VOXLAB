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
  isNotConfigured?: boolean;
  unconfigured?: boolean;
}

export interface TtsProviderAdapter {
  readonly id: VoiceProviderId;
  readonly sourceType: VoiceSourceType;
  getDisplayName(lang: SupportedLang): string;
  availability(): Promise<VoiceAvailability> | VoiceAvailability;
  listVoices(): Promise<VoiceProfile[]> | VoiceProfile[];
  preview(voice: VoiceProfile, text?: string): Promise<PreviewResult>;
  synthesize?(voice: VoiceProfile, text: string, options?: any): Promise<PreviewResult>;
  capabilities(): ProviderCapabilities;
}
