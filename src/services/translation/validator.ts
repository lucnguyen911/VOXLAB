import { OriginalCue, TranslatedCue } from "../../types/dubbing";

export interface TranslationValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates the strict 1:1 invariant between OriginalCue[] and TranslatedCue[].
 * Adheres strictly to SPEC.md v2.5.3 Section 16.1 and PLAN.md TASK-09:
 * 1. Count must match exactly (no merged or dropped cues).
 * 2. Sequential 1-based index must match exactly.
 * 3. Timestamps (startSec, endSec) must match original timeline with zero drift.
 * 4. Translated text must not be empty.
 * 5. Reference text must match originalText.
 */
export function validateTranslationResponse1to1(
  originalCues: OriginalCue[],
  translatedCues: TranslatedCue[]
): TranslationValidationResult {
  const errors: string[] = [];

  if (!originalCues || originalCues.length === 0) {
    if (translatedCues && translatedCues.length > 0) {
      errors.push("Danh sách câu gốc rỗng nhưng danh sách câu dịch lại có dữ liệu.");
    }
    return {
      valid: errors.length === 0,
      errors,
    };
  }

  if (!translatedCues || translatedCues.length === 0) {
    errors.push(
      `Danh sách câu dịch rỗng trong khi kịch bản gốc có ${originalCues.length} câu.`
    );
    return {
      valid: false,
      errors,
    };
  }

  // Rule 1: Exact cue count invariant
  if (translatedCues.length !== originalCues.length) {
    errors.push(
      `Số lượng câu dịch (${translatedCues.length}) không khớp với số lượng câu gốc (${originalCues.length}). Provider có thể đã gộp hoặc bỏ sót câu.`
    );
  }

  // Iterate over pairwise elements up to max length
  const maxLen = Math.max(originalCues.length, translatedCues.length);

  for (let i = 0; i < maxLen; i++) {
    const orig = originalCues[i];
    const trans = translatedCues[i];

    if (!orig) {
      errors.push(`Câu dịch thứ ${i + 1} (index: ${trans.index}) là câu thừa, không có câu gốc tương ứng.`);
      continue;
    }

    if (!trans) {
      errors.push(`Câu gốc #${orig.index} (${orig.startSec}s - ${orig.endSec}s) bị bỏ sót trong kết quả dịch.`);
      continue;
    }

    // Rule 2: Index invariant
    if (trans.index !== orig.index) {
      errors.push(
        `Thứ tự index không khớp tại vị trí ${i + 1}: câu gốc index=${orig.index}, câu dịch index=${trans.index}.`
      );
    }

    // Rule 3: Strict timestamp invariance (Source Subtitle Timeline)
    if (Math.abs(trans.startSec - orig.startSec) > 0.001) {
      errors.push(
        `Mốc bắt đầu câu #${orig.index} bị sai lệch: gốc=${orig.startSec}s, dịch=${trans.startSec}s.`
      );
    }

    if (Math.abs(trans.endSec - orig.endSec) > 0.001) {
      errors.push(
        `Mốc kết thúc câu #${orig.index} bị sai lệch: gốc=${orig.endSec}s, dịch=${trans.endSec}s.`
      );
    }

    // Rule 4: Non-empty translation text
    if (!trans.text || !trans.text.trim()) {
      errors.push(`Nội dung dịch tại câu #${orig.index} bị rỗng hoặc chỉ chứa khoảng trắng.`);
    }

    // Rule 5: Original text reference
    if (trans.originalText !== orig.text) {
      errors.push(
        `Trường originalText tại câu #${orig.index} không khớp với văn bản câu gốc.`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
