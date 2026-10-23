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

export type AudioQualityStatus = "pass" | "warning" | "error" | "unverified" | "checking";

export interface AudioQualityIssue {
  severity: "error" | "warning" | "unverified";
  code: string;
  message: string;
  timeRange?: [number, number];
  words?: string[];
  sourceExcerpt?: string;
  asrRawExcerpt?: string;
  asrNormalizedExcerpt?: string;
  asrModelId?: string;
  tokenSource?: "primary_asr" | "secondary_slice";
  evidence?: string;
  pauseContext?: string;
  boundaryClassification?: string;
  boundaryRelation?: string;
}

export interface AudioQualityMetrics {
  wpm?: number;
  rawWpm?: number;
  paceVariance?: number;
  detectedWordsCount?: number;
  sourceWordsCount?: number;
  secondaryWhisperCalls?: number;
  secondaryWhisperReasons?: string[];
  unverifiedReasons?: string[];
  timingMs?: Record<string, number>;
}

export interface AudioQualityReview {
  status: AudioQualityStatus;
  issues: AudioQualityIssue[];
  metrics?: AudioQualityMetrics;
  summary: string;
  checkedAt: number;
  audioPath?: string;
  text?: string;
  validatorVersion?: string;
  asrModelId?: string;
  audioSignature?: string;
  retryCount?: number;
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
  audioRevision?: number;
  errorMessage?: string;
  trailingSilenceMs?: number;
  leadingSilenceMs?: number;
  effectiveVoiceSnapshot?: EffectiveVoiceSnapshot;
  qualityReview?: AudioQualityReview;
  acknowledgedAt?: number;
  acknowledgedAudioSignature?: string;
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
  sampleDurationSec?: number;
  referenceTranscript?: string;
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
  comma: number; // in seconds, default: 0.2s (matching TTS)
  period: number; // in seconds, default: 0.6s (matching TTS)
  questionExclamation: number; // in seconds, default: 0.5s (matching TTS)
  colonSemicolon: number; // in seconds, default: 0.4s (matching TTS)
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

