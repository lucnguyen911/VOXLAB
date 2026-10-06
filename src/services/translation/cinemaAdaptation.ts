import { OriginalCue } from "../../types/dubbing";

export interface CinemaAdaptationParams {
  cue: OriginalCue;
  prevCues: OriginalCue[];
  nextCues: OriginalCue[];
  rawTranslation: string;
  targetLang: string;
}

/**
 * Builds a prompt for LLMs (Gemini / DeepSeek / LM Studio) that instructs
 * the model to adapt subtitle text into natural, cinematic dialogue matching duration.
 */
export function buildCinemaPrompt(params: CinemaAdaptationParams): string {
  const { cue, prevCues, nextCues, rawTranslation, targetLang } = params;
  const durationSec = Number((cue.endSec - cue.startSec).toFixed(2));
  const targetWords = Math.max(3, Math.floor(durationSec * 2.8));

  const prevText =
    prevCues.length > 0
      ? prevCues.map((c) => `- "${c.text}"`).join("\n")
      : "(Bắt đầu phân cảnh)";
  const nextText =
    nextCues.length > 0
      ? nextCues.map((c) => `- "${c.text}"`).join("\n")
      : "(Hết phân cảnh)";

  return `Bạn là chuyên gia chuyển thể kịch bản lồng tiếng điện ảnh (Film Dubbing Adapter).
NGỮ CẢNH PHÂN CẢNH (Hãy đọc toàn bộ ngữ cảnh để nắm trọn mạch truyện, xưng hô và cảm xúc):
[Các câu thoại trước]:
${prevText}

[Câu thoại hiện tại cần lồng tiếng] (Thời lượng cho phép: ${durationSec} giây, tối đa ~${targetWords} từ):
"${cue.text}"
Bản dịch thô: "${rawTranslation}"

[Các câu thoại tiếp theo]:
${nextText}

YÊU CẦU CHUYỂN THỂ ĐIỆN ẢNH:
1. Dịch / viết lại câu hiện tại sang ${targetLang} theo phong cách thoại điện ảnh tự nhiên, sinh động, giàu cảm xúc.
2. TỐI ƯU THỜI LƯỢNG: Phải vừa khít ${durationSec} giây (khoảng ${targetWords} từ hoặc ngắn hơn), tuyệt đối không viết dài dòng để diễn viên kịp nói hết trước câu sau.
3. Bỏ toàn bộ các từ đệm dư thừa của văn dịch máy (như "thực sự là", "như thể là", "của bạn").
4. Trả về DUY NHẤT câu thoại đã chuyển thể, không kèm giải thích hay dấu ngoặc kép.`;
}

/**
 * Condenses Vietnamese subtitle text into concise, cinematic phrasing
 * matching the allocated speech duration when an LLM is not configured or in fallback mode.
 * Preserves core semantics and emotion while removing machine translation clutter.
 */
export function condenseVietnameseCinemaLine(text: string, durationSec: number): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  // Target word count based on natural speaking rate (~3 words/second in VN)
  const maxWords = Math.max(3, Math.floor(durationSec * 3.0));
  const currentWords = trimmed.split(/\s+/);

  if (currentWords.length <= maxWords) {
    return trimmed;
  }

  // Common verbose patterns in machine-translated Vietnamese and their concise equivalents
  let condensed = trimmed;

  const replacements: [RegExp, string][] = [
    // Redundant connective phrases & fillers
    [/\bgiống như là một người\b/gi, "như có người"],
    [/\bgiống như một người\b/gi, "như có người"],
    [/\bgiống như là\b/gi, "như"],
    [/\bở trong căn bếp\b/gi, "trong bếp"],
    [/\btrong nhà bếp\b/gi, "trong bếp"],
    [/\bngay bây giờ\b/gi, "ngay lúc này"],
    [/\bngay thời điểm này\b/gi, "ngay lúc này"],
    [/\bthực sự là\b/gi, "thực sự"],
    [/\bđó là một\b/gi, "đó là"],
    [/\bđây là một\b/gi, "đây là"],
    [/\bchính là một\b/gi, "chính là"],
    [/\bcó thể nói rằng\b/gi, ""],
    [/\bđiều đó có nghĩa là\b/gi, "nghĩa là"],
    [/\btrong khi đó thì\b/gi, "trong khi"],
    [/\bmột cách hoàn toàn\b/gi, "hoàn toàn"],
    [/\bmột cách dễ dàng\b/gi, "dễ dàng"],
    [/\bmột cách nhanh chóng\b/gi, "nhanh chóng"],
    [/\bvào lúc này\b/gi, "lúc này"],
    [/\bngay tại đây\b/gi, "tại đây"],
    [/\bcủa bạn\b/gi, "bạn"],
    [/\bcủa chúng ta\b/gi, "chúng ta"],
    [/\bcủa tôi\b/gi, "tôi"],
  ];

  for (const [pattern, repl] of replacements) {
    condensed = condensed.replace(pattern, repl).trim();
  }

  // Clean up duplicate spaces and punctuation
  condensed = condensed.replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",");

  return condensed;
}

/**
 * Adapts a single cue to cinema style using full dialogue context and duration constraints.
 */
export function adaptCueToCinemaStyle(params: CinemaAdaptationParams): string {
  const { cue, rawTranslation, targetLang } = params;
  const durationSec = Number((cue.endSec - cue.startSec).toFixed(3));

  if (targetLang.toLowerCase().startsWith("vi")) {
    return condenseVietnameseCinemaLine(rawTranslation, durationSec);
  }

  return rawTranslation;
}
