/**
 * Punctuation Processor for Text Normalization.
 * 
 * Rules:
 * - Only processes real punctuation remaining in text/punctuation tokens.
 * - Protects all structured tokens (URL, Email, IP, Time, Date, Version, Ratio, Numbers)
 *   from punctuation splitting or spacing rules.
 * - Never forces capitalization after colons (e.g. "Tesla: the next generation" preserved).
 * - Ensures space after punctuation (.,:;!?) when followed by word characters.
 * - Collapses repeated punctuation (!!! -> !, ??? -> ?, ... -> .) while preserving ?! and !?.
 */

import { classifyTextTokens } from "./tokenClassifier";

export function processPunctuation(text: string): string {
  if (!text) return "";

  // 1. Classify tokens to identify and protect all non-punctuation structured spans
  const tokens = classifyTextTokens(text);

  let sessionKey = Math.random().toString(36).slice(2) + Date.now().toString(36);
  while (text.includes(sessionKey)) {
    sessionKey = Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  const protectedSpans: string[] = [];
  const protectedParts: string[] = [];

  for (const token of tokens) {
    if (
      token.type === "url" ||
      token.type === "email" ||
      token.type === "ip" ||
      token.type === "time" ||
      token.type === "date" ||
      token.type === "version" ||
      token.type === "ratio" ||
      token.type === "currency" ||
      token.type === "percentage" ||
      token.type === "unit" ||
      token.type === "decimal" ||
      token.type === "integer" ||
      token.type === "technical"
    ) {
      protectedSpans.push(token.raw);
      protectedParts.push(`VOXPUNCT${sessionKey}P${protectedSpans.length - 1}TNUPXOV`);
    } else {
      protectedParts.push(token.raw);
    }
  }

  let res = protectedParts.join("");

  // 2. Collapse repeated punctuation (collapse !!! -> !, ??? -> ?, ... -> .) while preserving ?! and !?
  res = res.replace(/\?!+/g, "?!").replace(/!\?+/g, "!?");
  res = res
    .replace(/(?<!\?)\!{2,}/g, "!")
    .replace(/(?<!\!)\?{2,}/g, "?")
    .replace(/\.{2,}/g, ".")
    .replace(/,{2,}/g, ",")
    .replace(/;{2,}/g, ";")
    .replace(/:{2,}/g, ":");

  // 3. Obvious stray punctuation (, . -> . và . , -> .)
  res = res
    .replace(/,\s*\./g, ".")
    .replace(/\.\s*,/g, ".");

  // 4. Clean stray punctuation at start of line
  res = res.replace(/^[^\S\r\n]*[,;]+/gm, "");

  // 5. Remove space before punctuation (.,:;!?)
  res = res.replace(/[^\S\r\n]+([,.:;!?])/g, "$1");

  // 6. Add space after punctuation when directly adjacent to word characters
  res = res
    .replace(/([,;:])(?=[^\s\d\p{P}])/gu, "$1 ")
    .replace(/([.!?])(?=[^\s\d\p{P}])/gu, "$1 ");

  // 7. Capitalization strictly after sentence boundary (. ! ?) on the same line (NOT after colon!)
  res = res.replace(/([.!?][^\S\r\n]+)(\p{Ll})/gu, (_, p1, letter) => p1 + letter.toUpperCase());

  // 8. Restore protected structured spans
  const restoreRegex = new RegExp(`VOXPUNCT${sessionKey}P(\\d+)TNUPXOV`, "g");
  res = res.replace(restoreRegex, (_, idx) => protectedSpans[Number(idx)] ?? "");

  return res;
}
