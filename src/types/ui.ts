export type WorkspaceId =
  | "tts"
  | "dialogue"
  | "clone"
  | "library"
  | "transcription"
  | "dubbing"
  | "batch"
  | "history"
  | "settings";

export type ChunkStatus = "pending" | "generating" | "ready" | "failed" | "modified";

export type ChunkDensity = "comfortable" | "compact";

export interface EffectiveVoiceSnapshot {
  voiceId: string;
  provider: VoiceProviderId;
  engine?: VoiceEngineId | string;
  modelId?: string;
  language?: string;
  voiceName: string;
  speed: number;
  pitch?: number;
  volume?: number;
  providerVoiceId?: string;
  refAudioPath?: string;
  refText?: string;
}

export type AudioQualityStatus = "pass" | "warning" | "error" | "unverified";

export interface AudioQualityIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  timeRange?: [number, number];
  words?: [string, string];
}

export interface AudioQualityMetrics {
  wpm?: number;
  rawWpm?: number;
  paceVariance?: number;
  detectedWordsCount?: number;
  sourceWordsCount?: number;
}

export interface AudioQualityReview {
  status: AudioQualityStatus;
  issues: AudioQualityIssue[];
  metrics?: AudioQualityMetrics;
  summary: string;
  checkedAt: number;
  audioPath?: string;
  text?: string;
}

export interface ChunkItem {
  id: string;
  index: number;
  text: string;
  originalText: string;
  status: ChunkStatus;
  durationSec?: number;
  pauseAfterMs: number | "auto";
  voiceOverrideId?: string;
  audioUrl?: string;
  audioFilePath?: string;
  errorMessage?: string;
  trailingSilenceMs?: number;
  effectiveVoiceSnapshot?: EffectiveVoiceSnapshot;
  qualityReview?: AudioQualityReview;
}

export type VoiceSource = "edge" | "google" | "local" | "local_clone" | "preset_local" | "online";
export type VoiceOrigin = "system" | "clone";

export type VoiceSourceType = "online" | "local" | "clone";
export type VoiceProviderId = "edge" | "openai" | "google_translate" | "local" | "clone";
export type VoiceEngineId =
  | "edge_tts"
  | "gpt_tts"
  | "gtts"
  | "omnivoice"
  | "chatterbox_turbo"
  | "qwen_tts_1_7b"
  | "voice_clone";

export type VoiceAvailability = "available" | "not_configured" | "unavailable";

export interface VoiceProfile {
  id: string;
  name: string;
  source: VoiceSource;
  origin?: VoiceOrigin;
  engine?: VoiceEngineId | string;
  sourceType?: VoiceSourceType;
  provider?: VoiceProviderId;
  availability?: VoiceAvailability;
  previewAvailable?: boolean;
  tags: string[];
  supportedLanguages: string[];
  sampleAudioPath?: string;
  isOnline?: boolean;
  providerName?: string;
  modelCompatibility: string[];
  country?: string | null;
  gender?: "male" | "female" | null;
  accent?: string | null;
  style?: string | null;
  styles?: string[];
  ageGroup?: string | null;
  category?: string | null;
  quality?: "Phòng thu" | "Bất kì";
  noticePeriod?: "30 ngày" | "90 ngày" | "1 năm" | "2 năm";
  customPricing?: "exclude" | "include";
  liveModeration?: "exclude" | "include";
  isFavorite?: boolean;
  usageCount?: string;
  avatarColor?: string;
  createdAt?: string;
  lastUsedAt?: string;
}

export interface PunctuationPauses {
  comma: number; // in seconds, e.g. 0.5
  period: number; // in seconds, e.g. 1.0
  questionExclamation: number; // in seconds, e.g. 1.0
  colonSemicolon: number; // in seconds, e.g. 0.6
}

export interface TtsAudioConfig {
  speed: number;
  pitch: number;
  volume: number;
  punctuationPauses: PunctuationPauses;
  sentencePauseMs?: number;
  emotion?: string;
}

export interface TranscriptionSegment {
  id: string;
  start: string;
  end: string;
  startSec: number;
  endSec: number;
  text: string;
  isLowConfidence?: boolean;
}

export interface SessionHistoryItem {
  id: string;
  title: string;
  type: "TTS" | "ASR" | "CLONE" | "BATCH" | "DIALOGUE" | "TRANSLATION" | "DUBBING";
  createdAt: string;
  chunkCount: number;
  duration: string;
  outputPath: string;
  status: "completed" | "interrupted" | "failed";
}

export type SettingsGroup =
  | "providers"
  | "models"
  | "storage"
  | "hardware"
  | "about"
  | "general"
  | "tts"
  | "ai_text"
  | "translation";

