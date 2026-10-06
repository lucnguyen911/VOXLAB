export interface LicenseData {
  key: string;
  maskedKey: string;
  expiry: string;
  status: "active" | "expired" | "not_activated";
  type: string;
  activatedAt?: string;
}

const LICENSE_STORAGE_KEY = "voxlab_license_v1";

export function loadLicense(): LicenseData | null {
  try {
    const raw = localStorage.getItem(LICENSE_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveLicense(license: LicenseData): void {
  try {
    localStorage.setItem(LICENSE_STORAGE_KEY, JSON.stringify(license));
  } catch {}
}

export function removeLicense(): void {
  try {
    localStorage.removeItem(LICENSE_STORAGE_KEY);
  } catch {}
}

export function validateLicenseKey(rawKey: string): { success: boolean; license?: LicenseData; error?: string } {
  const trimmed = rawKey.trim();
  if (!trimmed) {
    return { success: false, error: "Vui lòng nhập mã Key bản quyền." };
  }
  const upper = trimmed.toUpperCase();

  if (upper.includes("EXPIRED") || upper.startsWith("EXP")) {
    const masked = trimmed.length >= 8 
      ? `${trimmed.slice(0, 4).toUpperCase()}-****-****-${trimmed.slice(-4).toUpperCase()}`
      : "VOX-****-****-EXP1";
    return {
      success: false,
      error: "Mã License Key đã hết hạn sử dụng vào ngày 01/09/2026.",
      license: {
        key: trimmed,
        maskedKey: masked,
        expiry: "01/09/2026",
        status: "expired",
        type: "Personal License",
      },
    };
  }

  if (upper.length < 8 || upper.includes("INVALID")) {
    return {
      success: false,
      error: "Mã License Key không hợp lệ hoặc không có trong hệ thống.",
    };
  }

  const isLifetime = upper.includes("LIFETIME") || upper.startsWith("LIFE");
  const expiry = isLifetime ? "Vĩnh viễn" : "05/10/2027";
  const maskedKey = `${trimmed.slice(0, 4).toUpperCase()}-****-****-${trimmed.slice(-4).toUpperCase()}`;
  
  const license: LicenseData = {
    key: trimmed,
    maskedKey,
    expiry,
    status: "active",
    type: isLifetime ? "Commercial License" : "Personal License",
    activatedAt: new Date().toISOString(),
  };

  saveLicense(license);
  return { success: true, license };
}
