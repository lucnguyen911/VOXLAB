import { DialogueTimelineEntry } from "./masterAssembly";
import { stripPauseTokens } from "../pause";
import { SubtitleAspectRatio, SubtitleMaxLines } from "../subtitle";

/**
 * Formats time in seconds to SubRip timestamp format: HH:MM:SS,mmm
 */
export function formatSrtTimestamp(seconds: number): string {
  const totalMs = Math.max(0, Math.floor(seconds * 1000));
  const hrs = Math.floor(totalMs / 3600000);
  const mins = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;

  const pad = (n: number, z = 2) => String(n).padStart(z, "0");
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)},${pad(ms, 3)}`;
}

/**
 * Wraps or splits dialogue speaker text into at most maxLines (1 or 2)
 * according to the target aspect ratio profile.
 */
export function formatDialogueSubtitleText(
  speakerText: string,
  aspectRatio: SubtitleAspectRatio = "16:9",
  maxLines: SubtitleMaxLines = 2
): string {
  const normalized = speakerText.replace(/\r?\n+/g, " ").trim();
  if (maxLines === 1 || !normalized.includes(" ")) {
    return normalized;
  }

  const maxWidthMap: Record<SubtitleAspectRatio, number> = {
    "16:9": 48,
    "9:16": 32,
    "1:1": 38,
  };
  const maxWidth = maxWidthMap[aspectRatio] ?? 48;

  // Fits within a single line
  if (normalized.length <= maxWidth) {
    return normalized;
  }

  const words = normalized.split(/\s+/);
  if (words.length <= 1) return normalized;

  // Find optimal split point near middle
  const targetHalf = Math.floor(normalized.length / 2);
  let bestSplitIndex = 1;
  let minDiff = Infinity;
  let currentLen = 0;

  for (let i = 0; i < words.length - 1; i++) {
    currentLen += words[i].length + (i > 0 ? 1 : 0);
    const diff = Math.abs(currentLen - targetHalf);
    if (diff < minDiff) {
      minDiff = diff;
      bestSplitIndex = i + 1;
    }
  }

  const line1 = words.slice(0, bestSplitIndex).join(" ");
  const line2 = words.slice(bestSplitIndex).join(" ");
  return `${line1}\n${line2}`;
}

/**
 * Generates SubRip (.srt) subtitle string with speaker prefixes [Speaker]: Dialogue
 */
export function generateDialogueSrt(
  timeline: DialogueTimelineEntry[],
  options?: {
    aspectRatio?: SubtitleAspectRatio;
    maxLines?: SubtitleMaxLines;
  }
): string {
  const blocks: string[] = [];
  const aspectRatio = options?.aspectRatio ?? "16:9";
  const maxLines = options?.maxLines ?? 2;

  for (let i = 0; i < timeline.length; i++) {
    const entry = timeline[i];
    const cueIndex = i + 1;
    const startTimeStr = formatSrtTimestamp(entry.startSec);
    const endTimeStr = formatSrtTimestamp(entry.endSec);
    const cleanDialogue = stripPauseTokens(entry.text);
    const rawSpeakerText = `[${entry.characterName}]: ${cleanDialogue}`;
    const speakerText = formatDialogueSubtitleText(rawSpeakerText, aspectRatio, maxLines);

    blocks.push(`${cueIndex}\n${startTimeStr} --> ${endTimeStr}\n${speakerText}`);
  }

  return blocks.length > 0 ? blocks.join("\n\n") + "\n" : "";
}

/**
 * Browser download helper for text files
 */
export function downloadTextFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
