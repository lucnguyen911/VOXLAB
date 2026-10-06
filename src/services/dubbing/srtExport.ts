import { TranslatedCue } from "../../types/dubbing";
import { formatSrtTimestamp } from "../subtitle/exporter";

/**
 * Exports translated subtitle cues to standard SubRip (.srt) format.
 * HARD INVARIANT (SPEC.md v2.5.3 Section 16.1):
 * - startSec and endSec strictly inherit the original subtitle timeline.
 * - Dubbing audio overflow/collision NEVER alters these timestamps.
 * - Sequential 1-based indices.
 */
export function exportTranslatedSrt(cues: TranslatedCue[]): string {
  if (!cues || cues.length === 0) {
    return "";
  }

  const entries: string[] = [];

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const text = cue.text.trim();
    if (!text) continue;

    const start = formatSrtTimestamp(cue.startSec);
    const end = formatSrtTimestamp(cue.endSec);
    const index = entries.length + 1;
    entries.push(`${index}\n${start} --> ${end}\n${text}`);
  }

  return entries.length > 0 ? entries.join("\n\n") + "\n" : "";
}
