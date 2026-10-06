use serde::{Deserialize, Serialize};
use std::path::Path;

pub const LICENSE_CACHE_FILE: &str = "license.enc";
pub const LICENSE_SCHEMA_VERSION: u32 = 1;

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
    pub last_verified_at: u64,
    pub expires_at: Option<u64>,
    pub last_server_status: Option<String>,
}

/// Masks a license key for display e.g. VOXL-****-****-1234
pub fn mask_license_key(key: &str) -> String {
    let trimmed = key.trim();
    if trimmed.len() <= 8 {
        return "VOXL-****-****-KEY".to_string();
    }
    let prefix = &trimmed[..4];
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

    pub fn encrypt_bytes(data: &[u8]) -> Result<Vec<u8>, String> {
        let mut data_in = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut data_out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: null_mut(),
        };

        unsafe {
            // CRYPTPROTECT_UI_FORBIDDEN = 0x1
            let success = CryptProtectData(
                &mut data_in,
                null_mut(),
                null_mut(),
                null_mut(),
                null_mut(),
                0x1,
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

    pub fn decrypt_bytes(encrypted: &[u8]) -> Result<Vec<u8>, String> {
        let mut data_in = CRYPT_INTEGER_BLOB {
            cbData: encrypted.len() as u32,
            pbData: encrypted.as_ptr() as *mut u8,
        };
        let mut data_out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: null_mut(),
        };

        unsafe {
            let success = CryptUnprotectData(
                &mut data_in,
                null_mut(),
                null_mut(),
                null_mut(),
                null_mut(),
                0x1,
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
    }
}

#[cfg(not(target_os = "windows"))]
mod dpapi {
    pub fn encrypt_bytes(data: &[u8]) -> Result<Vec<u8>, String> {
        // Fallback for non-windows / tests
        Ok(data.iter().map(|b| b ^ 0x5A).collect())
    }

    pub fn decrypt_bytes(encrypted: &[u8]) -> Result<Vec<u8>, String> {
        Ok(encrypted.iter().map(|b| b ^ 0x5A).collect())
    }
}

/// Encrypts bytes using Windows DPAPI
pub fn encrypt_data(bytes: &[u8]) -> Result<Vec<u8>, String> {
    dpapi::encrypt_bytes(bytes)
}

/// Decrypts bytes using Windows DPAPI
pub fn decrypt_data(encrypted: &[u8]) -> Result<Vec<u8>, String> {
    dpapi::decrypt_bytes(encrypted)
}

/// Saves license cache data atomically using DPAPI encryption (LICENSE-AC-02, LICENSE-AC-03).
pub fn save_license_cache(base_dir: &Path, data: &LicenseCacheData) -> Result<(), String> {
    std::fs::create_dir_all(base_dir).map_err(|e| e.to_string())?;

    let json_bytes = serde_json::to_vec(data).map_err(|e| e.to_string())?;
    let encrypted_bytes = encrypt_data(&json_bytes)?;

    let target_path = base_dir.join(LICENSE_CACHE_FILE);
    let tmp_path = base_dir.join("license.tmp");

    // Atomic write pattern
    std::fs::write(&tmp_path, &encrypted_bytes).map_err(|e| e.to_string())?;

    if target_path.exists() {
        let _ = std::fs::remove_file(&target_path);
    }

    std::fs::rename(&tmp_path, &target_path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Loads and decrypts license cache data from disk.
pub fn load_license_cache(base_dir: &Path) -> Result<Option<LicenseCacheData>, String> {
    let target_path = base_dir.join(LICENSE_CACHE_FILE);
    if !target_path.exists() {
        return Ok(None);
    }

    let encrypted_bytes = std::fs::read(&target_path).map_err(|e| e.to_string())?;
    let decrypted_bytes = decrypt_data(&encrypted_bytes)?;

    let data: LicenseCacheData = serde_json::from_slice(&decrypted_bytes).map_err(|e| e.to_string())?;
    Ok(Some(data))
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
            mask_license_key("VOXL-ABCD-1234-WXYZ"),
            "VOXL-****-****-WXYZ"
        );
        assert_eq!(mask_license_key("SHORT"), "VOXL-****-****-KEY");
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
        let temp_dir = std::env::temp_dir().join(format!("voxlab_test_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let cache_data = LicenseCacheData {
            schema_version: 1,
            license_key: "VOXL-PRO-2026-KEY1".to_string(),
            license_key_masked: "VOXL-****-****-KEY1".to_string(),
            license_type: "Commercial License".to_string(),
            hwid_version: "v1".to_string(),
            hwid: "v1:abc123456789".to_string(),
            status: "VALID".to_string(),
            saved_at: 1000,
            last_verified_at: 1000,
            expires_at: Some(2000),
            last_server_status: Some("ACTIVATED".to_string()),
        };

        save_license_cache(&temp_dir, &cache_data).expect("save failed");
        let loaded = load_license_cache(&temp_dir).expect("load failed").expect("missing cache");
        assert_eq!(cache_data, loaded);

        clear_license_cache(&temp_dir).expect("clear failed");
        assert!(load_license_cache(&temp_dir).expect("load after clear").is_none());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
