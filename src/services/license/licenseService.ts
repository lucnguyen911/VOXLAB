/**
 * License Service (Frontend Tauri IPC Client — Security v3)
 *
 * Enforces LICENSE-AC-01 through LICENSE-AC-14:
 * - Communicates with native Rust security subsystem via Tauri IPC.
 * - Never persists raw license keys in localStorage, sessionStorage, or state.
 * - Only handles sanitized LicenseSummary containing masked keys.
 * - Sanitizes all diagnostic logs to ensure zero secret leakage.
 * - Isolates test/dev mock fallback from production builds so missing Tauri IPC never fakes activation.
 */

export type LicenseStatus =
  | 'VALID'
  | 'ACTIVATED'
  | 'MIGRATED'
  | 'EXPIRED'
  | 'DISABLED'
  | 'NOT_FOUND'
  | 'DEVICE_MISMATCH'
  | 'DEVICE_LIMIT'
  | 'DEVICE_ID_UNAVAILABLE'
  | 'CLOCK_ROLLBACK'
  | 'OFFLINE_GRACE_EXPIRED'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR'
  | 'AUTH_ERROR'
  | 'CLIENT_CONFIG_ERROR'
  | 'NO_KEY'
  | 'OFFLINE_GRACE'
  | 'CORRUPT_CACHE';

export interface LicenseSummary {
  is_valid: boolean;
  status: LicenseStatus | string;
  masked_key: string;
  license_type: string;
  expires_at_formatted: string;
  error_message?: string | null;
  can_use_app: boolean;
}

// In-memory mock state strictly for automated Node tests and non-Tauri Vite browser preview
let mockSummary: LicenseSummary = {
  is_valid: false,
  status: 'NO_KEY',
  masked_key: 'Chưa kích hoạt',
  license_type: 'Chưa kích hoạt',
  expires_at_formatted: 'N/A',
  error_message: 'Vui lòng nhập License Key để kích hoạt phần mềm.',
  can_use_app: false,
};

let forceProductionModeForTest = false;

export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function isProductionBuild(): boolean {
  if (forceProductionModeForTest) return true;
  try {
    const metaEnv = (import.meta as unknown as { env?: { PROD?: boolean } })?.env;
    if (metaEnv && metaEnv.PROD === true) {
      return true;
    }
  } catch {
    // ignore in Node test runner
  }
  return false;
}

function isMockFallbackAllowed(): boolean {
  return !isTauriEnvironment() && !isProductionBuild();
}

function missingNativeRuntimeSummary(): LicenseSummary {
  return {
    is_valid: false,
    status: 'SERVER_ERROR',
    masked_key: 'Chưa kích hoạt',
    license_type: 'N/A',
    expires_at_formatted: 'N/A',
    error_message:
      'Môi trường bảo mật gốc (Tauri DPAPI) không khả dụng. Bản thương mại không cho phép kích hoạt giả lập.',
    can_use_app: false,
  };
}

async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(cmd, args);
  }
  throw new Error('Tauri environment not available');
}

/**
 * Mask raw license key for safe display (helper utility)
 */
export function maskLicenseKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) {
    return 'VOXL-****-****-KEY';
  }
  const prefix = trimmed.toUpperCase().startsWith('VOXLAB-')
    ? trimmed.slice(0, 6)
    : trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  return `${prefix}-****-****-${suffix}`;
}

/**
 * Sanitizes diagnostic logs to ensure zero license key leakage (LICENSE-AC-02, LICENSE-AC-12).
 * Replaces any license key pattern with [MASKED_LICENSE_KEY].
 */
export function sanitizeDiagnostics(log: string): string {
  return log.replace(
    /[A-Z0-9]{2,8}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}(?:-[A-Z0-9]{4})?/gi,
    '[MASKED_LICENSE_KEY]'
  );
}

export class LicenseService {
  /**
   * Returns whether mandatory startup & commercial task gating is enabled.
   * Enabled by default (Gate E approved); only disabled when explicitly set to `0` / `false`.
   */
  static isCommercialGateEnabled(): boolean {
    try {
      const metaEnv = (
        import.meta as unknown as { env?: Record<string, string | boolean | undefined> }
      )?.env;
      if (metaEnv && metaEnv.VITE_VOXLAB_ENFORCE_LICENSE !== undefined) {
        const envVal = String(metaEnv.VITE_VOXLAB_ENFORCE_LICENSE).trim().toLowerCase();
        if (envVal === '0' || envVal === 'false' || envVal === 'off') {
          return false;
        }
        if (envVal === '1' || envVal === 'true' || envVal === 'strict') {
          return true;
        }
      }
    } catch {
      // ignore
    }
    try {
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('voxlab_enforce_license_policy');
        if (stored === '0' || stored === 'false') {
          return false;
        }
        if (stored === '1' || stored === 'true') {
          return true;
        }
      }
    } catch {
      // ignore
    }
    return true;
  }

  /**
   * Retrieves the current license summary from native Rust DPAPI cache.
   */
  static async getSummary(): Promise<LicenseSummary> {
    try {
      if (isTauriEnvironment()) {
        return await invokeTauri<LicenseSummary>('get_license_summary');
      }
      if (!isMockFallbackAllowed()) {
        return missingNativeRuntimeSummary();
      }
      return { ...mockSummary };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        is_valid: false,
        status: 'CORRUPT_CACHE',
        masked_key: 'Lỗi',
        license_type: 'N/A',
        expires_at_formatted: 'N/A',
        error_message: msg,
        can_use_app: false,
      };
    }
  }

  /**
   * Activates a license key with native Rust security subsystem.
   * Raw key is passed immediately to IPC and discarded.
   */
  static async activate(rawKey: string): Promise<LicenseSummary> {
    const trimmed = rawKey.trim();
    if (!trimmed) {
      return {
        is_valid: false,
        status: 'NO_KEY',
        masked_key: 'Chưa kích hoạt',
        license_type: 'N/A',
        expires_at_formatted: 'N/A',
        error_message: 'Vui lòng cung cấp mã License Key.',
        can_use_app: false,
      };
    }

    try {
      if (isTauriEnvironment()) {
        return await invokeTauri<LicenseSummary>('activate_license', {
          licenseKey: trimmed,
        });
      }

      if (!isMockFallbackAllowed()) {
        return missingNativeRuntimeSummary();
      }

      // Mock handling strictly for non-production Node test environments
      if (trimmed.toUpperCase().includes('INVALID') || trimmed.toUpperCase().includes('EXPIRED')) {
        mockSummary = {
          is_valid: false,
          status: 'EXPIRED',
          masked_key: maskLicenseKey(trimmed),
          license_type: 'N/A',
          expires_at_formatted: 'Hết hạn',
          error_message: 'Mã bản quyền đã hết hạn.',
          can_use_app: false,
        };
      } else if (trimmed.toUpperCase().includes('DISABLED')) {
        mockSummary = {
          is_valid: false,
          status: 'DISABLED',
          masked_key: maskLicenseKey(trimmed),
          license_type: 'N/A',
          expires_at_formatted: 'N/A',
          error_message: 'Mã bản quyền đã bị vô hiệu hóa.',
          can_use_app: false,
        };
      } else if (trimmed.toUpperCase().includes('LIMIT')) {
        mockSummary = {
          is_valid: false,
          status: 'DEVICE_LIMIT',
          masked_key: maskLicenseKey(trimmed),
          license_type: 'N/A',
          expires_at_formatted: 'N/A',
          error_message: 'Mã bản quyền đã vượt quá giới hạn thiết bị cho phép.',
          can_use_app: false,
        };
      } else if (trimmed.toUpperCase().includes('MISMATCH')) {
        mockSummary = {
          is_valid: false,
          status: 'DEVICE_MISMATCH',
          masked_key: maskLicenseKey(trimmed),
          license_type: 'N/A',
          expires_at_formatted: 'N/A',
          error_message: 'Mã bản quyền đã liên kết với thiết bị khác.',
          can_use_app: false,
        };
      } else {
        mockSummary = {
          is_valid: true,
          status: 'ACTIVATED',
          masked_key: maskLicenseKey(trimmed),
          license_type: 'Commercial Lifetime',
          expires_at_formatted: 'Vĩnh viễn',
          error_message: null,
          can_use_app: true,
        };
      }
      return { ...mockSummary };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        is_valid: false,
        status: 'SERVER_ERROR',
        masked_key: maskLicenseKey(trimmed),
        license_type: 'N/A',
        expires_at_formatted: 'N/A',
        error_message: msg,
        can_use_app: false,
      };
    }
  }

  /**
   * Silently verifies the existing cached license online (e.g. on app startup).
   */
  static async verify(): Promise<LicenseSummary> {
    try {
      if (isTauriEnvironment()) {
        return await invokeTauri<LicenseSummary>('verify_license');
      }
      if (!isMockFallbackAllowed()) {
        return missingNativeRuntimeSummary();
      }
      return { ...mockSummary };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        is_valid: false,
        status: 'NETWORK_ERROR',
        masked_key: mockSummary.masked_key,
        license_type: mockSummary.license_type,
        expires_at_formatted: mockSummary.expires_at_formatted,
        error_message: msg,
        can_use_app: false,
      };
    }
  }

  /**
   * Replaces an existing license key with a new key.
   */
  static async changeKey(newKey: string): Promise<LicenseSummary> {
    const trimmed = newKey.trim();
    if (!trimmed) {
      return {
        is_valid: false,
        status: 'NO_KEY',
        masked_key: mockSummary.masked_key,
        license_type: mockSummary.license_type,
        expires_at_formatted: mockSummary.expires_at_formatted,
        error_message: 'Vui lòng cung cấp mã License Key mới.',
        can_use_app: mockSummary.can_use_app,
      };
    }

    try {
      if (isTauriEnvironment()) {
        return await invokeTauri<LicenseSummary>('change_license_key', {
          newLicenseKey: trimmed,
        });
      }
      if (!isMockFallbackAllowed()) {
        return missingNativeRuntimeSummary();
      }
      return await this.activate(trimmed);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        is_valid: false,
        status: 'SERVER_ERROR',
        masked_key: maskLicenseKey(trimmed),
        license_type: 'N/A',
        expires_at_formatted: 'N/A',
        error_message: msg,
        can_use_app: false,
      };
    }
  }

  /**
   * Clears local DPAPI cached license file.
   */
  static async clearLocalLicense(): Promise<void> {
    if (isTauriEnvironment()) {
      await invokeTauri<void>('clear_local_license_if_allowed');
    }
    mockSummary = {
      is_valid: false,
      status: 'NO_KEY',
      masked_key: 'Chưa kích hoạt',
      license_type: 'Chưa kích hoạt',
      expires_at_formatted: 'N/A',
      error_message: 'Vui lòng nhập License Key để kích hoạt phần mềm.',
      can_use_app: false,
    };
  }

  /**
   * Cleanly exits the desktop application when the user clicks Exit on the mandatory License Gate.
   */
  static async exitApplication(): Promise<void> {
    if (isTauriEnvironment()) {
      await invokeTauri<void>('exit_application');
      return;
    }
    if (typeof window !== 'undefined') {
      window.close();
    }
  }

  /**
   * Testing helper to reset mock memory state
   */
  static _setMockSummaryForTest(summary: Partial<LicenseSummary>): void {
    mockSummary = { ...mockSummary, ...summary };
  }

  /**
   * Testing helper to simulate production build behavior (blocking mock activation when Tauri IPC is absent).
   */
  static _setForceProductionModeForTest(enabled: boolean): void {
    forceProductionModeForTest = enabled;
  }
}
