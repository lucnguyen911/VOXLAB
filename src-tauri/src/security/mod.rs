pub mod device_identity;
pub mod license_client;
pub mod license_storage;

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Provisional development baseline: 7 days.
/// NOTE: OFFLINE_GRACE_DAYS is marked TUNING REQUIRED before product-final freeze.
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
        Some(s) if s > 0 => format!("Ngày hết hạn: {}", s),
        _ => "Vĩnh viễn".to_string(),
    }
}

fn is_definitive_server_rejection(status: &str) -> bool {
    matches!(
        status,
        "EXPIRED" | "DISABLED" | "DEVICE_MISMATCH" | "DEVICE_LIMIT" | "NOT_FOUND" | "INVALID"
    )
}

pub struct SecurityService;

impl SecurityService {
    /// Evaluates if offline grace applies (LICENSE-AC-08).
    /// Definitive server rejections, schema/HWID mismatches, clock rollback, or expired timestamps
    /// are strictly blocked from entering or continuing Offline Grace.
    pub fn can_grant_offline_grace(
        cached: &license_storage::LicenseCacheData,
        current_hwid: &str,
        grace_days: u64,
    ) -> bool {
        if current_hwid.trim().is_empty() || cached.hwid != current_hwid {
            return false;
        }

        if cached.schema_version != license_storage::LICENSE_SCHEMA_VERSION
            || cached.hwid_version != device_identity::HWID_VERSION
        {
            return false;
        }

        if cached.status != "VALID"
            && cached.status != "ACTIVATED"
            && cached.status != "OFFLINE_GRACE"
        {
            return false;
        }

        if let Some(ref srv_status) = cached.last_server_status {
            if is_definitive_server_rejection(srv_status) {
                return false;
            }
            if srv_status != "VALID" && srv_status != "ACTIVATED" {
                return false;
            }
        }

        let now = now_epoch_secs();

        // Clock rollback protection: reject if current clock is earlier than last verification
        if now + 60 < cached.last_verified_at {
            return false;
        }

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

    /// Reads license summary using an explicit hardware identity result (testable & deterministic).
    pub fn get_summary_with_hwid(
        base_dir: &Path,
        hwid_result: Result<String, String>,
    ) -> LicenseSummary {
        let current_hwid = match hwid_result {
            Ok(h) if !h.trim().is_empty() => h,
            Ok(_) => {
                return LicenseSummary {
                    is_valid: false,
                    status: "DEVICE_ID_UNAVAILABLE".to_string(),
                    masked_key: "Chưa xác định thiết bị".to_string(),
                    license_type: "N/A".to_string(),
                    expires_at_formatted: "N/A".to_string(),
                    error_message: Some(
                        "Không thể đọc mã phần cứng đáng tin cậy của thiết bị.".to_string(),
                    ),
                    can_use_app: false,
                };
            }
            Err(err) => {
                return LicenseSummary {
                    is_valid: false,
                    status: "DEVICE_ID_UNAVAILABLE".to_string(),
                    masked_key: "Chưa xác định thiết bị".to_string(),
                    license_type: "N/A".to_string(),
                    expires_at_formatted: "N/A".to_string(),
                    error_message: Some(err),
                    can_use_app: false,
                };
            }
        };

        match license_storage::load_license_cache(base_dir) {
            Ok(Some(cached)) => {
                if cached.schema_version != license_storage::LICENSE_SCHEMA_VERSION
                    || cached.hwid_version != device_identity::HWID_VERSION
                {
                    return LicenseSummary {
                        is_valid: false,
                        status: "CORRUPT_CACHE".to_string(),
                        masked_key: cached.license_key_masked,
                        license_type: cached.license_type,
                        expires_at_formatted: format_epoch_date(cached.expires_at),
                        error_message: Some(
                            "Phiên bản bộ nhớ đệm bản quyền không tương thích. Vui lòng kích hoạt lại."
                                .to_string(),
                        ),
                        can_use_app: false,
                    };
                }

                if cached.hwid != current_hwid {
                    return LicenseSummary {
                        is_valid: false,
                        status: "DEVICE_MISMATCH".to_string(),
                        masked_key: cached.license_key_masked,
                        license_type: cached.license_type,
                        expires_at_formatted: format_epoch_date(cached.expires_at),
                        error_message: Some(
                            "Dữ liệu bản quyền cục bộ thuộc về thiết bị phần cứng khác."
                                .to_string(),
                        ),
                        can_use_app: false,
                    };
                }

                if let Some(ref srv_status) = cached.last_server_status {
                    if is_definitive_server_rejection(srv_status) {
                        return LicenseSummary {
                            is_valid: false,
                            status: srv_status.clone(),
                            masked_key: cached.license_key_masked,
                            license_type: cached.license_type,
                            expires_at_formatted: format_epoch_date(cached.expires_at),
                            error_message: Some(format!(
                                "Máy chủ đã từ chối bản quyền ({}).",
                                srv_status
                            )),
                            can_use_app: false,
                        };
                    }
                }

                let now = now_epoch_secs();
                if now + 60 < cached.last_verified_at {
                    return LicenseSummary {
                        is_valid: false,
                        status: "CLOCK_ROLLBACK".to_string(),
                        masked_key: cached.license_key_masked,
                        license_type: cached.license_type,
                        expires_at_formatted: format_epoch_date(cached.expires_at),
                        error_message: Some(
                            "Phát hiện đồng hồ hệ thống bị lùi thời gian. Vui lòng đồng bộ giờ và xác thực lại."
                                .to_string(),
                        ),
                        can_use_app: false,
                    };
                }

                if let Some(exp) = cached.expires_at {
                    if now > exp {
                        return LicenseSummary {
                            is_valid: false,
                            status: "EXPIRED".to_string(),
                            masked_key: cached.license_key_masked,
                            license_type: cached.license_type,
                            expires_at_formatted: format_epoch_date(cached.expires_at),
                            error_message: Some("Mã bản quyền đã hết hạn sử dụng.".to_string()),
                            can_use_app: false,
                        };
                    }
                }

                let status_allows = cached.status == "VALID"
                    || cached.status == "ACTIVATED"
                    || cached.status == "OFFLINE_GRACE";

                let within_grace =
                    Self::can_grant_offline_grace(&cached, &current_hwid, DEFAULT_OFFLINE_GRACE_DAYS);
                let is_valid = status_allows && within_grace;

                LicenseSummary {
                    is_valid,
                    status: if is_valid {
                        cached.status.clone()
                    } else if status_allows {
                        "OFFLINE_GRACE_EXPIRED".to_string()
                    } else {
                        cached.status.clone()
                    },
                    masked_key: cached.license_key_masked.clone(),
                    license_type: cached.license_type.clone(),
                    expires_at_formatted: format_epoch_date(cached.expires_at),
                    error_message: if !is_valid && status_allows {
                        Some(
                            "Đã quá thời hạn sử dụng ngoại tuyến (Offline Grace). Vui lòng kết nối mạng để xác thực lại."
                                .to_string(),
                        )
                    } else {
                        None
                    },
                    can_use_app: is_valid,
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

    /// Reads license summary for frontend (LICENSE-AC-09: zero raw keys to frontend).
    pub fn get_summary(base_dir: &Path) -> LicenseSummary {
        Self::get_summary_with_hwid(base_dir, device_identity::try_generate_hwid())
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

        let hwid = device_identity::try_generate_hwid()?;
        let masked_key = license_storage::mask_license_key(trimmed_key);

        let (supabase_url, anon_key) = match license_client::get_supabase_config() {
            Some(cfg) => cfg,
            None => {
                return Err("Chưa cấu hình Supabase Server (VOXLAB_SUPABASE_URL / VOXLAB_SUPABASE_ANON_KEY). Vui lòng cấu hình biến môi trường server để kích hoạt online.".to_string());
            }
        };

        let rpc_res = license_client::verify_with_server(
            &supabase_url,
            &anon_key,
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
    pub fn verify(base_dir: &Path, app_version: &str) -> Result<LicenseSummary, String> {
        let current_hwid = match device_identity::try_generate_hwid() {
            Ok(h) => h,
            Err(err) => {
                return Ok(Self::get_summary_with_hwid(base_dir, Err(err)));
            }
        };

        let cached_opt = match license_storage::load_license_cache(base_dir) {
            Ok(opt) => opt,
            Err(err) => {
                return Ok(LicenseSummary {
                    is_valid: false,
                    status: "CORRUPT_CACHE".to_string(),
                    masked_key: "Lỗi bộ nhớ".to_string(),
                    license_type: "N/A".to_string(),
                    expires_at_formatted: "N/A".to_string(),
                    error_message: Some(format!("Không thể giải mã bản quyền: {}", err)),
                    can_use_app: false,
                });
            }
        };

        let mut cached = match cached_opt {
            Some(c) => c,
            None => return Ok(Self::get_summary_with_hwid(base_dir, Ok(current_hwid))),
        };

        let (supabase_url, anon_key) = match license_client::get_supabase_config() {
            Some(cfg) => cfg,
            None => {
                if Self::can_grant_offline_grace(
                    &cached,
                    &current_hwid,
                    DEFAULT_OFFLINE_GRACE_DAYS,
                ) {
                    return Ok(LicenseSummary {
                        is_valid: true,
                        status: "OFFLINE_GRACE".to_string(),
                        masked_key: cached.license_key_masked,
                        license_type: cached.license_type,
                        expires_at_formatted: format_epoch_date(cached.expires_at),
                        error_message: Some(
                            "Đang hoạt động trong thời gian ân hạn ngoại tuyến (Offline Grace)."
                                .to_string(),
                        ),
                        can_use_app: true,
                    });
                } else {
                    return Ok(Self::get_summary_with_hwid(base_dir, Ok(current_hwid)));
                }
            }
        };

        // Call Supabase RPC with decrypted key
        let rpc_result = license_client::verify_with_server(
            &supabase_url,
            &anon_key,
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
                    // Check Offline Grace without extending last_verified_at
                    if Self::can_grant_offline_grace(
                        &cached,
                        &current_hwid,
                        DEFAULT_OFFLINE_GRACE_DAYS,
                    ) {
                        cached.status = "OFFLINE_GRACE".to_string();
                        let _ = license_storage::save_license_cache(base_dir, &cached);

                        Ok(LicenseSummary {
                            is_valid: true,
                            status: "OFFLINE_GRACE".to_string(),
                            masked_key: cached.license_key_masked,
                            license_type: cached.license_type,
                            expires_at_formatted: format_epoch_date(cached.expires_at),
                            error_message: Some(
                                "Đang hoạt động trong thời gian ân hạn ngoại tuyến (Offline Grace)."
                                    .to_string(),
                            ),
                            can_use_app: true,
                        })
                    } else {
                        Ok(LicenseSummary {
                            is_valid: false,
                            status: rpc_res.status,
                            masked_key: cached.license_key_masked,
                            license_type: cached.license_type,
                            expires_at_formatted: format_epoch_date(cached.expires_at),
                            error_message: Some(
                                "Hết hạn ân hạn ngoại tuyến. Vui lòng kết nối mạng để xác thực lại."
                                    .to_string(),
                            ),
                            can_use_app: false,
                        })
                    }
                } else {
                    // Definitive rejection: EXPIRED, DISABLED, DEVICE_MISMATCH, DEVICE_LIMIT, NOT_FOUND
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
                // If transport failed, evaluate offline grace without extending last_verified_at
                if Self::can_grant_offline_grace(
                    &cached,
                    &current_hwid,
                    DEFAULT_OFFLINE_GRACE_DAYS,
                ) {
                    Ok(LicenseSummary {
                        is_valid: true,
                        status: "OFFLINE_GRACE".to_string(),
                        masked_key: cached.license_key_masked,
                        license_type: cached.license_type,
                        expires_at_formatted: format_epoch_date(cached.expires_at),
                        error_message: Some(
                            "Đang hoạt động trong thời gian ân hạn ngoại tuyến (Offline Grace)."
                                .to_string(),
                        ),
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

    /// Returns whether mandatory commercial license enforcement is active at the Rust boundary.
    /// Controlled via `VOXLAB_ENFORCE_LICENSE=1` (or `true`) until Gate E commercial lock approval.
    pub fn is_commercial_enforcement_enabled() -> bool {
        match std::env::var("VOXLAB_ENFORCE_LICENSE") {
            Ok(v) => {
                let norm = v.trim().to_ascii_lowercase();
                norm == "1" || norm == "true" || norm == "yes" || norm == "strict"
            }
            Err(_) => false,
        }
    }

    /// Centralized Rust-layer commercial feature guard.
    /// Blocks commercial AI actions (`tts.*`, `asr.*`, `audio.assemble`) when the license is missing,
    /// expired, mismatched, corrupted, or rejected by the server, while leaving Settings, License
    /// activation, diagnostics, and user history/exports accessible.
    pub fn check_commercial_access_for_dir(
        base_dir: &Path,
        hwid_result: Result<String, String>,
        action_name: &str,
    ) -> Result<(), String> {
        let summary = Self::get_summary_with_hwid(base_dir, hwid_result);
        if summary.can_use_app && summary.is_valid {
            Ok(())
        } else {
            let reason = summary
                .error_message
                .unwrap_or_else(|| "Bản quyền chưa được kích hoạt hoặc không hợp lệ.".to_string());
            Err(format!(
                "LICENSE_REQUIRED [{}]: Tác vụ thương mại '{}' bị chặn ({})",
                summary.status, action_name, reason
            ))
        }
    }

    /// Enforces commercial license check if `is_commercial_enforcement_enabled()` is active.
    pub fn require_commercial_access_if_enabled(
        base_dir: &Path,
        action_name: &str,
    ) -> Result<(), String> {
        if !Self::is_commercial_enforcement_enabled() {
            return Ok(());
        }
        Self::check_commercial_access_for_dir(
            base_dir,
            device_identity::try_generate_hwid(),
            action_name,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_sample_cache(
        hwid: &str,
        status: &str,
        expires_at: Option<u64>,
    ) -> license_storage::LicenseCacheData {
        license_storage::LicenseCacheData {
            schema_version: license_storage::LICENSE_SCHEMA_VERSION,
            license_key: "VOXLAB-PRO-ABCD-EFGH-IJKL-MNOP".to_string(),
            license_key_masked: "VOXL-••••-••••-••••-MNOP".to_string(),
            license_type: "Professional License".to_string(),
            hwid_version: device_identity::HWID_VERSION.to_string(),
            hwid: hwid.to_string(),
            status: status.to_string(),
            saved_at: now_epoch_secs(),
            last_verified_at: now_epoch_secs(),
            expires_at,
            last_server_status: Some("ACTIVATED".to_string()),
        }
    }

    #[test]
    fn test_can_grant_offline_grace_matching_hwid() {
        let current_hwid = "v1:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
        let cache = make_sample_cache(current_hwid, "VALID", None);
        assert!(SecurityService::can_grant_offline_grace(
            &cache,
            current_hwid,
            7
        ));
    }

    #[test]
    fn test_rejects_offline_grace_on_device_mismatch() {
        let cache = make_sample_cache("ORIGINAL-DEVICE-HWID", "VALID", None);
        let mismatched_hwid = "DIFFERENT-DEVICE-HWID";
        assert!(!SecurityService::can_grant_offline_grace(
            &cache,
            mismatched_hwid,
            7
        ));
    }

    #[test]
    fn test_rejects_offline_grace_when_expired() {
        let current_hwid = "TEST-DEVICE-HWID-12345";
        let past_time = now_epoch_secs().saturating_sub(3600);
        let cache = make_sample_cache(current_hwid, "VALID", Some(past_time));
        assert!(!SecurityService::can_grant_offline_grace(
            &cache,
            current_hwid,
            7
        ));
    }

    #[test]
    fn test_rejects_offline_grace_on_clock_rollback() {
        let current_hwid = "TEST-DEVICE-HWID-12345";
        let mut cache = make_sample_cache(current_hwid, "VALID", None);
        cache.last_verified_at = now_epoch_secs() + 86400;
        assert!(!SecurityService::can_grant_offline_grace(
            &cache,
            current_hwid,
            7
        ));
    }

    #[test]
    fn test_rejects_offline_grace_when_grace_window_exceeded() {
        let current_hwid = "TEST-DEVICE-HWID-12345";
        let mut cache = make_sample_cache(current_hwid, "ACTIVATED", None);
        cache.last_verified_at = now_epoch_secs().saturating_sub(8 * 86400);
        assert!(!SecurityService::can_grant_offline_grace(
            &cache,
            current_hwid,
            7
        ));
    }

    #[test]
    fn test_rejects_offline_grace_after_definitive_server_rejection() {
        let current_hwid = "TEST-DEVICE-HWID-12345";
        for rejected_status in [
            "EXPIRED",
            "DISABLED",
            "DEVICE_MISMATCH",
            "DEVICE_LIMIT",
            "NOT_FOUND",
        ] {
            let mut cache = make_sample_cache(current_hwid, "ACTIVATED", None);
            cache.last_server_status = Some(rejected_status.to_string());
            assert!(
                !SecurityService::can_grant_offline_grace(&cache, current_hwid, 7),
                "Server status {} must NEVER allow Offline Grace!",
                rejected_status
            );
        }
    }

    #[test]
    fn test_summary_masks_key_and_never_leaks_raw_key() {
        let temp_dir = std::env::temp_dir().join(format!(
            "voxlab_sec_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let hwid = "v1:abc123456789";
        let cache = make_sample_cache(hwid, "VALID", None);
        license_storage::save_license_cache(&temp_dir, &cache).unwrap();

        let summary = SecurityService::get_summary_with_hwid(&temp_dir, Ok(hwid.to_string()));
        assert!(summary.is_valid);
        assert!(summary.can_use_app);
        assert_eq!(summary.masked_key, "VOXL-••••-••••-••••-MNOP");
        assert!(!format!("{:?}", summary).contains("VOXLAB-PRO-ABCD-EFGH-IJKL-MNOP"));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_commercial_guard_blocks_unactivated_corrupted_mismatched_and_expired_caches() {
        let temp_dir = std::env::temp_dir().join(format!(
            "voxlab_guard_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let hwid = "v1:device_anchor_a";

        // 1. No key -> blocked
        let no_key_res = SecurityService::check_commercial_access_for_dir(
            &temp_dir,
            Ok(hwid.to_string()),
            "tts.synthesize",
        );
        assert!(no_key_res.is_err());
        assert!(no_key_res.unwrap_err().contains("NO_KEY"));

        // 2. Valid activated cache on matching HWID -> allowed
        let valid_cache = make_sample_cache(hwid, "ACTIVATED", None);
        license_storage::save_license_cache(&temp_dir, &valid_cache).unwrap();
        assert!(SecurityService::check_commercial_access_for_dir(
            &temp_dir,
            Ok(hwid.to_string()),
            "tts.synthesize"
        )
        .is_ok());

        // 3. Copied to another machine (different HWID) -> blocked with DEVICE_MISMATCH
        let copied_res = SecurityService::check_commercial_access_for_dir(
            &temp_dir,
            Ok("v1:device_anchor_b".to_string()),
            "tts.synthesize",
        );
        assert!(copied_res.is_err());
        assert!(copied_res.unwrap_err().contains("DEVICE_MISMATCH"));

        // 4. Expired cache -> blocked with EXPIRED
        let expired_cache =
            make_sample_cache(hwid, "ACTIVATED", Some(now_epoch_secs().saturating_sub(60)));
        license_storage::save_license_cache(&temp_dir, &expired_cache).unwrap();
        let exp_res = SecurityService::check_commercial_access_for_dir(
            &temp_dir,
            Ok(hwid.to_string()),
            "asr.transcribe",
        );
        assert!(exp_res.is_err());
        assert!(exp_res.unwrap_err().contains("EXPIRED"));

        // 5. Corrupted license.enc file -> blocked with CORRUPT_CACHE
        std::fs::write(
            temp_dir.join(license_storage::LICENSE_CACHE_FILE),
            b"corrupted-random-bytes",
        )
        .unwrap();
        let corrupt_res = SecurityService::check_commercial_access_for_dir(
            &temp_dir,
            Ok(hwid.to_string()),
            "tts.synthesize",
        );
        assert!(corrupt_res.is_err());
        assert!(corrupt_res.unwrap_err().contains("CORRUPT_CACHE"));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
