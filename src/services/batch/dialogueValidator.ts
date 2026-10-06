/**
 * VoxLab — Batch Dialogue Contract Validator
 * Validates text content to determine whether it conforms to a multi-speaker dialogue script.
 */

import { detectDialogueScript, parseDialogueScript } from "../dialogue/parser";
import { DialogueCharacter } from "../../types/dialogue";

export interface DialogueValidationResult {
  isDialogueScript: boolean;
  characterCount: number;
  characters: DialogueCharacter[];
  characterNames: string[];
  reason?: string;
}

/**
 * Validates whether the given text content satisfies the dialogue script contract:
 * Requires at least 1 valid dialogue line with format [Tên]: Thoại or Tên: Thoại
 */
export function validateDialogueScript(text: string): DialogueValidationResult {
  if (!text || !text.trim()) {
    return {
      isDialogueScript: false,
      characterCount: 0,
      characters: [],
      characterNames: [],
      reason: "Nội dung tệp văn bản trống.",
    };
  }

  const detection = detectDialogueScript(text);
  const parsed = parseDialogueScript(text);

  const characterNames = parsed.characters.map((c) => c.name);

  if (detection.isDialogue && parsed.characters.length >= 1) {
    return {
      isDialogueScript: true,
      characterCount: parsed.characters.length,
      characters: parsed.characters,
      characterNames,
    };
  }

  return {
    isDialogueScript: false,
    characterCount: parsed.characters.length,
    characters: parsed.characters,
    characterNames,
    reason:
      detection.warning ||
      "Tệp văn bản chưa có định dạng phân vai kịch bản hợp lệ (ví dụ: [Nhân vật]: lời thoại).",
  };
}
