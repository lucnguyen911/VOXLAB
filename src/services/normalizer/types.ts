export type NormalizerGroupId =
  | "whitespace"
  | "punctuation"
  | "unicode"
  | "numbers"
  | "pronunciation";

export interface NormalizerGroup {
  id: NormalizerGroupId;
  name: string;
  description: string;
  example?: string;
  exampleBefore?: string;
  exampleAfter?: string;
  category?: "format" | "punctuation" | "content";
  categoryName?: string;
  defaultEnabled: boolean;
}

export type DiffTokenType =
  | "equal"
  | "pure_deleted"
  | "replaced_old"
  | "pure_added"
  | "replaced_new"
  // Backward compatibility
  | "removed"
  | "added"
  | "modified";

export interface DiffToken {
  text: string;
  type: DiffTokenType;
  oldText?: string;
}

export interface NormalizationResult {
  originalText: string;
  normalizedText: string;
  enabledGroupIds: NormalizerGroupId[];
  hasChanges: boolean;
  totalChanges: number;
  originalChars: number;
  normalizedChars: number;
  originalWords: number;
  normalizedWords: number;
  addedWords: number;
  deletedWords: number;
  addedChars: number;
  deletedChars: number;
  diffBefore: DiffToken[];
  diffAfter: DiffToken[];
}
