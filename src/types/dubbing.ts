/**
 * Dubbing Domain Models & Invariant Types
 * Defines data structures for the Dedicated Dubbing Workspace in VoxLab.
 * Adheres strictly to SPEC.md v2.5.3 Section 16.1.
 */

import { AudioQualityReview, EffectiveVoiceSnapshot } from "./ui";

/**
 * Source Subtitle Cue on the immutable Source Subtitle Timeline.
 */
export interface OriginalCue {
  index: number;         // 1-based sequential cue index (1, 2, ..., N)
  startSec: number;      // Start timestamp on source timeline (seconds, 3 decimal precision)
  endSec: number;        // End timestamp on source timeline (seconds, 3 decimal precision)
  text: string;          // Source transcript text (read-only in Dubbing workspace)
}

/**
 * Review & Edit Translated Cue.
 * HARD INVARIANT: startSec, endSec and index are STRICTLY EQUAL to OriginalCue.
 */
export interface TranslatedCue {
  index: number;         // Identical to OriginalCue.index
  startSec: number;      // STRICTLY EQUAL to OriginalCue.startSec (Source Subtitle Timeline)
  endSec: number;        // STRICTLY EQUAL to OriginalCue.endSec (Source Subtitle Timeline)
  originalText: string;  // Reference to source text for side-by-side display
  text: string;          // Editable translated text (user can revise inline; used for SRT display)
  subtitleText?: string; // Explicit display text for SRT export & subtitle overlay
  speechFragmentText?: string; // Natural spoken phrasing fragment contributing to group speechText
  groupId?: string;      // Associated DubbingSpeechGroup ID
  projectionNeedsReview?: boolean; // True if group-to-cue projection fell back or requires review
  forceGroupBreakAfter?: boolean;  // User-defined group break after this cue
  isEdited?: boolean;    // Flag indicating manual user edit after AI translation
}

/**
 * Dubbing execution modes:
 * - "source_sync": Chế độ 1 — Đồng bộ video gốc (Dịch & lồng tiếng giữ nguyên mốc thời gian, timeline video gốc)
 * - "free_narration": Chế độ 2 — Dịch & Thuyết minh tự do (Dịch kịch bản tự nhiên, audio ghép nối tiếp, không ràng buộc timeline gốc)
 */
export type DubbingMode = "source_sync" | "free_narration";

/** Legacy dubbing mode strings supported for backward-compatible migration */
export type LegacyDubbingMode = "cue_strict" | "sentence_group";

/**
 * Normalizes any legacy or arbitrary dubbing mode string to the canonical DubbingMode.
 * Defaults safely to "source_sync".
 */
export function normalizeDubbingMode(mode: unknown): DubbingMode {
  if (mode === "free_narration") return "free_narration";
  if (mode === "source_sync") return "source_sync";
  // Legacy migration: "sentence_group" & "cue_strict" mapped to "source_sync"
  if (mode === "sentence_group" || mode === "cue_strict") return "source_sync";
  return "source_sync";
}

/**
 * Reason why a DubbingSpeechGroup boundary was closed.
 */
export type SpeechGroupBreakReason =
  | "terminal_punctuation"
  | "pause_gap"
  | "speaker_change"
  | "chapter_header"
  | "user_break"
  | "max_length_clause"
  | "end_of_script";

/**
 * Speech group planned by DubbingSpeechPlanner for context-aware translation and seamless TTS synthesis.
 * Strictly overlays the immutable OriginalCue[] / TranslatedCue[] timeline without altering cue indices or timestamps.
 */
export interface DubbingSpeechGroup {
  groupId: string;               // Stable identifier e.g. "group_1_5"
  sourceCueIds: number[];        // Ordered 1-based cue indices belonging to this group
  startSec: number;              // Group start (= first cue startSec on source timeline)
  endSec: number;                // Group end (= last cue endSec on source timeline)
  nextGroupStartSec?: number;    // Start timestamp of the next group (for available window calculation)
  availableDurationSec: number;  // Total available window before next group starts (respecting safety gap)
  sourceText: string;            // Normalized single-paragraph source sentence/phrase (no display \n)
  translatedText?: string;       // Natural target translation of the entire speech group
  speechText: string;            // Seamless natural target text for TTS synthesis (no display \n)
  speakerPrefix?: string;        // Detected speaker label if present (e.g. "Speaker 1")
  breakReason: SpeechGroupBreakReason;
  status: DubAudioStatus;        // Group synthesis lifecycle status
  isUserModified?: boolean;      // True when constituent cue was edited by user after synthesis
}

/**
 * Status lifecycle of a synthesized audio segment for a cue.
 */
export type DubAudioStatus =
  | "idle"
  | "generating"
  | "ready"
  | "failed"
  | "modified"
  | "needs_generation";

/**
 * Synthesized and time-stretched audio segment mapped to a cue.
 */
export interface DubAudioSegment {
  cueIndex: number;          // Mapped cue index (1:1 with OriginalCue.index)
  text?: string;             // Synthesized translated text for QC verification
  audioUrl?: string;         // Object URL of audio Blob in WebView RAM (revoked on reload)
  rawDurationSec: number;    // Raw TTS audio duration in seconds
  targetDurationSec: number; // Available duration on source timeline (endSec - startSec)
  fittedAudioUrl?: string;   // Processed audio URL after WSOLA time-stretch (if stretched)
  fittedDurationSec: number; // Final duration after WSOLA (or raw if no stretch)
  speedFactor: number;       // WSOLA speed ratio applied (e.g. 1.0 to 1.20)
  audioStartSec: number;     // Absolute audio start on dub timeline (= OriginalCue.startSec)
  audioEndSec: number;       // Absolute audio end on dub timeline (= audioStartSec + fittedDurationSec)
  status: DubAudioStatus;    // Current state of synthesis / fitting
  audioFilePath?: string;    // Local path to WAV file on disk (for Master Audio assembly)
  errorMessage?: string;
  effectiveVoiceSnapshot?: EffectiveVoiceSnapshot;
  qualityReview?: AudioQualityReview;
  acknowledgedAt?: number;
  acknowledgedAudioSignature?: string;
  groupId?: string;          // ID of the DubbingSpeechGroup when synthesized in sentence_group mode
  groupCueIndices?: number[];// All cue indices covered by this speech group
  isGroupPrimary?: boolean;  // True for the head cue of a speech group (or true in 1:1 mode); false for follower cues
  primaryCueIndex?: number;  // Head cue index where the group audio is anchored on the timeline
}

/**
 * Warning level for timeline overflow and collision detection.
 */
export type TimingOverflowWarningLevel = "none" | "overflow_only" | "collision_danger";

/**
 * Metadata analysis for cue audio duration overflow and collision with subsequent cue.
 */
export interface TimingOverflowMetadata {
  cueIndex: number;
  hasOverflow: boolean;          // true if audioEndSec > OriginalCue.endSec
  overflowSec: number;           // audioEndSec - OriginalCue.endSec (positive = overflow)
  hasCollision: boolean;         // true if audioEndSec > nextOriginalCue.startSec
  collisionWithIndex?: number;   // index of subsequent cue that overlaps
  collisionSec: number;          // overlap amount in seconds
  warningLevel: TimingOverflowWarningLevel;
}

/**
 * Immutable snapshot transferred from Subtitle workspace to Dubbing workspace.
 */
export interface DubbingHandoffSnapshot {
  sourceMediaName?: string;
  sourceDurationSec?: number;
  sourceLang: string;
  cues: OriginalCue[];
}

/**
 * Complete project state for a Dubbing workspace session.
 */
export interface DubbingProjectSession {
  id: string;
  sourceMediaName?: string;
  sourceDurationSec?: number;
  originalCues: OriginalCue[];
  translatedCues: TranslatedCue[];
  speechGroups?: DubbingSpeechGroup[];
  dubbingMode?: DubbingMode;
  audioSegments: Record<number, DubAudioSegment>;
  overflowAnalysis: Record<number, TimingOverflowMetadata>;
  sourceLang: string;
  targetLang: string;
  selectedProviderId: string;
  selectedVoiceId: string;
  overallStatus: "draft" | "translated" | "dubbing" | "completed";
  createdAt: number;
  updatedAt: number;
}
