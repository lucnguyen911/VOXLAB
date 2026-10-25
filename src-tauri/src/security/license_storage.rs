use serde::{Deserialize, Serialize};
use std::path::Path;

pub const LICENSE_CACHE_FILE: &str = "license.enc";
pub const GEMINI_KEYS_VAULT_FILE: &str = "gemini_keys.enc";
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
    #[serde(default)]
    pub integrity_tag: Option<String>,
}

/// Computes an authenticated HMAC-SHA256 integrity seal over every security-relevant field
/// of `LicenseCacheData` so DPAPI payload modification or replay is deterministically rejected.
pub fn compute_cache_integrity_mac(data: &LicenseCacheData) -> [u8; 32] {
    let canonical = format!(
        "VOXLAB_CACHE_SEAL_V3.1|v={}|key={}|masked={}|type={}|hv={}|hwid={}|st={}|saved={}|seen={}|ver={}|exp={}|srv={}",
        data.schema_version,
        data.license_key,
        data.license_key_masked,
        data.license_type,
        data.hwid_version,
        data.hwid,
        data.status,
        data.saved_at,
        data.last_seen_at,
        data.last_verified_at,
        data.expires_at.map(|v| v.to_string()).unwrap_or_else(|| "NONE".to_string()),
        data.last_server_status.as_deref().unwrap_or("NONE"),
    );
    let subkey = super::crypto_seal::hmac_sha256(
        super::crypto_seal::vault_master_key(),
        b"VOXLAB-CACHE-INTEGRITY-SUBKEY-V3.1",
    );
    super::crypto_seal::hmac_sha256(&subkey, canonical.as_bytes())
}

fn dynamic_dpapi_entropy() -> [u8; 32] {
    super::crypto_seal::hmac_sha256(
        super::crypto_seal::vault_master_key(),
        b"VOXLAB-DPAPI-ENTROPY-V3.1",
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EntropyTier {
    V31Dynamic,
    LegacyFallback,
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
    use super::{dynamic_dpapi_entropy, EntropyTier};
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB,
    };

    // CRYPTPROTECT_UI_FORBIDDEN = 0x1
    const DPAPI_FLAGS: u32 = 0x1;

    pub fn encrypt_bytes(data: &[u8]) -> Result<Vec<u8>, String> {
        let mut entropy = dynamic_dpapi_entropy();
        let mut data_in = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut entropy_blob = CRYPT_INTEGER_BLOB {
            cbData: entropy.len() as u32,
            pbData: entropy.as_mut_ptr(),
        };
        let mut data_out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: null_mut(),
        };

        let res = unsafe {
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
                Err("CryptProtectData failed".to_string())
            } else {
                let slice = std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize);
                let result = slice.to_vec();
                LocalFree(data_out.pbData as _);
                Ok(result)
            }
        };

        for b in &mut entropy {
            unsafe {
                std::ptr::write_volatile(b, 0);
            }
        }
        res
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

    pub fn decrypt_bytes_tiered(encrypted: &[u8]) -> Result<(Vec<u8>, EntropyTier), String> {
        let mut v31_entropy = dynamic_dpapi_entropy();
        let v31_res = unsafe { try_unprotect(encrypted, Some(&v31_entropy)) };
        for b in &mut v31_entropy {
            unsafe {
                std::ptr::write_volatile(b, 0);
            }
        }
        if let Ok(plain) = v31_res {
            return Ok((plain, EntropyTier::V31Dynamic));
        }

        // Backward-compatibility read path for pre-existing vaults (`gemini_keys.enc` or v3.0 `license.enc`)
        let v30_entropy = super::super::obf::decode_legacy_dpapi_entropy();
        if let Ok(plain) = unsafe { try_unprotect(encrypted, Some(v30_entropy.as_bytes())) } {
            return Ok((plain, EntropyTier::LegacyFallback));
        }

        let plain = unsafe { try_unprotect(encrypted, None) }?;
        Ok((plain, EntropyTier::LegacyFallback))
    }
}

#[cfg(not(target_os = "windows"))]
mod dpapi {
    use super::{dynamic_dpapi_entropy, EntropyTier};

    pub fn encrypt_bytes(data: &[u8]) -> Result<Vec<u8>, String> {
        let key = dynamic_dpapi_entropy();
        Ok(data
            .iter()
            .enumerate()
            .map(|(i, b)| b ^ key[i % key.len()])
            .collect())
    }

    pub fn decrypt_bytes_tiered(encrypted: &[u8]) -> Result<(Vec<u8>, EntropyTier), String> {
        let key = dynamic_dpapi_entropy();
        let plain = encrypted
            .iter()
            .enumerate()
            .map(|(i, b)| b ^ key[i % key.len()])
            .collect();
        Ok((plain, EntropyTier::V31Dynamic))
    }
}

/// Encrypts bytes using Windows DPAPI + KDF-derived application entropy.
pub fn encrypt_data(bytes: &[u8]) -> Result<Vec<u8>, String> {
    dpapi::encrypt_bytes(bytes)
}

/// Decrypts bytes using Windows DPAPI (with transparent legacy read fallback).
pub fn decrypt_data(encrypted: &[u8]) -> Result<Vec<u8>, String> {
    dpapi::decrypt_bytes_tiered(encrypted).map(|(plain, _)| plain)
}

/// Saves license cache data atomically using DPAPI encryption + HMAC-SHA256 `integrity_tag`.
pub fn save_license_cache(base_dir: &Path, data: &LicenseCacheData) -> Result<(), String> {
    std::fs::create_dir_all(base_dir).map_err(|e| e.to_string())?;

    let mut sealed = data.clone();
    let mac = compute_cache_integrity_mac(&sealed);
    sealed.integrity_tag = Some(super::crypto_seal::hex_encode(&mac));

    let json_bytes = serde_json::to_vec(&sealed).map_err(|e| e.to_string())?;
    let encrypted_bytes = encrypt_data(&json_bytes)?;

    let target_path = base_dir.join(LICENSE_CACHE_FILE);
    crate::fsio::atomic_write(&target_path, &encrypted_bytes)
}

/// Loads, decrypts, and verifies the cryptographic `integrity_tag` of `license.enc`.
pub fn load_license_cache(base_dir: &Path) -> Result<Option<LicenseCacheData>, String> {
    let target_path = base_dir.join(LICENSE_CACHE_FILE);
    if !target_path.exists() {
        return Ok(None);
    }

    let encrypted_bytes = std::fs::read(&target_path).map_err(|e| e.to_string())?;
    if encrypted_bytes.is_empty() {
        return Err("Empty license cache file".to_string());
    }
    let (mut decrypted_bytes, tier) = dpapi::decrypt_bytes_tiered(&encrypted_bytes)?;

    let parse_res: Result<LicenseCacheData, String> =
        serde_json::from_slice(&decrypted_bytes).map_err(|e| e.to_string());

    // Wipe decrypted raw license JSON buffer immediately
    for b in &mut decrypted_bytes {
        unsafe {
            std::ptr::write_volatile(b, 0);
        }
    }

    let data = parse_res?;
    let expected_mac = compute_cache_integrity_mac(&data);

    match (&data.integrity_tag, tier) {
        (Some(tag), _) => {
            if !super::crypto_seal::verify_hex_mac_ct(tag, &expected_mac) {
                return Err("Phát hiện can thiệp trái phép vào bộ nhớ bản quyền cục bộ.".to_string());
            }
        }
        (None, EntropyTier::V31Dynamic) => {
            return Err("Thiếu chữ ký toàn vẹn bản quyền (V3.1 seal missing).".to_string());
        }
        (None, EntropyTier::LegacyFallback) => {
            // Legacy pre-v3.1 cache: readable for online migration/re-verification, upgraded on next save.
        }
    }

    Ok(Some(data))
}

/// Saves an encrypted UTF-8 JSON payload atomically using Windows DPAPI.
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
    super::crypto_seal::clear_authorized_session();
    let target_path = base_dir.join(LICENSE_CACHE_FILE);
    if target_path.exists() {
        std::fs::remove_file(&target_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Checks whether a filename or path refers to a protected encrypted security vault
/// that must never be directly read, overwritten, or deleted by generic filesystem IPC.
pub fn is_protected_vault_path(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
        return false;
    };
    let lower = name.to_ascii_lowercase();
    const PROTECTED: &[&str] = &[
        "license.enc",
        "device_profile.enc",
        "gemini_keys.enc",
    ];
    for item in PROTECTED {
        if lower == *item || lower.starts_with(&format!(".{}.", item)) {
            return true;
        }
    }
    false
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
    fn test_save_and_load_license_cache_and_reject_dpapi_tampering() {
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
            integrity_tag: None,
        };

        save_license_cache(&temp_dir, &cache_data).expect("save failed");
        let loaded = load_license_cache(&temp_dir)
            .expect("load failed")
            .expect("missing cache");
        assert_eq!(loaded.license_key, cache_data.license_key);
        assert_eq!(loaded.expires_at, Some(2000));
        assert!(loaded.integrity_tag.is_some());

        // Simulate attacker decrypting DPAPI, editing `expires_at` to `None` (Lifetime), and re-encrypting!
        let mut forged = loaded.clone();
        forged.expires_at = None;
        let forged_bytes = encrypt_data(&serde_json::to_vec(&forged).unwrap()).unwrap();
        std::fs::write(temp_dir.join(LICENSE_CACHE_FILE), forged_bytes).unwrap();

        let tampered_load = load_license_cache(&temp_dir);
        assert!(
            tampered_load.is_err(),
            "Tampered DPAPI payload MUST be rejected by HMAC integrity_tag"
        );

        clear_license_cache(&temp_dir).expect("clear failed");
        assert!(load_license_cache(&temp_dir)
            .expect("load after clear")
            .is_none());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_protected_vault_path_detection() {
        assert!(is_protected_vault_path(Path::new("C:\\Users\\u\\AppData\\Roaming\\com.voxlab.app\\license.enc")));
        assert!(is_protected_vault_path(Path::new("GEMINI_KEYS.ENC")));
        assert!(is_protected_vault_path(Path::new("device_profile.enc")));
        assert!(is_protected_vault_path(Path::new(".license.enc.1234.0.tmp")));
        assert!(!is_protected_vault_path(Path::new("history.json")));
        assert!(!is_protected_vault_path(Path::new("batch_queue_v3.json")));
    }
}
