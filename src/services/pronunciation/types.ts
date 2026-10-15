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

export type PronunciationMappingCategory =
  | "project_rule"
  | "global_rule"
  | "verified_dict"
  | "auto_context"
  | "version_entity"
  | "preserve";

export type PronunciationMappingMode =
  | "letter_by_letter"
  | "word"
  | "custom"
  | "preserve";

export interface PronunciationMappingEntry {
  sourceSpan: string;
  spokenForm: string;
  startIndex: number;
  endIndex: number;
  category: PronunciationMappingCategory;
  mode: PronunciationMappingMode;
  expectedLetters?: string[];
  allowedForms?: string[];
  forbiddenWords?: string[];
}

export interface PreparedSpokenTextResult {
  sourceText: string;
  spokenText: string;
  pronunciationMapping: PronunciationMappingEntry[];
}

