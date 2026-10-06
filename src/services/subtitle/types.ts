export type SubtitleAspectRatio = "16:9" | "9:16" | "1:1";

export interface SubtitleProfile {
  formatId: SubtitleAspectRatio;
  maxLines: number;
  targetWidth: number;
  maxWidth: number;
  targetWords: number;
  maxWords: number;
  minDuration: number;
  targetDuration: number;
  maxDuration: number;
  targetCps: number;
  maxCps: number;
}

export type ProtectedSpanType =
  | "number"
  | "currency"
  | "version"
  | "date"
  | "time"
  | "ip"
  | "url"
  | "email"
  | "unit"
  | "abbreviation";

export interface ProtectedSpan {
  type: ProtectedSpanType;
  raw: string;
  startIndex: number;
  endIndex: number;
}

export interface SpeechUnit {
  id: string | number;
  text: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  pauseAfterSec?: number;
}

export interface SubtitleCue {
  index: number;
  startSec: number;
  endSec: number;
  text: string;
}

export interface SubtitleValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export type SubtitleMaxLines = 1 | 2;
export type SubtitleSpeechSpeed = 1.0 | 0.9 | 0.8;
export type SubtitleProcessingSpeed = "auto" | "1x" | "2x" | "4x" | "8x";

export interface WhisperWord {
  word: string;
  startSec: number;
  endSec: number;
  confidence?: number;
}

export interface WhisperSegment {
  id: number | string;
  startSec: number;
  endSec: number;
  text: string;
  words?: WhisperWord[];
  avgLogprob?: number;
  noSpeechProb?: number;
}

export interface SubtitleSettings {
  // SPEECH TO SUBTITLE ONLY
  audioLanguage: string; // default "auto"
  whisperModel: string; // default "large-v3-turbo"
  speechSpeed: SubtitleSpeechSpeed; // default 1.0 (options: 1.0, 0.9, 0.8)
  processingSpeed: SubtitleProcessingSpeed; // default "auto" (options: "auto", "1x", "2x", "4x", "8x")
  aspectRatio: SubtitleAspectRatio; // default "16:9" (options: "16:9", "9:16", "1:1")
  maxLines: SubtitleMaxLines; // default 2 (options: 1, 2)
}

