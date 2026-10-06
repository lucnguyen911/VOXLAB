import {
  DialogueCharacter,
  DialogueSegment,
  CHARACTER_COLOR_PALETTE,
  CharacterColorTheme,
} from "../../types/dialogue";

/**
 * Normalizes character name to a consistent ID key
 */
export function normalizeCharacterId(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "_");
}

/**
 * Strips stage directions or emotional cues inside parentheses or brackets
 * e.g. "(vui vẻ)", "(thì thầm)", "[cười lớn]"
 */
export function stripStageDirections(text: string): string {
  return text
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s*\[(?!(?:pause|nghỉ|break)\b)[^\]]*\]\s*/gi, " ")
    .replace(/\s+([!?,.:;])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ParseResult {
  segments: DialogueSegment[];
  characters: DialogueCharacter[];
  wordCount: number;
  charCount: number;
}

/**
 * Regex matching dialogue line starters:
 * 1. [Name]: Speech
 * 2. [Name] Speech
 * 3. Name: Speech
 */
const DIALOGUE_LINE_REGEX = /^\s*(?:\[([^\]]+)\](?:\s*[:：]|\s+)|([^:\n\r\[]+)\s*[:：])\s*(.*)$/;

/**
 * Parses raw dialogue script text into structured segments and character profiles.
 * Preserves user custom voice assignments, speed, and pitch for existing characters.
 */
export function parseDialogueScript(
  script: string,
  existingCharacters: DialogueCharacter[] = []
): ParseResult {
  const lines = script.split(/\r?\n/);
  const segments: DialogueSegment[] = [];
  const characterCounts = new Map<string, { name: string; count: number }>();

  let currentSegment: DialogueSegment | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmedLine = rawLine.trim();

    if (!trimmedLine) {
      continue;
    }

    // Extract leading pause token if user put it before speaker: [PAUSE 500ms] [Nam]: ...
    let leadingPauseToken = "";
    let lineToParse = rawLine;
    const leadingPauseMatch = lineToParse.match(/^\s*(\[(?:PAUSE|pause)\s+[^\]]+\])\s*/i);
    if (leadingPauseMatch) {
      leadingPauseToken = leadingPauseMatch[1];
      lineToParse = lineToParse.slice(leadingPauseMatch[0].length);
    }

    const match = lineToParse.match(DIALOGUE_LINE_REGEX);

    if (match) {
      // Group 1 is [Name], Group 2 is Name
      const speakerName = (match[1] || match[2] || "").trim();
      let speechContent = (match[3] || "").trim();

      if (speakerName && !/^(?:pause|nghỉ|break)\b/i.test(speakerName)) {
        if (leadingPauseToken) {
          speechContent = `${leadingPauseToken} ${speechContent}`.trim();
        }
        const charId = normalizeCharacterId(speakerName);
        const existingCount = characterCounts.get(charId);
        characterCounts.set(charId, {
          name: speakerName,
          count: (existingCount?.count || 0) + 1,
        });

        currentSegment = {
          id: `seg_${segments.length + 1}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          index: segments.length + 1,
          characterName: speakerName,
          characterId: charId,
          rawText: speechContent,
          cleanText: stripStageDirections(speechContent),
          pauseAfterSec: 0,
          status: "pending",
        };
        segments.push(currentSegment);
        continue;
      }
    }

    // If continuation line of ongoing segment
    if (currentSegment) {
      currentSegment.rawText += `\n${trimmedLine}`;
      currentSegment.cleanText = stripStageDirections(currentSegment.rawText);
    }
  }

  // Build character list with assigned colors & preserved settings
  const existingCharMap = new Map<string, DialogueCharacter>(
    existingCharacters.map((c) => [c.id, c])
  );

  const characters: DialogueCharacter[] = [];
  let colorIdx = 0;

  for (const [charId, info] of characterCounts.entries()) {
    const existing = existingCharMap.get(charId);

    const colorTheme: CharacterColorTheme =
      existing?.colorTheme ||
      CHARACTER_COLOR_PALETTE[colorIdx % CHARACTER_COLOR_PALETTE.length];
    colorIdx++;

    characters.push({
      id: charId,
      name: info.name,
      colorTheme,
      segmentCount: info.count,
      voiceId: existing?.voiceId,
      speed: existing?.speed ?? 1.0,
      pitch: existing?.pitch ?? 1.0,
      volume: existing?.volume ?? 1.0,
    });
  }

  // Calculate text statistics
  const trimmedFullText = script.trim();
  const wordCount = trimmedFullText ? trimmedFullText.split(/\s+/).length : 0;
  const charCount = script.length;

  return {
    segments,
    characters,
    wordCount,
    charCount,
  };
}

/**
 * Fast lookup helper for a character's color theme
 */
export function getCharacterColor(
  characterId: string,
  characters: DialogueCharacter[]
): CharacterColorTheme {
  const found = characters.find((c) => c.id === characterId);
  if (found) return found.colorTheme;
  return CHARACTER_COLOR_PALETTE[0];
}

/**
 * Smart automatic voice suggestion based on Vietnamese character names
 */
export function guessGenderFromName(name: string): "male" | "female" | null {
  const lower = name.toLowerCase();
  const maleKeywords = ["nam", "anh", "bố", "cha", "ông", "chú", "bác", "thầy", "boy", "man", "john", "david"];
  const femaleKeywords = ["vy", "lan", "hoa", "linh", "mai", "chi", "mẹ", "bà", "cô", "chị", "em", "gái", "girl", "woman", "sarah", "mary"];

  for (const kw of maleKeywords) {
    if (lower.includes(kw)) return "male";
  }
  for (const kw of femaleKeywords) {
    if (lower.includes(kw)) return "female";
  }
  return null;
}

export interface DialogueDetectionResult {
  isDialogue: boolean;
  confidence: "high" | "ambiguous" | "none";
  characterCount: number;
  segmentCount: number;
  warning?: string;
  characters: DialogueCharacter[];
}

const COMMON_NON_SPEAKER_HEADERS = new Set([
  "lưu ý",
  "chú ý",
  "ghi chú",
  "chương",
  "phần",
  "bài",
  "mục",
  "tiêu đề",
  "nguồn",
  "tác giả",
  "ngày",
  "thời gian",
  "địa điểm",
  "tóm tắt",
  "nội dung",
  "note",
  "warning",
  "chapter",
  "section",
  "part",
  "source",
  "author",
  "date",
  "summary",
  "title",
  "http",
  "https",
]);

/**
 * Validates whether a text file contains a genuine dialogue script structure
 * or is just regular text with arbitrary colons/headers.
 */
export function detectDialogueScript(script: string): DialogueDetectionResult {
  const trimmed = script.trim();
  if (!trimmed) {
    return {
      isDialogue: false,
      confidence: "none",
      characterCount: 0,
      segmentCount: 0,
      characters: [],
    };
  }

  // 1. Explicit bracketed speaker tags: [Nam]: ... or [Người dẫn chuyện]: ...
  const bracketedLineRegex = /^\s*\[([^\]]+)\](?:\s*[:：]|\s+)\s*(.+)$/m;
  const hasBracketedSpeaker = bracketedLineRegex.test(trimmed);

  const parsed = parseDialogueScript(trimmed);

  if (hasBracketedSpeaker && parsed.segments.length >= 1 && parsed.characters.length >= 1) {
    return {
      isDialogue: true,
      confidence: "high",
      characterCount: parsed.characters.length,
      segmentCount: parsed.segments.length,
      characters: parsed.characters,
    };
  }

  // 2. Unbracketed speaker syntax (Name: Speech)
  if (parsed.characters.length >= 2 && parsed.segments.length >= 2) {
    const validCharacters = parsed.characters.filter((c) => {
      const lower = c.name.trim().toLowerCase();
      return (
        !COMMON_NON_SPEAKER_HEADERS.has(lower) &&
        !lower.startsWith("chương ") &&
        !lower.startsWith("phần ")
      );
    });

    if (validCharacters.length >= 2) {
      return {
        isDialogue: true,
        confidence: "high",
        characterCount: validCharacters.length,
        segmentCount: parsed.segments.length,
        characters: validCharacters,
      };
    }
  }

  // 3. Isolated single colon line
  if (parsed.segments.length === 1 && !hasBracketedSpeaker) {
    const singleChar = parsed.characters[0]?.name.toLowerCase().trim() || "";
    if (COMMON_NON_SPEAKER_HEADERS.has(singleChar) || singleChar.length > 25) {
      return {
        isDialogue: false,
        confidence: "none",
        characterCount: 0,
        segmentCount: 0,
        characters: [],
      };
    }
    return {
      isDialogue: false,
      confidence: "ambiguous",
      warning: `Nội dung có nhãn "${parsed.characters[0]?.name}" nhưng chưa đủ cấu trúc kịch bản phân vai rõ ràng. Mặc định xử lý dạng Văn bản thường.`,
      characterCount: parsed.characters.length,
      segmentCount: parsed.segments.length,
      characters: parsed.characters,
    };
  }

  return {
    isDialogue: false,
    confidence: "none",
    characterCount: 0,
    segmentCount: 0,
    characters: [],
  };
}
