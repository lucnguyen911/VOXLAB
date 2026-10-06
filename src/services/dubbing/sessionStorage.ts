import {
  OriginalCue,
  TranslatedCue,
  DubAudioSegment,
  TimingOverflowMetadata,
} from "../../types/dubbing";

export const DUBBING_SESSION_STORAGE_KEY = "voxlab_dubbing_session_backup";

/**
 * Lightweight JSON-serializable session state for Dubbing Workspace.
 * STRICT HARD CONSTRAINT (SPEC.md v2.5.3 Section 16.3):
 * NEVER store AudioBuffer, Blob, ArrayBuffer, or audio PCM payloads in sessionStorage.
 * Storage quota is limited to 5MB; lightweight metadata consumes < 50KB for 1,000 cues.
 */
export interface DubbingSessionBackup {
  sourceMediaName?: string;
  sourceDurationSec?: number;
  sourceLang: string;
  targetLang: string;
  selectedProviderId: string;
  selectedVoiceId: string;
  originalCues: OriginalCue[];
  translatedCues: TranslatedCue[];
  audioSegmentMeta: Record<
    number,
    Omit<DubAudioSegment, "audioUrl" | "fittedAudioUrl">
  >;
  overflowAnalysis: Record<number, TimingOverflowMetadata>;
  updatedAt: number;
}

/**
 * Persists lightweight session state into sessionStorage.
 */
export function saveDubbingSessionBackup(session: {
  sourceMediaName?: string;
  sourceDurationSec?: number;
  sourceLang: string;
  targetLang: string;
  selectedProviderId: string;
  selectedVoiceId: string;
  originalCues: OriginalCue[];
  translatedCues: TranslatedCue[];
  audioSegments: Record<number, DubAudioSegment>;
  overflowAnalysis: Record<number, TimingOverflowMetadata>;
}): void {
  if (typeof sessionStorage === "undefined") return;

  try {
    // Strip in-memory Blob/Object URLs before serialization
    const lightweightMeta: Record<
      number,
      Omit<DubAudioSegment, "audioUrl" | "fittedAudioUrl">
    > = {};

    for (const [key, seg] of Object.entries(session.audioSegments)) {
      const idx = Number(key);
      const { audioUrl: _a, fittedAudioUrl: _f, ...rest } = seg;
      lightweightMeta[idx] = rest;
    }

    const payload: DubbingSessionBackup = {
      sourceMediaName: session.sourceMediaName,
      sourceDurationSec: session.sourceDurationSec,
      sourceLang: session.sourceLang,
      targetLang: session.targetLang,
      selectedProviderId: session.selectedProviderId,
      selectedVoiceId: session.selectedVoiceId,
      originalCues: session.originalCues,
      translatedCues: session.translatedCues,
      audioSegmentMeta: lightweightMeta,
      overflowAnalysis: session.overflowAnalysis,
      updatedAt: Date.now(),
    };

    sessionStorage.setItem(
      DUBBING_SESSION_STORAGE_KEY,
      JSON.stringify(payload)
    );
  } catch (err) {
    console.warn("Failed to save dubbing session backup to sessionStorage:", err);
  }
}

/**
 * Restores session state on WebView reload.
 * HARD INVARIANT (SPEC.md v2.5.3 Section 16.3):
 * Because in-memory Blob/RAM buffers are lost on reload:
 * Any cue that had generated audio is restored with `status: "needs_generation"`.
 * All original cues, translated cues, and manual user edits (`isEdited: true`) are 100% restored.
 */
export function loadDubbingSessionBackup(): {
  backup: DubbingSessionBackup;
  restoredAudioSegments: Record<number, DubAudioSegment>;
} | null {
  if (typeof sessionStorage === "undefined") return null;

  try {
    const raw = sessionStorage.getItem(DUBBING_SESSION_STORAGE_KEY);
    if (!raw) return null;

    const parsed: DubbingSessionBackup = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.originalCues) || parsed.originalCues.length === 0) {
      return null;
    }

    // Convert previously generated segments to "needs_generation"
    const restoredAudioSegments: Record<number, DubAudioSegment> = {};
    if (parsed.audioSegmentMeta) {
      for (const [key, meta] of Object.entries(parsed.audioSegmentMeta)) {
        const idx = Number(key);
        restoredAudioSegments[idx] = {
          ...meta,
          status: "needs_generation",
          audioUrl: undefined,
          fittedAudioUrl: undefined,
        };
      }
    }

    return {
      backup: parsed,
      restoredAudioSegments,
    };
  } catch (err) {
    console.warn("Failed to load dubbing session backup from sessionStorage:", err);
    return null;
  }
}

/**
 * Clears dubbing session backup from sessionStorage.
 */
export function clearDubbingSessionBackup(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(DUBBING_SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}
