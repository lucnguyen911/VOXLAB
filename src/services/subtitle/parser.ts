import { OriginalCue } from "../../types/dubbing";

/**
 * Strips HTML formatting, styling and inline karaoke tags while preserving text content.
 * Cleans tags like <b>, <i>, <u>, <font>, <color>, <c.class>, <ruby>, <rt>, <00:01:23.456>.
 */
export function stripSubtitleMarkup(text: string): string {
  let cleaned = text;

  // 1. Convert WebVTT voice tags: <v Speaker>text</v> or <v.name Speaker>text to "Speaker: text"
  cleaned = cleaned.replace(/<v(?:\.[^\s>]+)?\s+([^>]+)>([\s\S]*?)(?:<\/v>|$)/gi, (_match, speaker, content) => {
    const trimmedSpeaker = speaker.trim();
    const trimmedContent = content.trim();
    return trimmedContent ? `${trimmedSpeaker}: ${trimmedContent}` : trimmedSpeaker;
  });

  // 2. Remove remaining </v> if any
  cleaned = cleaned.replace(/<\/v>/gi, "");

  // 3. Remove inline timestamp tags: <00:01:23.456> or <01:23.456>
  cleaned = cleaned.replace(/<\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{3})?>/g, "");

  // 4. Decode common HTML entities first so any encoded tags are exposed to the tag stripper
  cleaned = cleaned
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // 5. Remove standard HTML/XML formatting and style tags: <b>, <i>, <u>, <font>, <color>, <c>, <ruby>, <rt>, <lang>
  cleaned = cleaned.replace(/<\/?(?:b|i|u|c(?:\.[^\s>]+)?|font|color|ruby|rt|rp|lang|span)(?:\s+[^>]*)?>/gi, "");

  // 6. Remove any leftover generic XML/HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, "");

  // 7. Clean up multiple horizontal whitespaces per line (preserve intentional linebreaks)
  cleaned = cleaned
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .trim();

  return cleaned;
}

/**
 * Parses timestamp string into seconds (with 3-decimal millisecond precision).
 * Supports:
 * - SubRip: "00:01:23,456"
 * - WebVTT: "00:01:23.456" or "01:23.456"
 */
export function parseTimestampSec(tsStr: string): number {
  const trimmed = tsStr.trim().replace(",", ".");
  const parts = trimmed.split(":");

  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  if (parts.length === 3) {
    hours = parseFloat(parts[0]);
    minutes = parseFloat(parts[1]);
    seconds = parseFloat(parts[2]);
  } else if (parts.length === 2) {
    minutes = parseFloat(parts[0]);
    seconds = parseFloat(parts[1]);
  } else {
    throw new Error(`Định dạng timestamp không hợp lệ: "${tsStr}"`);
  }

  if (
    isNaN(hours) ||
    isNaN(minutes) ||
    isNaN(seconds) ||
    hours < 0 ||
    minutes < 0 ||
    seconds < 0
  ) {
    throw new Error(`Không thể phân tích giá trị thời gian: "${tsStr}"`);
  }

  const total = hours * 3600 + minutes * 60 + seconds;
  if (!Number.isFinite(total) || total < 0) {
    throw new Error(`Mốc thời gian không hợp lệ: "${tsStr}"`);
  }
  return Number(total.toFixed(3));
}

/**
 * Parses an SRT or WebVTT subtitle string into an array of immutable OriginalCue objects.
 * Throws friendly descriptive errors on empty content, excessive file size, or malformed timestamps.
 */
export function parseSubtitleContent(rawContent: string): OriginalCue[] {
  if (rawContent.length > 5 * 1024 * 1024) {
    throw new Error("Dung lượng tệp phụ đề vượt quá giới hạn an toàn 5MB.");
  }

  // 1. Normalize line endings and strip UTF-8 BOM
  const content = rawContent
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

  if (!content) {
    throw new Error("Nội dung file phụ đề rỗng hoặc chỉ chứa khoảng trắng.");
  }

  // 2. Identify and skip WebVTT headers / NOTE blocks
  const lines = content.split("\n");
  let startIndex = 0;

  if (lines[0].trim().startsWith("WEBVTT")) {
    startIndex = 1;
    // Skip optional header metadata lines until first blank line
    while (startIndex < lines.length && lines[startIndex].trim() !== "") {
      startIndex++;
    }
  }

  // 3. Group lines into cue blocks separated by blank lines
  const rawBlocks: string[][] = [];
  let currentBlock: string[] = [];

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") {
      if (currentBlock.length > 0) {
        rawBlocks.push(currentBlock);
        currentBlock = [];
      }
    } else {
      currentBlock.push(line);
    }
  }
  if (currentBlock.length > 0) {
    rawBlocks.push(currentBlock);
  }

  const cues: OriginalCue[] = [];
  const timestampArrowRegex = /-->/;

  for (const block of rawBlocks) {
    // Skip WebVTT NOTE / STYLE / REGION blocks
    const firstLine = block[0].trim();
    if (
      firstLine.startsWith("NOTE") ||
      firstLine.startsWith("STYLE") ||
      firstLine.startsWith("REGION")
    ) {
      continue;
    }

    // Find the line containing the timestamp arrow "-->"
    let timeLineIndex = -1;
    for (let j = 0; j < block.length; j++) {
      if (timestampArrowRegex.test(block[j])) {
        timeLineIndex = j;
        break;
      }
    }

    if (timeLineIndex === -1) {
      // Not a valid cue block, skip
      continue;
    }

    const timeLine = block[timeLineIndex].trim();
    const timeParts = timeLine.split(/-->/);
    if (timeParts.length !== 2) {
      throw new Error(`Dòng mốc thời gian không hợp lệ: "${timeLine}"`);
    }

    const startRaw = timeParts[0].trim();
    // In WebVTT, end timestamp can be followed by cue settings (e.g. line:90% align:middle)
    const endRaw = timeParts[1].trim().split(/\s+/)[0];

    const startSec = parseTimestampSec(startRaw);
    const endSec = parseTimestampSec(endRaw);

    if (startSec >= endSec) {
      throw new Error(
        `Mốc thời gian bắt đầu (${startRaw} = ${startSec}s) phải nhỏ hơn thời điểm kết thúc (${endRaw} = ${endSec}s).`
      );
    }

    // Text content is all subsequent lines
    const textLines = block.slice(timeLineIndex + 1);
    const rawText = textLines.join("\n");
    const cleanedText = stripSubtitleMarkup(rawText);

    if (!cleanedText) {
      continue;
    }

    cues.push({
      index: cues.length + 1,
      startSec,
      endSec,
      text: cleanedText,
    });
  }

  if (cues.length === 0) {
    throw new Error("Không tìm thấy đoạn phụ đề hợp lệ nào trong tệp.");
  }

  return cues;
}

/**
 * Alias for parseSubtitleContent conforming to Plan / SPEC API.
 */
export const parseSubtitle = parseSubtitleContent;

