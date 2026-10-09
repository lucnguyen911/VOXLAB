export type TranslationProviderType =
  | "google"
  | "gemini"
  | "deepseek"
  | "lmstudio"
  | "ollama"
  | "custom";

export interface TranslationConnectionResult {
  ok: boolean;
  message?: string;
  models?: string[];
}

export type TranslationStyle = "default" | "cinema";

export interface TranslationContext {
  style?: TranslationStyle;
  cue?: { index: number; startSec: number; endSec: number; text: string };
  prevCues?: { index: number; startSec: number; endSec: number; text: string }[];
  nextCues?: { index: number; startSec: number; endSec: number; text: string }[];
  durationSec?: number;
  allCues?: { index: number; startSec: number; endSec: number; text: string }[];
  cueIndex?: number;
}

export interface TranslationProvider {
  id: string;
  displayName: string;
  type: TranslationProviderType;
  badge: string; // e.g. "Miễn phí" | "API" | "Local"
  description: string;
  endpoint?: string;
  apiKey?: string;
  model?: string;
  supportedLanguages?: string[];
  translate(
    text: string,
    targetLang: string,
    sourceLang?: string,
    context?: TranslationContext
  ): Promise<string>;
  testConnection?(): Promise<TranslationConnectionResult>;
}

export interface TranslationJobOptions {
  providerId?: string;
  sourceLang?: string;
  targetLang: string;
  onProgress?: (completed: number, total: number) => void;
  style?: TranslationStyle;
}

export interface CustomTranslationModel {
  id: string;
  name: string;
  type: "lmstudio" | "openai_compatible";
  endpoint: string;
  apiKey?: string;
  model: string;
  createdAt: number;
}

export interface TranslationSettings {
  sourceLanguage?: string; // default "auto"
  targetLanguage: string; // default "vi"
  translationProviderId: string; // default "google"
  geminiApiKey?: string;
  deepseekApiKey?: string;
  customModels: CustomTranslationModel[];
  autoTranslate?: boolean;
  translationStyle?: TranslationStyle; // default "default"
}


