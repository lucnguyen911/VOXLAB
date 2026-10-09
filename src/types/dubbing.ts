/**
 * Dubbing Domain Models & Invariant Types
 * Defines data structures for the Dedicated Dubbing Workspace in VoxLab.
 * Adheres strictly to SPEC.md v2.5.3 Section 16.1.
 */

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
  text: string;          // Editable translated text (user can revise inline)
  isEdited?: boolean;    // Flag indicating manual user edit after AI translation
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
