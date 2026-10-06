pub mod device_identity;
pub mod license_client;
pub mod license_storage;

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub const DEFAULT_OFFLINE_GRACE_DAYS: u64 = 7;
pub const APP_VERSION: &str = "0.1.0";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LicenseSummary {
    pub is_valid: bool,
    pub status: String,
    pub masked_key: String,
    pub license_type: String,
    pub expires_at_formatted: String,
    pub error_message: Option<String>,
    pub can_use_app: bool,
}

fn now_epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn format_epoch_date(epoch_secs: Option<u64>) -> String {
    match epoch_secs {
        Some(s) if s > 0 => {
            // Format simple human-readable e.g. timestamp
            format!("Ngày hết hạn: {}", s)
        }
        _ => "Vĩnh viễn".to_string(),
    }
}

pub struct SecurityService;

impl SecurityService {
    /// Evaluates if offline grace applies (LICENSE-AC-08).
    pub fn can_grant_offline_grace(
        cached: &license_storage::LicenseCacheData,
        current_hwid: &str,
        grace_days: u64,
    ) -> bool {
        // HWID must match
        if cached.hwid != current_hwid {
            return false;
        }

        // Cache must have been valid previously
        if cached.status != "VALID" && cached.status != "ACTIVATED" && cached.status != "OFFLINE_GRACE" {
            return false;
        }

        // Must be within grace duration
        let now = now_epoch_secs();
        let grace_duration = grace_days * 86400;
        if now > cached.last_verified_at + grace_duration {
            return false;
        }

        // If license has an explicit expiration, it must not be expired
        if let Some(exp) = cached.expires_at {
            if now > exp {
                return false;
            }
        }

        true
    }

    /// Reads license summary for frontend (LICENSE-AC-09: zero raw keys to frontend).
    pub fn get_summary(base_dir: &Path) -> LicenseSummary {
        match license_storage::load_license_cache(base_dir) {
            Ok(Some(cached)) => {
                let current_hwid = device_identity::generate_hwid();
                let is_valid = cached.status == "VALID"
                    || cached.status == "ACTIVATED"
                    || cached.status == "OFFLINE_GRACE";

                LicenseSummary {
                    is_valid,
                    status: cached.status.clone(),
                    masked_key: cached.license_key_masked.clone(),
                    license_type: cached.license_type.clone(),
                    expires_at_formatted: format_epoch_date(cached.expires_at),
                    error_message: None,
                    can_use_app: is_valid && cached.hwid == current_hwid,
                }
            }
            Ok(None) => LicenseSummary {
                is_valid: false,
                status: "NO_KEY".to_string(),
                masked_key: "Chưa kích hoạt".to_string(),
                license_type: "Chưa kích hoạt".to_string(),
                expires_at_formatted: "N/A".to_string(),
                error_message: Some("Ứng dụng chưa được kích hoạt bản quyền.".to_string()),
                can_use_app: false,
            },
            Err(e) => LicenseSummary {
                is_valid: false,
                status: "CORRUPT_CACHE".to_string(),
                masked_key: "Lỗi bộ nhớ".to_string(),
                license_type: "N/A".to_string(),
                expires_at_formatted: "N/A".to_string(),
                error_message: Some(format!("Không thể giải mã bản quyền: {}", e)),
                can_use_app: false,
            },
        }
    }

    /// Activates a license key with Supabase RPC and saves DPAPI cache.
    pub fn activate(
        base_dir: &Path,
        raw_key: &str,
        app_version: &str,
    ) -> Result<LicenseSummary, String> {
        let trimmed_key = raw_key.trim();
        if trimmed_key.is_empty() {
            return Err("Vui lòng cung cấp mã License Key.".to_string());
        }

        let hwid = device_identity::generate_hwid();
        let masked_key = license_storage::mask_license_key(trimmed_key);

        let rpc_res = license_client::verify_with_server(
            license_client::DEFAULT_SUPABASE_URL,
            license_client::DEFAULT_SUPABASE_ANON_KEY,
            trimmed_key,
            &hwid,
            app_version,
        )?;

        let now = now_epoch_secs();
        let is_success = rpc_res.status == "VALID" || rpc_res.status == "ACTIVATED";

        if is_success {
            let license_type = rpc_res
                .license_type
                .unwrap_or_else(|| "Personal License".to_string());

            let cache = license_storage::LicenseCacheData {
                schema_version: license_storage::LICENSE_SCHEMA_VERSION,
                license_key: trimmed_key.to_string(),
                license_key_masked: masked_key.clone(),
                license_type: license_type.clone(),
                hwid_version: device_identity::HWID_VERSION.to_string(),
                hwid: hwid.clone(),
                status: rpc_res.status.clone(),
                saved_at: now,
                last_verified_at: now,
                expires_at: rpc_res.expires_at,
                last_server_status: Some(rpc_res.status.clone()),
            };

            license_storage::save_license_cache(base_dir, &cache)?;

            Ok(LicenseSummary {
                is_valid: true,
                status: rpc_res.status,
                masked_key,
                license_type,
                expires_at_formatted: format_epoch_date(rpc_res.expires_at),
                error_message: None,
                can_use_app: true,
            })
        } else {
            Ok(LicenseSummary {
                is_valid: false,
                status: rpc_res.status.clone(),
                masked_key,
                license_type: rpc_res.license_type.unwrap_or_else(|| "N/A".to_string()),
                expires_at_formatted: format_epoch_date(rpc_res.expires_at),
                error_message: rpc_res.message,
                can_use_app: false,
            })
        }
    }

    /// Verifies existing cached license online, falling back to offline grace if offline.
    pub fn verify(
        base_dir: &Path,
        app_version: &str,
    ) -> Result<LicenseSummary, String> {
        let cached_opt = license_storage::load_license_cache(base_dir)?;
        let mut cached = match cached_opt {
            Some(c) => c,
            None => return Ok(Self::get_summary(base_dir)),
        };

        let current_hwid = device_identity::generate_hwid();

        // Call Supabase RPC with decrypted key
        let rpc_result = license_client::verify_with_server(
            license_client::DEFAULT_SUPABASE_URL,
            license_client::DEFAULT_SUPABASE_ANON_KEY,
            &cached.license_key,
            &current_hwid,
            app_version,
        );

        match rpc_result {
            Ok(rpc_res) => {
                let now = now_epoch_secs();
                if rpc_res.status == "VALID" || rpc_res.status == "ACTIVATED" {
                    cached.status = rpc_res.status.clone();
                    cached.last_verified_at = now;
                    cached.last_server_status = Some(rpc_res.status.clone());
                    if let Some(exp) = rpc_res.expires_at {
                        cached.expires_at = Some(exp);
                    }
                    license_storage::save_license_cache(base_dir, &cached)?;

                    Ok(LicenseSummary {
                        is_valid: true,
                        status: rpc_res.status,
                        masked_key: cached.license_key_masked,
                        license_type: cached.license_type,
                        expires_at_formatted: format_epoch_date(cached.expires_at),
                        error_message: None,
                        can_use_app: true,
                    })
                } else if rpc_res.status == "NETWORK_ERROR" || rpc_res.status == "SERVER_ERROR" {
                    // Check Offline Grace
                    if Self::can_grant_offline_grace(&cached, &current_hwid, DEFAULT_OFFLINE_GRACE_DAYS) {
                        cached.status = "OFFLINE_GRACE".to_string();
                        let _ = license_storage::save_license_cache(base_dir, &cached);

                        Ok(LicenseSummary {
                            is_valid: true,
                            status: "OFFLINE_GRACE".to_string(),
                            masked_key: cached.license_key_masked,
                            license_type: cached.license_type,
                            expires_at_formatted: format_epoch_date(cached.expires_at),
                            error_message: Some("Đang hoạt động trong thời gian ân hạn ngoại tuyến (Offline Grace).".to_string()),
                            can_use_app: true,
                        })
                    } else {
                        Ok(LicenseSummary {
                            is_valid: false,
                            status: rpc_res.status,
                            masked_key: cached.license_key_masked,
                            license_type: cached.license_type,
                            expires_at_formatted: format_epoch_date(cached.expires_at),
                            error_message: Some("Hết hạn ân hạn ngoại tuyến. Vui lòng kết nối mạng để xác thực lại.".to_string()),
                            can_use_app: false,
                        })
                    }
                } else {
                    // Definite rejection: EXPIRED, DISABLED, DEVICE_MISMATCH, etc.
                    cached.status = rpc_res.status.clone();
                    cached.last_server_status = Some(rpc_res.status.clone());
                    let _ = license_storage::save_license_cache(base_dir, &cached);

                    Ok(LicenseSummary {
                        is_valid: false,
                        status: rpc_res.status,
                        masked_key: cached.license_key_masked,
                        license_type: cached.license_type,
                        expires_at_formatted: format_epoch_date(cached.expires_at),
                        error_message: rpc_res.message,
                        can_use_app: false,
                    })
                }
            }
            Err(e) => {
                // If transport failed, evaluate offline grace
                if Self::can_grant_offline_grace(&cached, &current_hwid, DEFAULT_OFFLINE_GRACE_DAYS) {
                    Ok(LicenseSummary {
                        is_valid: true,
                        status: "OFFLINE_GRACE".to_string(),
                        masked_key: cached.license_key_masked,
                        license_type: cached.license_type,
                        expires_at_formatted: format_epoch_date(cached.expires_at),
                        error_message: Some("Đang hoạt động trong thời gian ân hạn ngoại tuyến (Offline Grace).".to_string()),
                        can_use_app: true,
                    })
                } else {
                    Ok(LicenseSummary {
                        is_valid: false,
                        status: "NETWORK_ERROR".to_string(),
                        masked_key: cached.license_key_masked,
                        license_type: cached.license_type,
                        expires_at_formatted: format_epoch_date(cached.expires_at),
                        error_message: Some(format!("Lỗi kết nối máy chủ: {}", e)),
                        can_use_app: false,
                    })
                }
            }
        }
    }

    /// Changes license key (LICENSE-AC-10).
    pub fn change_key(
        base_dir: &Path,
        new_key: &str,
        app_version: &str,
    ) -> Result<LicenseSummary, String> {
        Self::activate(base_dir, new_key, app_version)
    }
}
