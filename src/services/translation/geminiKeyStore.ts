/**
 * Secure Storage & Migration Manager for Google Gemini API Key Pool.
 *
 * Principles:
 * 1. Persists Gemini API keys (primary + secondary) exclusively in the OS-backed
 *    encrypted vault (`gemini_keys.enc` encrypted via Windows DPAPI in Tauri).
 * 2. Automatically migrates legacy single Gemini API key from `voxlab_provider_configs_v4`
 *    and `voxlab_translation_settings` to the primary slot (`role: "primary"`).
 * 3. Scrubs legacy plaintext keys from `localStorage` ONLY AFTER confirming that
 *    the secure vault write succeeded.
 * 4. Never falls back to saving plaintext keys in `localStorage` if the secure vault fails,
 *    and never corrupts or loses previously saved keys when a write error occurs.
 * 5. Provides deterministic key masking and log/error redaction so raw keys never leak.
 */

import { TRANSLATION_SETTINGS_KEY } from "./settings";

export const PROVIDER_CONFIGS_STORAGE_KEY = "voxlab_provider_configs_v4";
export const MAX_GEMINI_TOTAL_KEYS = 20;

export type GeminiKeyRole = "primary" | "secondary";

export type GeminiKeyHealthStatus =
  | "untested"
  | "testing"
  | "valid"
  | "invalid"
  | "rate_limited"
  | "quota_exhausted";

export interface GeminiStoredKeyEntry {
  id: string;
  role: GeminiKeyRole;
  label: string;
  apiKey: string;
  createdAt?: number;
  updatedAt?: number;
}

export type GeminiKeyEntry = GeminiStoredKeyEntry;

export interface GeminiSecureVaultPayload {
  schemaVersion: 1;
  savedAt: number;
  keys: GeminiStoredKeyEntry[];
}

export interface GeminiSecureVaultBackend {
  saveEncryptedPayload(payloadJson: string): Promise<void>;
  loadEncryptedPayload(): Promise<string | null>;
}

function isTauriDesktopRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

/**
 * Default non-Tauri encrypted memory vault for Node.js test & dev environments.
 * Uses XOR + Base64 obfuscation in an isolated memory cell (never writes plaintext to localStorage).
 */
class IsolatedMemoryVaultBackend implements GeminiSecureVaultBackend {
  private encryptedBlob: string | null = null;
  public simulateWriteError: Error | null = null;
  public simulateReadError: Error | null = null;

  private obfuscate(plain: string): string {
    const bytes = new TextEncoder().encode(plain);
    const xored = bytes.map((b, idx) => b ^ (0x5a + (idx % 17)));
    let binary = "";
    for (let i = 0; i < xored.length; i++) {
      binary += String.fromCharCode(xored[i]);
    }
    return typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(xored).toString("base64");
  }

  private deobfuscate(encoded: string): string {
    const binary =
      typeof atob === "function"
        ? atob(encoded)
        : Buffer.from(encoded, "base64").toString("binary");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i) ^ (0x5a + (i % 17));
    }
    return new TextDecoder().decode(bytes);
  }

  async saveEncryptedPayload(payloadJson: string): Promise<void> {
    if (this.simulateWriteError) {
      throw this.simulateWriteError;
    }
    this.encryptedBlob = this.obfuscate(payloadJson);
  }

  async loadEncryptedPayload(): Promise<string | null> {
    if (this.simulateReadError) {
      throw this.simulateReadError;
    }
    if (!this.encryptedBlob) return null;
    return this.deobfuscate(this.encryptedBlob);
  }

  reset(): void {
    this.encryptedBlob = null;
    this.simulateWriteError = null;
    this.simulateReadError = null;
  }
}

class TauriDpapiVaultBackend implements GeminiSecureVaultBackend {
  async saveEncryptedPayload(payloadJson: string): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke<void>("save_gemini_keys_secure", { payloadJson });
  }

  async loadEncryptedPayload(): Promise<string | null> {
    const { invoke } = await import("@tauri-apps/api/core");
    const res = await invoke<string | null>("load_gemini_keys_secure");
    return res ?? null;
  }
}

const defaultMemoryVault = new IsolatedMemoryVaultBackend();
let customVaultOverride: GeminiSecureVaultBackend | null = null;

function getActiveVaultBackend(): GeminiSecureVaultBackend {
  if (customVaultOverride) return customVaultOverride;
  if (isTauriDesktopRuntime()) {
    return new TauriDpapiVaultBackend();
  }
  return defaultMemoryVault;
}

/**
 * Masks an API key for safe display / reporting (e.g. "AIza...9f2a").
 * Never returns the full key.
 */
export function maskGeminiApiKey(rawKey: string): string {
  const trimmed = (rawKey || "").trim();
  if (!trimmed) return "(trống)";
  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 2)}****${trimmed.slice(-2)}`;
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

/**
 * Redacts any known API keys and any Google `AIza...` key pattern from an arbitrary error or log string.
 */
export function redactGeminiKeysFromText(
  text: string,
  knownKeys: string[] = []
): string {
  if (!text) return "";
  let sanitized = String(text);

  // 1. Redact any known configured keys (sorted longest first)
  const validKnown = knownKeys
    .map((k) => (k || "").trim())
    .filter((k) => k.length >= 4)
    .sort((a, b) => b.length - a.length);

  for (const key of validKnown) {
    if (sanitized.includes(key)) {
      sanitized = sanitized.split(key).join(maskGeminiApiKey(key));
    }
  }

  // 2. Redact any standard Google API key pattern AIzaSy...
  sanitized = sanitized.replace(
    /AIza[0-9A-Za-z_-]{12,}/g,
    (match) => maskGeminiApiKey(match)
  );

  return sanitized;
}

/**
 * Normalizes a list of raw key inputs into a valid `GeminiStoredKeyEntry[]`:
 * - Keeps primary slot at index 0 (`id: "gemini_key_primary"`, `role: "primary"`, `label: "API Key chính"`).
 * - Assigns sequential labels `API Key phụ 1`, `API Key phụ 2`, ... to secondary keys.
 * - Deduplicates identical non-empty keys while preserving stable IDs where possible.
 */
export function normalizeGeminiKeyEntries(
  inputs: Array<{
    id?: string;
    role?: GeminiKeyRole;
    apiKey: string;
    createdAt?: number;
  }>,
  options?: { keepEmptyForUi?: boolean }
): {
  entries: GeminiStoredKeyEntry[];
  duplicateIndices: number[];
} {
  const now = Date.now();
  const seenKeys = new Set<string>();
  const duplicateIndices: number[] = [];
  const entries: GeminiStoredKeyEntry[] = [];

  let secondaryCounter = 0;

  for (let i = 0; i < inputs.length; i++) {
    const item = inputs[i];
    const trimmed = (item.apiKey || "").trim();
    const isPrimary = i === 0 || item.role === "primary";

    if (trimmed) {
      if (seenKeys.has(trimmed)) {
        duplicateIndices.push(i);
        if (!options?.keepEmptyForUi) {
          continue;
        }
      } else {
        seenKeys.add(trimmed);
      }
    } else if (!options?.keepEmptyForUi && !isPrimary) {
      continue;
    }

    if (isPrimary && entries.every((e) => e.role !== "primary")) {
      entries.push({
        id: item.id || "gemini_key_primary",
        role: "primary",
        label: "API Key chính",
        apiKey: trimmed,
        createdAt: item.createdAt || now,
        updatedAt: now,
      });
    } else {
      secondaryCounter++;
      entries.push({
        id: item.id || `gemini_key_sub_${secondaryCounter}`,
        role: "secondary",
        label: `API Key phụ ${secondaryCounter}`,
        apiKey: trimmed,
        createdAt: item.createdAt || now,
        updatedAt: now,
      });
    }
  }

  if (entries.length === 0) {
    entries.push({
      id: "gemini_key_primary",
      role: "primary",
      label: "API Key chính",
      apiKey: "",
      createdAt: now,
      updatedAt: now,
    });
  }

  return { entries, duplicateIndices };
}

// In-memory authoritative state of stored Gemini keys
let cachedStoredKeys: GeminiStoredKeyEntry[] | null = null;

/**
 * Inspects legacy `localStorage` locations (`voxlab_provider_configs_v4.gemini.apiKey`
 * and `voxlab_translation_settings.geminiApiKey`) for an unmigrated plaintext key.
 */
function readUnmigratedLegacyGeminiKeyFromLocalStorage(): string {
  if (typeof localStorage === "undefined") return "";
  try {
    const rawProviderCfg = localStorage.getItem(PROVIDER_CONFIGS_STORAGE_KEY);
    if (rawProviderCfg) {
      const parsed = JSON.parse(rawProviderCfg);
      const fromProviderCfg = (parsed?.gemini?.apiKey || "").trim();
      if (fromProviderCfg) return fromProviderCfg;
    }
  } catch {
    // ignore
  }

  try {
    const rawTrans = localStorage.getItem(TRANSLATION_SETTINGS_KEY);
    if (rawTrans) {
      const parsed = JSON.parse(rawTrans);
      const fromTrans = (parsed?.geminiApiKey || "").trim();
      if (fromTrans) return fromTrans;
    }
  } catch {
    // ignore
  }

  return "";
}

/**
 * Scrubs plaintext Gemini API keys from `localStorage` after secure vault persistence succeeds.
 * Leaves non-sensitive Gemini settings (`model`, `timeout`, `maxTokens`) intact.
 */
function scrubLegacyPlaintextGeminiKeyFromLocalStorage(): void {
  if (typeof localStorage === "undefined") return;

  try {
    const rawProviderCfg = localStorage.getItem(PROVIDER_CONFIGS_STORAGE_KEY);
    if (rawProviderCfg) {
      const parsed = JSON.parse(rawProviderCfg);
      if (parsed && parsed.gemini && parsed.gemini.apiKey) {
        delete parsed.gemini.apiKey;
        parsed.gemini.hasSecureKeyPool = true;
        localStorage.setItem(PROVIDER_CONFIGS_STORAGE_KEY, JSON.stringify(parsed));
      }
    }
  } catch {
    // ignore
  }

  try {
    const rawTrans = localStorage.getItem(TRANSLATION_SETTINGS_KEY);
    if (rawTrans) {
      const parsed = JSON.parse(rawTrans);
      if (parsed && parsed.geminiApiKey) {
        delete parsed.geminiApiKey;
        localStorage.setItem(TRANSLATION_SETTINGS_KEY, JSON.stringify(parsed));
      }
    }
  } catch {
    // ignore
  }
}

/**
 * Synchronously returns the current Gemini key entries in memory, seamlessly incorporating
 * any legacy key found in `localStorage` as the primary key if not yet migrated.
 */
export function getGeminiKeyEntriesSync(): GeminiStoredKeyEntry[] {
  const legacyKey = readUnmigratedLegacyGeminiKeyFromLocalStorage();

  if (cachedStoredKeys === null) {
    const { entries } = normalizeGeminiKeyEntries([
      { id: "gemini_key_primary", role: "primary", apiKey: legacyKey },
    ]);
    return entries.map((e) => ({ ...e }));
  }

  // If a legacy caller or test wrote a key into localStorage while cachedStoredKeys is empty
  if (
    legacyKey &&
    !cachedStoredKeys.some((k) => k.apiKey.trim().length > 0)
  ) {
    const { entries } = normalizeGeminiKeyEntries([
      { id: "gemini_key_primary", role: "primary", apiKey: legacyKey },
    ]);
    return entries.map((e) => ({ ...e }));
  }

  return cachedStoredKeys.map((e) => ({ ...e }));
}

/**
 * Returns only active (non-empty, deduplicated) Gemini key entries ready for API requests.
 */
export function getActiveGeminiKeyEntriesSync(): GeminiStoredKeyEntry[] {
  const all = getGeminiKeyEntriesSync();
  const seen = new Set<string>();
  const active: GeminiStoredKeyEntry[] = [];

  for (const entry of all) {
    const k = (entry.apiKey || "").trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    active.push({ ...entry, apiKey: k });
  }
  return active;
}

/**
 * Returns the primary Gemini API key (or first active key) for backward-compatible callers.
 */
export function getPrimaryGeminiApiKeySync(): string {
  const entries = getGeminiKeyEntriesSync();
  const primary = entries.find((e) => e.role === "primary");
  if (primary && primary.apiKey.trim()) {
    return primary.apiKey.trim();
  }
  const firstActive = entries.find((e) => e.apiKey.trim().length > 0);
  return firstActive ? firstActive.apiKey.trim() : "";
}

/**
 * Loads Gemini key entries from the OS secure vault (`load_gemini_keys_secure`)
 * and performs one-time safe migration from legacy `localStorage` if needed.
 */
export async function loadGeminiKeyEntriesFromVault(): Promise<GeminiStoredKeyEntry[]> {
  const vault = getActiveVaultBackend();
  const legacyKey = readUnmigratedLegacyGeminiKeyFromLocalStorage();

  let vaultEntries: GeminiStoredKeyEntry[] | null = null;
  try {
    const rawJson = await vault.loadEncryptedPayload();
    if (rawJson) {
      const parsed = JSON.parse(rawJson) as GeminiSecureVaultPayload;
      if (parsed && Array.isArray(parsed.keys) && parsed.keys.length > 0) {
        const { entries } = normalizeGeminiKeyEntries(parsed.keys, {
          keepEmptyForUi: true,
        });
        vaultEntries = entries;
      }
    }
  } catch (err: any) {
    const safeMsg = redactGeminiKeysFromText(err?.message || String(err), [legacyKey]);
    console.warn("Could not read Gemini keys from secure vault:", safeMsg);
  }

  if (vaultEntries && vaultEntries.some((e) => e.apiKey.trim().length > 0)) {
    // If legacy key exists and isn't in vaultEntries yet, preserve it without losing anything
    if (
      legacyKey &&
      !vaultEntries.some((e) => e.apiKey.trim() === legacyKey)
    ) {
      const primary = vaultEntries.find((e) => e.role === "primary");
      if (primary && !primary.apiKey.trim()) {
        primary.apiKey = legacyKey;
      } else {
        vaultEntries.push({
          id: `gemini_key_sub_${vaultEntries.length}`,
          role: "secondary",
          label: `API Key phụ ${vaultEntries.length}`,
          apiKey: legacyKey,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      const { entries } = normalizeGeminiKeyEntries(vaultEntries);
      await saveGeminiKeyEntries(entries);
      return getGeminiKeyEntriesSync();
    }

    cachedStoredKeys = vaultEntries;
    if (legacyKey) {
      scrubLegacyPlaintextGeminiKeyFromLocalStorage();
    }
    return cachedStoredKeys.map((e) => ({ ...e }));
  }

  // No keys in vault yet; check if we have a legacy key to migrate
  if (legacyKey) {
    const { entries } = normalizeGeminiKeyEntries([
      { id: "gemini_key_primary", role: "primary", apiKey: legacyKey },
    ]);
    await saveGeminiKeyEntries(entries);
    return getGeminiKeyEntriesSync();
  }

  if (!cachedStoredKeys) {
    const { entries } = normalizeGeminiKeyEntries([
      { id: "gemini_key_primary", role: "primary", apiKey: "" },
    ]);
    cachedStoredKeys = entries;
  }

  return cachedStoredKeys.map((e) => ({ ...e }));
}

/**
 * Saves Gemini API key entries atomically to the OS secure vault.
 * - Rejects duplicate non-empty keys.
 * - Never falls back to plaintext `localStorage` if the secure vault write fails.
 * - Preserves the previous `cachedStoredKeys` if the vault write fails.
 * - Scrubs any legacy plaintext key from `localStorage` only after vault write succeeds.
 */
export async function saveGeminiKeyEntries(
  rawInputs: Array<{
    id?: string;
    role?: GeminiKeyRole;
    apiKey: string;
    createdAt?: number;
  }>
): Promise<GeminiStoredKeyEntry[]> {
  const { entries, duplicateIndices } = normalizeGeminiKeyEntries(rawInputs);
  if (duplicateIndices.length > 0) {
    throw new Error("Không chấp nhận API Key trùng nhau trong danh sách Gemini.");
  }

  const payload: GeminiSecureVaultPayload = {
    schemaVersion: 1,
    savedAt: Date.now(),
    keys: entries,
  };

  const vault = getActiveVaultBackend();
  // Will throw if secure storage fails; we DO NOT catch and fallback to localStorage
  await vault.saveEncryptedPayload(JSON.stringify(payload));

  // Vault write succeeded: update authoritative in-memory cache and scrub legacy plaintext
  cachedStoredKeys = entries;
  scrubLegacyPlaintextGeminiKeyFromLocalStorage();

  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      window.dispatchEvent(new CustomEvent("voxlab_gemini_keys_updated"));
    } catch {
      // ignore in headless test environments
    }
  }

  return cachedStoredKeys.map((e) => ({ ...e }));
}

/**
 * Test helper: allows injecting a custom or simulated vault backend and resetting cache.
 */
export function configureGeminiKeyStoreForTest(options?: {
  vaultBackend?: GeminiSecureVaultBackend | null;
  resetMemory?: boolean;
}): IsolatedMemoryVaultBackend {
  if (options?.vaultBackend !== undefined) {
    customVaultOverride = options.vaultBackend;
  }
  if (options?.resetMemory) {
    cachedStoredKeys = null;
    defaultMemoryVault.reset();
  }
  return defaultMemoryVault;
}
