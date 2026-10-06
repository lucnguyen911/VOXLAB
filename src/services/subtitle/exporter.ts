import { SubtitleCue } from "./types";

/**
 * Formats a duration in seconds into standard SubRip timestamp format: HH:MM:SS,mmm
 * Example: 3.420 -> "00:00:03,420"
 */
export function formatSrtTimestamp(seconds: number): string {
  const safeSeconds = Math.max(0, isNaN(seconds) ? 0 : seconds);
  const totalMs = Math.round(safeSeconds * 1000);
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);

  const pad = (num: number, size = 2) => String(num).padStart(size, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

/**
 * Formats a duration in seconds into standard WebVTT timestamp format: HH:MM:SS.mmm
 */
export function formatVttTimestamp(seconds: number): string {
  return formatSrtTimestamp(seconds).replace(",", ".");
}

/**
 * Serializes subtitle cues into standard SubRip (.srt) format.
 * Pure serializer without segmentation or optimization logic.
 */
export function exportToSrt(cues: SubtitleCue[]): string {
  if (!cues || cues.length === 0) {
    return "";
  }

  const entries: string[] = [];

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const index = i + 1;
    const start = formatSrtTimestamp(cue.startSec);
    const end = formatSrtTimestamp(cue.endSec);
    const text = cue.text.trim();

    if (!text) continue;

    entries.push(`${index}\n${start} --> ${end}\n${text}`);
  }

  return entries.length > 0 ? entries.join("\n\n") + "\n" : "";
}

/**
 * Serializes subtitle cues into WebVTT (.vtt) format.
 */
export function exportToVtt(cues: SubtitleCue[]): string {
  if (!cues || cues.length === 0) {
    return "WEBVTT\n\n";
  }

  const entries: string[] = ["WEBVTT\n"];

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const index = i + 1;
    const start = formatVttTimestamp(cue.startSec);
    const end = formatVttTimestamp(cue.endSec);
    const text = cue.text.trim();

    if (!text) continue;

    entries.push(`${index}\n${start} --> ${end}\n${text}`);
  }

  return entries.join("\n\n") + "\n";
}

/**
 * Serializes and writes subtitle cues to file using optional fileWriter.
 */
export async function exportSubtitleFile(
  cues: SubtitleCue[],
  destPath: string,
  format: "srt" | "vtt",
  options?: { fileWriter?: (path: string, content: string) => Promise<void> }
): Promise<string> {
  const content = format === "vtt" ? exportToVtt(cues) : exportToSrt(cues);
  if (options?.fileWriter) {
    await options.fileWriter(destPath, content);
  }
  return content;
}

