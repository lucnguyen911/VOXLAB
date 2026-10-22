/**
 * Secure Storage & Migration Manager for Google Gemini API Key Pool.
 *
 * Principles:
 * 1. Persists Gemini API keys (primary + secondary) exclusively in the OS-backed
 *    encrypted vault (`gemini_keys.enc` encrypted via Windows DPAPI in Tauri).
 * 2. Centralizes initialization (`ensureGeminiKeyStoreInitialized`) with explicit
 *    lifecycle states (`"idle" | "loading" | "ready" | "error"`).
 * 3. Automatically migrates legacy single Gemini API key from `voxlab_provider_configs_v4`
 *    and `voxlab_translation_settings` to the primary slot (`role: "primary"`).
 * 4. Scrubs legacy plaintext keys from `localStorage` ONLY AFTER confirming that
 *    the secure vault write AND read-back verification succeeded.
 * 5. Never treats a failed/corrupted vault read as an empty key list and blocks
 *    automatic overwrites when the vault is in `"error"` state.
 * 6. Serializes all writes through a monotonic revision queue so out-of-order async
 *    completions can never overwrite newer key states.
 * 7. Provides deterministic key masking and log/error redaction so raw keys never leak.
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

export type GeminiVaultInitStatus = "idle" | "loading" | "ready" | "error";

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
  revision?: number;
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
  public writeDelayMs = 0;
  public writeCallCount = 0;

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
    this.writeCallCount += 1;
    if (this.writeDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.writeDelayMs));
    }
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

  setRawCorruptedBlobForTest(rawBlob: string): void {
    this.encryptedBlob = rawBlob;
  }

  reset(): void {
    this.encryptedBlob = null;
    this.simulateWriteError = null;
    this.simulateReadError = null;
    this.writeDelayMs = 0;
    this.writeCallCount = 0;
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
 * - Keeps primary slot at index 0 (`role: "primary"`, `label: "API Key chính"`), preserving its ID if provided.
 * - Assigns sequential labels `API Key phụ 1`, `API Key phụ 2`, ... to secondary keys while preserving their stable IDs.
 * - Deduplicates identical non-empty keys.
 */
export function normalizeGeminiKeyEntries(
  inputs: Array<{
    id?: string;
    role?: GeminiKeyRole;
    label?: string;
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

// ============================================================================
// AUTHORITATIVE IN-MEMORY STATE, LIFECYCLE & SERIALIZED WRITE QUEUE
// ============================================================================

let cachedStoredKeys: GeminiStoredKeyEntry[] | null = null;
let vaultStatus: GeminiVaultInitStatus = "idle";
let vaultErrorMessage: string | null = null;
let initInFlightPromise: Promise<GeminiStoredKeyEntry[]> | null = null;

// Monotonic revision counters and serialized write queue
let latestRequestedRevision = 0;
let committedRevision = 0;
let pendingStagedInputs: Array<{
  id?: string;
  role?: GeminiKeyRole;
  apiKey: string;
  createdAt?: number;
}> | null = null;
let pendingStagedRevision = 0;
let writeQueueChain: Promise<void> = Promise.resolve();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let debounceResolvers: Array<{
  resolve: (entries: GeminiStoredKeyEntry[]) => void;
  reject: (err: unknown) => void;
}> = [];

/**
 * Returns the current initialization status (`"idle" | "loading" | "ready" | "error"`) of the Gemini key store.
 */
export function getGeminiVaultStatus(): GeminiVaultInitStatus {
  return vaultStatus;
}

/**
 * Returns the last vault read/decrypt error message, if any.
 */
export function getGeminiVaultError(): string | null {
  return vaultErrorMessage;
}

/**
 * Returns full diagnostic state including status, error, and monotonic revision counters.
 */
export function getGeminiKeyStoreDiagnostics(): {
  status: GeminiVaultInitStatus;
  error: string | null;
  revision: number;
  committedRevision: number;
  latestRequestedRevision: number;
} {
  return {
    status: vaultStatus,
    error: vaultErrorMessage,
    revision: committedRevision,
    committedRevision,
    latestRequestedRevision,
  };
}

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
 * Scrubs plaintext Gemini API keys from `localStorage` ONLY after secure vault write + read-back verification succeeds.
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
 * Parses and validates a decrypted JSON string from the vault.
 * Throws if the JSON is malformed or schema is invalid.
 */
function parseAndValidateVaultJson(rawJson: string): GeminiSecureVaultPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err: any) {
    throw new Error(`Dữ liệu kho khóa Gemini bị hỏng (JSON không hợp lệ): ${err?.message || String(err)}`);
  }

  if (Array.isArray(parsed)) {
    return {
      schemaVersion: 1,
      revision: 1,
      savedAt: Date.now(),
      keys: parsed as GeminiStoredKeyEntry[],
    };
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as GeminiSecureVaultPayload).keys)
  ) {
    throw new Error("Cấu trúc kho khóa Gemini không hợp lệ (thiếu danh sách keys).");
  }

  return parsed as GeminiSecureVaultPayload;
}

/**
 * Writes `entries` to the vault and verifies read-back integrity before committing.
 */
async function writeAndVerifyVaultEntries(
  vault: GeminiSecureVaultBackend,
  entries: GeminiStoredKeyEntry[],
  revision: number
): Promise<void> {
  const payload: GeminiSecureVaultPayload = {
    schemaVersion: 1,
    revision,
    savedAt: Date.now(),
    keys: entries,
  };
  const serialized = JSON.stringify(payload);
  await vault.saveEncryptedPayload(serialized);

  // Read-back verification to guarantee the vault can be read & decrypted before scrubbing legacy keys
  const readBackRaw = await vault.loadEncryptedPayload();
  if (!readBackRaw) {
    throw new Error("Xác minh sau khi ghi kho khóa Gemini thất bại: không đọc lại được dữ liệu vừa lưu.");
  }
  const verifiedPayload = parseAndValidateVaultJson(readBackRaw);
  const expectedNonEmpty = entries.filter((e) => e.apiKey.trim().length > 0);
  for (const exp of expectedNonEmpty) {
    const found = verifiedPayload.keys.some((k) => (k.apiKey || "").trim() === exp.apiKey.trim());
    if (!found) {
      throw new Error("Xác minh dữ liệu kho khóa Gemini thất bại: danh sách khóa đọc lại không khớp.");
    }
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
 * Centralized initialization of the Gemini encrypted key vault.
 * - Safe to call concurrently from App startup, Translation, Dubbing, Batch, or Settings.
 * - Distinguishes `"loading"`, `"ready"`, and `"error"` states.
 * - Never overwrites the vault with an empty list if reading/decrypting fails.
 * - Only scrubs legacy plaintext `localStorage` keys after saving AND verifying read-back in the encrypted vault.
 */
export async function ensureGeminiKeyStoreInitialized(options?: {
  forceReload?: boolean;
}): Promise<GeminiStoredKeyEntry[]> {
  if (vaultStatus === "ready" && cachedStoredKeys !== null && !options?.forceReload) {
    // Check if a new legacy key was injected into localStorage after init (e.g. in tests or legacy code)
    const lateLegacyKey = readUnmigratedLegacyGeminiKeyFromLocalStorage();
    if (
      !lateLegacyKey ||
      cachedStoredKeys.some((e) => e.apiKey.trim() === lateLegacyKey)
    ) {
      return cachedStoredKeys.map((e) => ({ ...e }));
    }
  }

  if (initInFlightPromise && !options?.forceReload) {
    return initInFlightPromise;
  }

  initInFlightPromise = (async () => {
    vaultStatus = "loading";
    vaultErrorMessage = null;

    const vault = getActiveVaultBackend();
    const legacyKey = readUnmigratedLegacyGeminiKeyFromLocalStorage();

    let rawJson: string | null = null;
    try {
      rawJson = await vault.loadEncryptedPayload();
    } catch (err: any) {
      const safeMsg = redactGeminiKeysFromText(
        err?.message || String(err),
        legacyKey ? [legacyKey] : []
      );
      vaultStatus = "error";
      vaultErrorMessage = `Không thể đọc hoặc giải mã kho khóa Gemini bảo mật: ${safeMsg}`;
      throw new Error(vaultErrorMessage);
    }

    let vaultEntries: GeminiStoredKeyEntry[] | null = null;
    let loadedRevision = 0;

    if (rawJson !== null) {
      try {
        const parsed = parseAndValidateVaultJson(rawJson);
        loadedRevision = typeof parsed.revision === "number" ? parsed.revision : 1;
        const { entries } = normalizeGeminiKeyEntries(parsed.keys, {
          keepEmptyForUi: true,
        });
        vaultEntries = entries;
      } catch (parseErr: any) {
        const safeMsg = redactGeminiKeysFromText(
          parseErr?.message || String(parseErr),
          legacyKey ? [legacyKey] : []
        );
        vaultStatus = "error";
        vaultErrorMessage = `Kho khóa Gemini bị lỗi định dạng hoặc hỏng dữ liệu: ${safeMsg}`;
        throw new Error(vaultErrorMessage);
      }
    }

    // Case 1: Vault already has keys
    if (vaultEntries && vaultEntries.some((e) => e.apiKey.trim().length > 0)) {
      if (
        legacyKey &&
        !vaultEntries.some((e) => e.apiKey.trim() === legacyKey)
      ) {
        const merged = vaultEntries.map((e) => ({ ...e }));
        const primary = merged.find((e) => e.role === "primary");
        if (primary && !primary.apiKey.trim()) {
          primary.apiKey = legacyKey;
        } else {
          merged.push({
            id: `gemini_key_sub_${merged.length}`,
            role: "secondary",
            label: `API Key phụ ${merged.length}`,
            apiKey: legacyKey,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        }
        const { entries } = normalizeGeminiKeyEntries(merged);
        try {
          const nextRev = Math.max(committedRevision, loadedRevision) + 1;
          await writeAndVerifyVaultEntries(vault, entries, nextRev);
          cachedStoredKeys = entries;
          committedRevision = nextRev;
          latestRequestedRevision = Math.max(latestRequestedRevision, nextRev);
          vaultStatus = "ready";
          vaultErrorMessage = null;
          scrubLegacyPlaintextGeminiKeyFromLocalStorage();
          return cachedStoredKeys.map((e) => ({ ...e }));
        } catch (migErr: any) {
          // Migration write failed: keep both vault keys and legacy key in memory, do NOT scrub localStorage
          cachedStoredKeys = entries;
          vaultStatus = "ready";
          return cachedStoredKeys.map((e) => ({ ...e }));
        }
      }

      cachedStoredKeys = vaultEntries;
      committedRevision = Math.max(committedRevision, loadedRevision, 1);
      latestRequestedRevision = Math.max(latestRequestedRevision, committedRevision);
      vaultStatus = "ready";
      vaultErrorMessage = null;

      if (legacyKey) {
        scrubLegacyPlaintextGeminiKeyFromLocalStorage();
      }
      return cachedStoredKeys.map((e) => ({ ...e }));
    }

    // Case 2: Vault is empty/non-existent, but legacy plaintext key exists in localStorage
    if (legacyKey) {
      const { entries } = normalizeGeminiKeyEntries([
        { id: "gemini_key_primary", role: "primary", apiKey: legacyKey },
      ]);
      try {
        const nextRev = Math.max(committedRevision, loadedRevision) + 1;
        await writeAndVerifyVaultEntries(vault, entries, nextRev);
        cachedStoredKeys = entries;
        committedRevision = nextRev;
        latestRequestedRevision = Math.max(latestRequestedRevision, nextRev);
        vaultStatus = "ready";
        vaultErrorMessage = null;
        // Scrub legacy key ONLY after write + read-back verification succeeded!
        scrubLegacyPlaintextGeminiKeyFromLocalStorage();
        return cachedStoredKeys.map((e) => ({ ...e }));
      } catch (migErr: any) {
        const safeMsg = redactGeminiKeysFromText(
          migErr?.message || String(migErr),
          [legacyKey]
        );
        console.warn("Could not migrate legacy Gemini key to vault (preserving legacy key):", safeMsg);
        // Preserve legacy key in memory and in localStorage so user does not lose their key
        cachedStoredKeys = entries;
        vaultStatus = "ready";
        return cachedStoredKeys.map((e) => ({ ...e }));
      }
    }

    // Case 3: Fresh install (no vault file and no legacy key)
    if (!cachedStoredKeys) {
      const { entries } = normalizeGeminiKeyEntries(
        vaultEntries && vaultEntries.length > 0
          ? vaultEntries
          : [{ id: "gemini_key_primary", role: "primary", apiKey: "" }],
        { keepEmptyForUi: true }
      );
      cachedStoredKeys = entries;
    }

    vaultStatus = "ready";
    vaultErrorMessage = null;
    return cachedStoredKeys.map((e) => ({ ...e }));
  })();

  try {
    return await initInFlightPromise;
  } finally {
    initInFlightPromise = null;
  }
}

/**
 * Loads Gemini key entries from the OS secure vault (`load_gemini_keys_secure`)
 * and performs one-time safe migration from legacy `localStorage` if needed.
 * Calls `ensureGeminiKeyStoreInitialized({ forceReload: true })` so explicit callers
 * always read the latest state while respecting error protection.
 */
export async function loadGeminiKeyEntriesFromVault(): Promise<GeminiStoredKeyEntry[]> {
  await flushPendingGeminiKeyWrites();
  return ensureGeminiKeyStoreInitialized({ forceReload: true });
}

/**
 * Saves Gemini API key entries atomically via a serialized write queue with monotonic revision tracking.
 * - Rejects duplicate non-empty keys.
 * - Refuses to overwrite the vault if the initial vault load/decrypt failed (`vaultStatus === "error"`), unless `forceRecover` is true.
 * - Coalesces / supersedes older pending writes so an earlier slow write can NEVER overwrite a newer revision.
 * - Never falls back to plaintext `localStorage` if the secure vault write fails.
 * - Preserves the previous `cachedStoredKeys` if the vault write fails.
 * - Scrubs any legacy plaintext key from `localStorage` only after vault write + read-back verification succeeds.
 */
export async function saveGeminiKeyEntries(
  rawInputs: Array<{
    id?: string;
    role?: GeminiKeyRole;
    label?: string;
    apiKey: string;
    createdAt?: number;
  }>,
  options?: { forceRecoverFromVaultError?: boolean }
): Promise<GeminiStoredKeyEntry[]> {
  // Cancel any pending debounce timer because an explicit save is being queued now
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (vaultStatus === "error" && !options?.forceRecoverFromVaultError) {
    throw new Error(
      vaultErrorMessage ||
        "Không thể ghi đè kho khóa Gemini vì kho khóa hiện tại đang gặp lỗi đọc/giải mã."
    );
  }

  if (vaultStatus === "loading" && initInFlightPromise) {
    try {
      await initInFlightPromise;
    } catch {
      if ((vaultStatus as GeminiVaultInitStatus) === "error" && !options?.forceRecoverFromVaultError) {
        throw new Error(
          vaultErrorMessage ||
            "Không thể ghi đè kho khóa Gemini vì kho khóa hiện tại đang gặp lỗi đọc/giải mã."
        );
      }
    }
  }

  const { entries, duplicateIndices } = normalizeGeminiKeyEntries(rawInputs);
  if (duplicateIndices.length > 0) {
    throw new Error("Không chấp nhận API Key trùng nhau trong danh sách Gemini.");
  }

  const myRevision = ++latestRequestedRevision;
  pendingStagedInputs = entries.map((e) => ({ ...e }));
  pendingStagedRevision = myRevision;

  let writeError: unknown = null;

  writeQueueChain = writeQueueChain.then(async () => {
    // If a newer revision was already staged after `myRevision`, we skip redundant intermediate disk I/O
    // and let the latest revision in the queue write the authoritative state.
    if (myRevision < pendingStagedRevision) {
      return;
    }

    const snapshotToWrite = (pendingStagedInputs || entries).map((e) => ({ ...e }));
    const { entries: normalizedSnapshot } = normalizeGeminiKeyEntries(snapshotToWrite);
    const vault = getActiveVaultBackend();

    try {
      await writeAndVerifyVaultEntries(vault, normalizedSnapshot, myRevision);

      // Only update authoritative in-memory cache if this revision is >= committedRevision
      if (myRevision >= committedRevision) {
        cachedStoredKeys = normalizedSnapshot;
        committedRevision = myRevision;
        vaultStatus = "ready";
        vaultErrorMessage = null;
      }

      scrubLegacyPlaintextGeminiKeyFromLocalStorage();

      if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
        try {
          window.dispatchEvent(new CustomEvent("voxlab_gemini_keys_updated"));
        } catch {
          // ignore in headless test environments
        }
      }
    } catch (err) {
      writeError = err;
    }
  });

  await writeQueueChain;

  if (writeError) {
    const known = entries.map((e) => e.apiKey);
    const msg = redactGeminiKeysFromText(
      (writeError as any)?.message || String(writeError),
      known
    );
    throw new Error(msg);
  }

  return (cachedStoredKeys || entries).map((e) => ({ ...e }));
}

/**
 * Schedules a debounced save of Gemini key entries (e.g. while the user is typing in Settings).
 * Returns a promise that resolves when the debounced write actually completes in the vault.
 */
export function scheduleDebouncedGeminiKeySave(
  rawInputs: Array<{
    id?: string;
    role?: GeminiKeyRole;
    label?: string;
    apiKey: string;
    createdAt?: number;
  }>,
  debounceMs = 350
): Promise<GeminiStoredKeyEntry[]> {
  if (vaultStatus === "error") {
    return Promise.reject(
      new Error(
        vaultErrorMessage ||
          "Không thể ghi đè kho khóa Gemini vì kho khóa hiện tại đang gặp lỗi đọc/giải mã."
      )
    );
  }

  const { entries, duplicateIndices } = normalizeGeminiKeyEntries(rawInputs);
  if (duplicateIndices.length > 0) {
    return Promise.reject(
      new Error("Không chấp nhận API Key trùng nhau trong danh sách Gemini.")
    );
  }

  pendingStagedInputs = entries.map((e) => ({ ...e }));

  return new Promise<GeminiStoredKeyEntry[]>((resolve, reject) => {
    debounceResolvers.push({ resolve, reject });

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const toCommit = pendingStagedInputs;
      const resolvers = [...debounceResolvers];
      debounceResolvers = [];

      if (!toCommit) {
        const current = getGeminiKeyEntriesSync();
        resolvers.forEach((r) => r.resolve(current));
        return;
      }

      saveGeminiKeyEntries(toCommit)
        .then((saved) => {
          resolvers.forEach((r) => r.resolve(saved));
        })
        .catch((err) => {
          resolvers.forEach((r) => r.reject(err));
        });
    }, debounceMs);
  });
}

/**
 * Immediately flushes any pending debounced key changes and awaits the serialized write queue.
 */
export async function flushPendingGeminiKeyWrites(): Promise<GeminiStoredKeyEntry[]> {
  if (debounceTimer && pendingStagedInputs) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
    const toCommit = pendingStagedInputs;
    const resolvers = [...debounceResolvers];
    debounceResolvers = [];
    try {
      const saved = await saveGeminiKeyEntries(toCommit);
      resolvers.forEach((r) => r.resolve(saved));
      return saved;
    } catch (err) {
      resolvers.forEach((r) => r.reject(err));
      throw err;
    }
  }

  await writeQueueChain;
  return getGeminiKeyEntriesSync();
}

/**
 * Test helper: allows injecting a custom or simulated vault backend and resetting cache.
 */
export function configureGeminiKeyStoreForTest(options?: {
  vaultBackend?: GeminiSecureVaultBackend | null;
  resetMemory?: boolean;
}): IsolatedMemoryVaultBackend {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  debounceResolvers = [];
  if (options?.vaultBackend !== undefined) {
    customVaultOverride = options.vaultBackend;
  }
  if (options?.resetMemory) {
    cachedStoredKeys = null;
    vaultStatus = "idle";
    vaultErrorMessage = null;
    initInFlightPromise = null;
    latestRequestedRevision = 0;
    committedRevision = 0;
    pendingStagedInputs = null;
    pendingStagedRevision = 0;
    writeQueueChain = Promise.resolve();
    defaultMemoryVault.reset();
  }
  return defaultMemoryVault;
}
