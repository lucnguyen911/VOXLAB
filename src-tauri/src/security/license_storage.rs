use serde::{Deserialize, Serialize};
use std::path::Path;

pub const LICENSE_CACHE_FILE: &str = "license.enc";
pub const LICENSE_SCHEMA_VERSION: u32 = 3;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LicenseCacheData {
    pub schema_version: u32,
    pub license_key: String,
    pub license_key_masked: String,
    pub license_type: String,
    pub hwid_version: String,
    pub hwid: String,
    pub status: String,
    pub saved_at: u64,
    #[serde(default)]
    pub last_seen_at: u64,
    pub last_verified_at: u64,
    pub expires_at: Option<u64>,
    pub last_server_status: Option<String>,
}

/// Masks a license key for display e.g. VOXLAB-****-****-462B or VOXL-****-****-1234
pub fn mask_license_key(key: &str) -> String {
    let trimmed = key.trim();
    if trimmed.len() <= 8 {
        return "VOXLAB-****-****-KEY".to_string();
    }
    let prefix = if let Some((head, _)) = trimmed.split_once('-') {
        if (2..=6).contains(&head.len()) {
            head
        } else {
            &trimmed[..4]
        }
    } else {
        &trimmed[..4]
    };
    let suffix = &trimmed[trimmed.len() - 4..];
    format!("{}-****-****-{}", prefix, suffix)
}

#[cfg(target_os = "windows")]
mod dpapi {
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB,
    };

    const DPAPI_ENTROPY: &[u8] = b"VoxLab-License-v3";
    // CRYPTPROTECT_UI_FORBIDDEN = 0x1
    const DPAPI_FLAGS: u32 = 0x1;

    pub fn encrypt_bytes(data: &[u8]) -> Result<Vec<u8>, String> {
        let mut data_in = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut entropy_blob = CRYPT_INTEGER_BLOB {
            cbData: DPAPI_ENTROPY.len() as u32,
            pbData: DPAPI_ENTROPY.as_ptr() as *mut u8,
        };
        let mut data_out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: null_mut(),
        };

        unsafe {
            let success = CryptProtectData(
                &mut data_in,
                null_mut(),
                &mut entropy_blob,
                null_mut(),
                null_mut(),
                DPAPI_FLAGS,
                &mut data_out,
            );

            if success == 0 {
                return Err("CryptProtectData failed".to_string());
            }

            let slice = std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize);
            let result = slice.to_vec();
            LocalFree(data_out.pbData as _);
            Ok(result)
        }
    }

    unsafe fn try_unprotect(
        encrypted: &[u8],
        entropy: Option<&[u8]>,
    ) -> Result<Vec<u8>, String> {
        let mut data_in = CRYPT_INTEGER_BLOB {
            cbData: encrypted.len() as u32,
            pbData: encrypted.as_ptr() as *mut u8,
        };
        let mut entropy_blob = entropy.map(|e| CRYPT_INTEGER_BLOB {
            cbData: e.len() as u32,
            pbData: e.as_ptr() as *mut u8,
        });
        let entropy_ptr = match entropy_blob.as_mut() {
            Some(b) => b as *mut CRYPT_INTEGER_BLOB,
            None => null_mut(),
        };
        let mut data_out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: null_mut(),
        };

        let success = CryptUnprotectData(
            &mut data_in,
            null_mut(),
            entropy_ptr,
            null_mut(),
            null_mut(),
            DPAPI_FLAGS,
            &mut data_out,
        );

        if success == 0 {
            return Err("CryptUnprotectData failed".to_string());
        }

        let slice = std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize);
        let result = slice.to_vec();
        LocalFree(data_out.pbData as _);
        Ok(result)
    }

    pub fn decrypt_bytes(encrypted: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            // Try v3 entropy first; fall back to legacy null-entropy so existing vaults
            // (such as previously saved gemini_keys.enc or v1 license.enc) remain readable.
            if let Ok(plain) = try_unprotect(encrypted, Some(DPAPI_ENTROPY)) {
                return Ok(plain);
            }
            try_unprotect(encrypted, None)
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod dpapi {
    pub fn encrypt_bytes(data: &[u8]) -> Result<Vec<u8>, String> {
        Ok(data.iter().map(|b| b ^ 0x5A).collect())
    }

    pub fn decrypt_bytes(encrypted: &[u8]) -> Result<Vec<u8>, String> {
        Ok(encrypted.iter().map(|b| b ^ 0x5A).collect())
    }
}

/// Encrypts bytes using Windows DPAPI + application entropy.
pub fn encrypt_data(bytes: &[u8]) -> Result<Vec<u8>, String> {
    dpapi::encrypt_bytes(bytes)
}

/// Decrypts bytes using Windows DPAPI (with transparent v1 -> v3 entropy fallback).
pub fn decrypt_data(encrypted: &[u8]) -> Result<Vec<u8>, String> {
    dpapi::decrypt_bytes(encrypted)
}

/// Saves license cache data atomically using DPAPI encryption (LICENSE-AC-02, LICENSE-AC-03).
/// Uses `crate::fsio::atomic_write` (`MoveFileExW` with `MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH`)
/// so the existing `license.enc` is NEVER deleted before the replacement file is safely flushed.
pub fn save_license_cache(base_dir: &Path, data: &LicenseCacheData) -> Result<(), String> {
    std::fs::create_dir_all(base_dir).map_err(|e| e.to_string())?;

    let json_bytes = serde_json::to_vec(data).map_err(|e| e.to_string())?;
    let encrypted_bytes = encrypt_data(&json_bytes)?;

    let target_path = base_dir.join(LICENSE_CACHE_FILE);
    crate::fsio::atomic_write(&target_path, &encrypted_bytes)
}

/// Loads and decrypts license cache data from disk.
pub fn load_license_cache(base_dir: &Path) -> Result<Option<LicenseCacheData>, String> {
    let target_path = base_dir.join(LICENSE_CACHE_FILE);
    if !target_path.exists() {
        return Ok(None);
    }

    let encrypted_bytes = std::fs::read(&target_path).map_err(|e| e.to_string())?;
    if encrypted_bytes.is_empty() {
        return Err("Empty license cache file".to_string());
    }
    let decrypted_bytes = decrypt_data(&encrypted_bytes)?;

    let data: LicenseCacheData =
        serde_json::from_slice(&decrypted_bytes).map_err(|e| e.to_string())?;
    Ok(Some(data))
}

pub const GEMINI_KEYS_VAULT_FILE: &str = "gemini_keys.enc";

/// Saves an encrypted UTF-8 JSON payload atomically using Windows DPAPI.
/// Never deletes the existing vault file before the new temp file is flushed and renamed.
pub fn save_encrypted_secret_file(
    base_dir: &Path,
    filename: &str,
    payload_utf8: &str,
) -> Result<(), String> {
    std::fs::create_dir_all(base_dir).map_err(|e| e.to_string())?;
    let encrypted_bytes = encrypt_data(payload_utf8.as_bytes())?;
    let target_path = base_dir.join(filename);
    crate::fsio::atomic_write(&target_path, &encrypted_bytes)
}

/// Loads and decrypts an encrypted UTF-8 JSON payload using Windows DPAPI.
pub fn load_encrypted_secret_file(
    base_dir: &Path,
    filename: &str,
) -> Result<Option<String>, String> {
    let target_path = base_dir.join(filename);
    if !target_path.exists() {
        return Ok(None);
    }
    let encrypted_bytes = std::fs::read(&target_path).map_err(|e| e.to_string())?;
    let decrypted_bytes = decrypt_data(&encrypted_bytes)?;
    String::from_utf8(decrypted_bytes)
        .map(Some)
        .map_err(|e| e.to_string())
}

/// Removes license cache if allowed
pub fn clear_license_cache(base_dir: &Path) -> Result<(), String> {
    let target_path = base_dir.join(LICENSE_CACHE_FILE);
    if target_path.exists() {
        std::fs::remove_file(&target_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mask_license_key() {
        assert_eq!(
            mask_license_key("VOXLAB-8DEE-C4E6-24D5-462B"),
            "VOXLAB-****-****-462B"
        );
        assert_eq!(
            mask_license_key("VOXL-ABCD-1234-WXYZ"),
            "VOXL-****-****-WXYZ"
        );
        assert_eq!(mask_license_key("SHORT"), "VOXLAB-****-****-KEY");
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let original = b"Sensitive License Payload 12345";
        let encrypted = encrypt_data(original).expect("encryption failed");
        assert_ne!(original, encrypted.as_slice());

        let decrypted = decrypt_data(&encrypted).expect("decryption failed");
        assert_eq!(original.to_vec(), decrypted);
    }

    #[test]
    fn test_save_and_load_license_cache() {
        let temp_dir = std::env::temp_dir().join(format!(
            "voxlab_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let cache_data = LicenseCacheData {
            schema_version: LICENSE_SCHEMA_VERSION,
            license_key: "VOXLAB-8DEE-C4E6-24D5-462B".to_string(),
            license_key_masked: "VOXLAB-****-****-462B".to_string(),
            license_type: "Commercial Lifetime".to_string(),
            hwid_version: "v3".to_string(),
            hwid: "a".repeat(64),
            status: "VALID".to_string(),
            saved_at: 1000,
            last_seen_at: 1000,
            last_verified_at: 1000,
            expires_at: Some(2000),
            last_server_status: Some("ACTIVATED".to_string()),
        };

        save_license_cache(&temp_dir, &cache_data).expect("save failed");
        let loaded = load_license_cache(&temp_dir)
            .expect("load failed")
            .expect("missing cache");
        assert_eq!(cache_data, loaded);

        clear_license_cache(&temp_dir).expect("clear failed");
        assert!(load_license_cache(&temp_dir)
            .expect("load after clear")
            .is_none());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
