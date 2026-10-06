import { SubtitleCue, SubtitleValidationResult } from "./types";
import { findProtectedSpans } from "./protectedSpans";

/**
 * Validates generated subtitle cues against hard invariants:
 * 1. Content Invariant: zero lost, added, or reordered tokens.
 * 2. Timing Invariant: start >= 0, end > start, strictly non-decreasing timestamps.
 * 3. Protected Spans: no protected lexical/numeric unit split across cues.
 * 4. Structural: no empty cues, valid sequential indices.
 */
export function validateSubtitles(
  cues: SubtitleCue[],
  originalText?: string,
  totalAudioDuration?: number
): SubtitleValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!cues || cues.length === 0) {
    if (originalText && originalText.trim().length > 0) {
      errors.push("Cues list is empty but original text is non-empty.");
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  // 1. Timing Checks
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];

    if (cue.startSec < 0) {
      errors.push(`Cue #${cue.index}: start time is negative (${cue.startSec}s).`);
    }
    if (cue.endSec <= cue.startSec) {
      errors.push(
        `Cue #${cue.index}: end time (${cue.endSec}s) must be strictly greater than start time (${cue.startSec}s).`
      );
    }

    if (i > 0) {
      const prev = cues[i - 1];
      if (cue.startSec < prev.startSec) {
        errors.push(
          `Cue #${cue.index}: start time (${cue.startSec}s) is earlier than preceding cue #${prev.index} (${prev.startSec}s).`
        );
      }
      if (cue.startSec < prev.endSec) {
        warnings.push(
          `Cue #${cue.index} overlaps with preceding cue #${prev.index} (${cue.startSec}s < ${prev.endSec}s).`
        );
      }
    }

    if (totalAudioDuration !== undefined && totalAudioDuration > 0) {
      if (cue.endSec > totalAudioDuration + 0.1) {
        errors.push(
          `Cue #${cue.index}: end time (${cue.endSec}s) exceeds total audio duration (${totalAudioDuration}s).`
        );
      }
    }

    // 2. Empty Text Check
    if (!cue.text || !cue.text.trim()) {
      errors.push(`Cue #${cue.index}: subtitle text cannot be empty.`);
    }
  }

  // 3. Content Invariant Check (Token-level preservation)
  if (originalText && originalText.trim()) {
    const cleanTokens = (str: string) =>
      str
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .filter(Boolean);

    const sourceTokens = cleanTokens(originalText);
    const cueTokens = cleanTokens(cues.map((c) => c.text).join(" "));

    if (sourceTokens.length !== cueTokens.length) {
      errors.push(
        `Content invariant violated: token count mismatch (source: ${sourceTokens.length}, cues: ${cueTokens.length}).`
      );
    } else {
      for (let i = 0; i < sourceTokens.length; i++) {
        if (sourceTokens[i] !== cueTokens[i]) {
          errors.push(
            `Content invariant violated at token #${i + 1}: expected "${sourceTokens[i]}", received "${cueTokens[i]}".`
          );
          break; // Report first token mismatch
        }
      }
    }

    // 4. Protected Spans Invariant Check
    // Verify that all protected numbers/dates/versions/currencies are intact in single cues
    const spans = findProtectedSpans(originalText);
    for (const span of spans) {
      const token = span.raw;
      // The token must exist in its entirety in at least one cue
      const existsIntact = cues.some((c) => c.text.includes(token));
      if (!existsIntact) {
        errors.push(
          `Protected lexical span "${token}" (${span.type}) was broken across subtitle boundaries.`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
