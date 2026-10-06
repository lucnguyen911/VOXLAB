/**
 * License Service (Frontend Tauri IPC Client)
 *
 * Enforces LICENSE-AC-01 through LICENSE-AC-14:
 * - Communicates with native Rust security subsystem via Tauri IPC.
 * - Never persists raw license keys in localStorage, sessionStorage, or state.
 * - Only handles sanitized LicenseSummary containing masked keys.
 * - Sanitizes all diagnostic logs to ensure zero secret leakage.
 */

export type LicenseStatus =
  | 'VALID'
  | 'ACTIVATED'
  | 'EXPIRED'
  | 'DISABLED'
  | 'NOT_FOUND'
  | 'DEVICE_MISMATCH'
  | 'DEVICE_LIMIT'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR'
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

// In-memory mock state for web development and automated testing environments
let mockSummary: LicenseSummary = {
  is_valid: false,
  status: 'NO_KEY',
  masked_key: 'Chưa kích hoạt',
  license_type: 'Chưa kích hoạt',
  expires_at_formatted: 'N/A',
  error_message: 'Ứng dụng chưa được kích hoạt bản quyền.',
  can_use_app: false,
};

function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
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
  const prefix = trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  return `${prefix}-****-****-${suffix}`;
}

/**
 * Sanitizes diagnostic logs to ensure zero license key leakage (LICENSE-AC-02, LICENSE-AC-11).
 * Replaces any license key pattern with [MASKED_LICENSE_KEY].
 */
export function sanitizeDiagnostics(log: string): string {
  return log.replace(/[A-Z0-9]{3,5}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}(?:-[A-Z0-9]{4})?/gi, '[MASKED_LICENSE_KEY]');
}

export class LicenseService {
  /**
   * Retrieves the current license summary from native Rust DPAPI cache.
   */
  static async getSummary(): Promise<LicenseSummary> {
    try {
      if (isTauriEnvironment()) {
        return await invokeTauri<LicenseSummary>('get_license_summary');
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

      // Mock handling for non-tauri / test environments
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
          license_type: 'Commercial Pro License',
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
      error_message: 'Ứng dụng chưa được kích hoạt bản quyền.',
      can_use_app: false,
    };
  }

  /**
   * Testing helper to reset mock memory state
   */
  static _setMockSummaryForTest(summary: Partial<LicenseSummary>): void {
    mockSummary = { ...mockSummary, ...summary };
  }
}
