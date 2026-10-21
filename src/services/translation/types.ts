export type TranslationProviderType =
  | "google"
  | "gemini"
  | "openai"
  | "claude"
  | "deepseek"
  | "qwen"
  | "lmstudio"
  | "ollama"
  | "custom";

export interface TranslationConnectionResult {
  ok: boolean;
  message?: string;
  models?: string[];
}

import { DubbingMode } from "../../types/dubbing";

export type TranslationStyle = "default" | "cinema";

export interface TranslationContext {
  style?: TranslationStyle;
  cue?: { index: number; startSec: number; endSec: number; text: string };
  prevCues?: { index: number; startSec: number; endSec: number; text: string }[];
  nextCues?: { index: number; startSec: number; endSec: number; text: string }[];
  durationSec?: number;
  allCues?: { index: number; startSec: number; endSec: number; text: string }[];
  cueIndex?: number;
  groupSourceText?: string;
  groupId?: string;
  dubbingMode?: DubbingMode;
}

export interface BatchItem {
  id: number;
  text: string;
}

export interface BatchTranslationContext {
  /** Compact overview of the full script for topic/pronoun consistency across batches */
  globalSummary?: string;
  /** Preceding translated lines from the previous batch to keep pronouns & tone seamless */
  prevLines?: { source: string; translated: string }[];
  /** True when the entire script is sent in a single request */
  isFullScriptSinglePass?: boolean;
  /** Active dubbing mode: 'source_sync' or 'free_narration' */
  dubbingMode?: DubbingMode;
  /** Shared glossary of proper nouns, technical terms, and addressing rules across parallel batches */
  glossaryTerms?: string[];
  /** Read-only preceding source lines for context in concurrent batch execution */
  surroundingContextBefore?: string[];
  /** Read-only following source lines for context in concurrent batch execution */
  surroundingContextAfter?: string[];
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
  timeout?: number;
  maxTokens?: number;
  supportedLanguages?: string[];
  translate(
    text: string,
    targetLang: string,
    sourceLang?: string,
    context?: TranslationContext
  ): Promise<string>;
  translateBatch?(
    items: BatchItem[],
    targetLang: string,
    sourceLang?: string,
    style?: TranslationStyle,
    batchContext?: BatchTranslationContext
  ): Promise<Map<number, string>>;
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
  timeout?: number;
  maxTokens?: number;
  createdAt: number;
}

export interface ProviderRuntimeConfig {
  name?: string;
  apiKey?: string;
  endpoint?: string;
  model?: string;
  timeout?: number;
  maxTokens?: number;
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

/**
 * Normalizes an OpenAI-compatible base URL:
 * - Trims whitespace and trailing slashes
 * - Appends `/v1` if only scheme + host[:port] was provided (e.g. `http://127.0.0.1:1234` -> `http://127.0.0.1:1234/v1`)
 */
export function resolveOpenAiBaseUrl(rawEndpoint?: string, fallback = "http://localhost:1234/v1"): string {
  const cleaned = (rawEndpoint || "").trim().replace(/\/+$/, "");
  if (!cleaned) return fallback.replace(/\/+$/, "");
  if (/^https?:\/\/[^/]+$/i.test(cleaned)) {
    return `${cleaned}/v1`;
  }
  return cleaned;
}


