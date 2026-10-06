export type PronunciationScope = "global" | "project";

export interface PronunciationRule {
  id: string;
  sourceText: string;
  spokenText: string;
  enabled: boolean;
  caseSensitive: boolean;
  scope: PronunciationScope;
  createdAt: string;
  updatedAt: string;
}

export interface PronunciationMatchSpan {
  id: string;
  startIndex: number;
  endIndex: number;
  matchedText: string;
  spokenText: string;
  placeholder: string;
}
