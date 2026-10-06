import { PronunciationRule } from "./types";

export const GLOBAL_RULES_STORAGE_KEY = "voxlab_pronunciation_global_rules";
export const PROJECT_RULES_STORAGE_KEY = "voxlab_pronunciation_project_rules";

function isLocalStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/**
 * Loads global pronunciation rules from localStorage.
 */
export function loadGlobalRules(): PronunciationRule[] {
  if (!isLocalStorageAvailable()) return [];
  try {
    const raw = window.localStorage.getItem(GLOBAL_RULES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Saves global pronunciation rules to localStorage.
 */
export function saveGlobalRules(rules: PronunciationRule[]): void {
  if (!isLocalStorageAvailable()) return;
  try {
    window.localStorage.setItem(GLOBAL_RULES_STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // Ignore quota errors
  }
}

/**
 * Loads project-specific pronunciation rules from localStorage.
 */
export function loadProjectRules(projectId: string = "current"): PronunciationRule[] {
  if (!isLocalStorageAvailable()) return [];
  try {
    const key = `${PROJECT_RULES_STORAGE_KEY}_${projectId}`;
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Saves project-specific pronunciation rules to localStorage.
 */
export function saveProjectRules(rules: PronunciationRule[], projectId: string = "current"): void {
  if (!isLocalStorageAvailable()) return;
  try {
    const key = `${PROJECT_RULES_STORAGE_KEY}_${projectId}`;
    window.localStorage.setItem(key, JSON.stringify(rules));
  } catch {
    // Ignore quota errors
  }
}

/**
 * Returns all active/enabled rules applicable to the current project context,
 * combining global rules and project rules.
 */
export function getEffectiveRules(projectId: string = "current"): PronunciationRule[] {
  const globalRules = loadGlobalRules().filter((r) => r.enabled);
  const projectRules = loadProjectRules(projectId).filter((r) => r.enabled);
  return [...globalRules, ...projectRules];
}

/**
 * Returns the count of all active/enabled rules.
 */
export function getActiveRulesCount(projectId: string = "current"): number {
  return getEffectiveRules(projectId).length;
}
