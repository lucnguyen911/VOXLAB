pub mod device_identity;
pub mod license_client;
pub mod license_storage;

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Offline grace period aligned with Audio-Factory Security v3: 3 days.
pub const DEFAULT_OFFLINE_GRACE_DAYS: u64 = 3;
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

/// Converts Unix epoch seconds to human-readable UTC date `DD/MM/YYYY HH:MM UTC`
/// (Howard Hinnant's civil-from-days algorithm, zero external crate overhead).
pub fn format_epoch_date(epoch_secs: Option<u64>) -> String {
    match epoch_secs {
        Some(secs) if secs > 0 => {
            let days = (secs / 86_400) as i64;
            let rem_secs = secs % 86_400;
            let hour = rem_secs / 3600;
            let minute = (rem_secs % 3600) / 60;

            let z = days + 719_468;
            let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
            let doe = (z - era * 146_097) as u64;
            let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
            let y = (yoe as i64) + era * 400;
            let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
            let mp = (5 * doy + 2) / 153;
            let d = doy - (153 * mp + 2) / 5 + 1;
            let m = if mp < 10 { mp + 3 } else { mp - 9 };
            let year = if m <= 2 { y + 1 } else { y };

            format!("{:02}/{:02}/{:04} {:02}:{:02} UTC", d, m, year, hour, minute)
        }
        _ => "Vĩnh viễn".to_string(),
    }
}

fn is_success_status(status: &str) -> bool {
    matches!(status, "VALID" | "ACTIVATED" | "MIGRATED")
}

fn is_definitive_server_rejection(status: &str) -> bool {
    matches!(
        status,
        "EXPIRED"
            | "LICENSE_EXPIRED"
            | "DISABLED"
            | "LICENSE_DISABLED"
            | "DEVICE_MISMATCH"
            | "LEGACY_DEVICE_MISMATCH"
            | "DEVICE_LIMIT"
            | "NOT_FOUND"
            | "LICENSE_NOT_FOUND"
            | "INVALID"
            | "CLIENT_CONFIG_ERROR"
            | "AUTH_ERROR"
    )
}

fn status_default_message(status: &str) -> &'static str {
    match status {
        "VALID" => "Bản quyền hợp lệ.",
        "ACTIVATED" => "Kích hoạt bản quyền thành công trên máy này!",
        "MIGRATED" => "Đã chuyển đổi bản quyền sang hệ thống mới thành công!",
        "NOT_FOUND" | "LICENSE_NOT_FOUND" => "Key bản quyền không tồn tại.",
        "DISABLED" | "LICENSE_DISABLED" => "Key bản quyền đã bị khóa hoặc vô hiệu hóa.",
        "EXPIRED" | "LICENSE_EXPIRED" => {
            "Key bản quyền đã hết hạn sử dụng. Vui lòng gia hạn để tiếp tục."
        }
        "DEVICE_MISMATCH" | "LEGACY_DEVICE_MISMATCH" => "Key đã được sử dụng ở máy khác!",
        "DEVICE_LIMIT" => {
            "Key đã đạt số thiết bị tối đa. Vui lòng liên hệ quản trị viên để reset thiết bị."
        }
        "NETWORK_ERROR" => {
            "Lỗi kết nối kiểm tra bản quyền. Vui lòng kiểm tra mạng Internet và thử lại."
        }
        "SERVER_ERROR" => "Lỗi máy chủ bản quyền tạm thời. Vui lòng thử lại sau.",
        "AUTH_ERROR" => "Lỗi xác thực máy chủ bản quyền. Vui lòng liên hệ hỗ trợ.",
        "CLIENT_CONFIG_ERROR" => {
            "Lỗi cấu hình máy chủ bản quyền. Vui lòng cập nhật phần mềm hoặc liên hệ hỗ trợ."
        }
        _ => "Không thể xác thực bản quyền.",
    }
}

pub struct SecurityService;

impl SecurityService {
    /// Evaluates if offline grace applies (Security v3 / LICENSE-AC-09 & LICENSE-AC-10).
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

        if !is_success_status(&cached.status) && cached.status != "OFFLINE_GRACE" {
            return false;
        }

        match cached.last_server_status.as_deref() {
            Some(srv_status) => {
                if is_definitive_server_rejection(srv_status) || !is_success_status(srv_status) {
                    return false;
                }
            }
            None => return false,
        }

        if cached.last_verified_at == 0 {
            return false;
        }

        let now = now_epoch_secs();

        // Clock rollback protection: reject if system clock moved backwards past last_verified_at or last_seen_at
        if now + 60 < cached.last_verified_at {
            return false;
        }
        if cached.last_seen_at > 0 && now + 60 < cached.last_seen_at {
            return false;
        }

        let grace_duration = grace_days * 86_400;
        if now > cached.last_verified_at + grace_duration {
            return false;
        }

        // If license has an explicit expiration, it must not be expired
        if let Some(exp) = cached.expires_at {
            if now >= exp {
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
                            "Phiên bản bộ nhớ đệm bản quyền đã được nâng cấp lên Security v3. Vui lòng kích hoạt lại Key."
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
                            error_message: Some(status_default_message(srv_status).to_string()),
                            can_use_app: false,
                        };
                    }
                }

                let now = now_epoch_secs();
                if now + 60 < cached.last_verified_at
                    || (cached.last_seen_at > 0 && now + 60 < cached.last_seen_at)
                {
                    return LicenseSummary {
                        is_valid: false,
                        status: "CLOCK_ROLLBACK".to_string(),
                        masked_key: cached.license_key_masked,
                        license_type: cached.license_type,
                        expires_at_formatted: format_epoch_date(cached.expires_at),
                        error_message: Some(
                            "Phát hiện đồng hồ hệ thống bị lùi thời gian. Vui lòng đồng bộ giờ Windows và xác thực lại."
                                .to_string(),
                        ),
                        can_use_app: false,
                    };
                }

                if let Some(exp) = cached.expires_at {
                    if now >= exp {
                        return LicenseSummary {
                            is_valid: false,
                            status: "EXPIRED".to_string(),
                            masked_key: cached.license_key_masked,
                            license_type: cached.license_type,
                            expires_at_formatted: format_epoch_date(cached.expires_at),
                            error_message: Some(status_default_message("EXPIRED").to_string()),
                            can_use_app: false,
                        };
                    }
                }

                let status_allows =
                    is_success_status(&cached.status) || cached.status == "OFFLINE_GRACE";

                let within_grace = Self::can_grant_offline_grace(
                    &cached,
                    &current_hwid,
                    DEFAULT_OFFLINE_GRACE_DAYS,
                );
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
                            "Đã quá thời hạn ân hạn ngoại tuyến 3 ngày. Vui lòng kết nối mạng để xác thực lại."
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
                error_message: Some("Vui lòng nhập License Key để kích hoạt phần mềm.".to_string()),
                can_use_app: false,
            },
            Err(e) => LicenseSummary {
                is_valid: false,
                status: "CORRUPT_CACHE".to_string(),
                masked_key: "Lỗi bộ nhớ".to_string(),
                license_type: "N/A".to_string(),
                expires_at_formatted: "N/A".to_string(),
                error_message: Some(format!("Không thể giải mã bộ nhớ bản quyền: {}", e)),
                can_use_app: false,
            },
        }
    }

    /// Reads license summary for frontend (LICENSE-AC-11: zero raw keys to frontend).
    pub fn get_summary(base_dir: &Path) -> LicenseSummary {
        Self::get_summary_with_hwid(
            base_dir,
            device_identity::get_device_identity(Some(base_dir)).map(|id| id.hwid),
        )
    }

    /// Activates a license key with Supabase RPC v3 and saves DPAPI cache atomically.
    pub fn activate(
        base_dir: &Path,
        raw_key: &str,
        app_version: &str,
    ) -> Result<LicenseSummary, String> {
        let trimmed_key = raw_key.trim().to_uppercase();
        if trimmed_key.is_empty() {
            return Err("Vui lòng nhập License Key kích hoạt.".to_string());
        }

        let identity = device_identity::get_device_identity(Some(base_dir))?;
        let masked_key = license_storage::mask_license_key(&trimmed_key);

        let (supabase_url, anon_key) = match license_client::get_supabase_config() {
            Some(cfg) => cfg,
            None => {
                return Err(
                    "Chưa cấu hình máy chủ bản quyền Supabase (VOXLAB_SUPABASE_URL / VOXLAB_SUPABASE_ANON_KEY)."
                        .to_string(),
                );
            }
        };

        let rpc_res = license_client::verify_with_server(
            &supabase_url,
            &anon_key,
            &trimmed_key,
            &identity.hwid,
            identity.version,
            &identity.legacy_candidates,
            app_version,
        )?;

        let now = now_epoch_secs();
        let is_success = is_success_status(&rpc_res.status);

        if is_success {
            let license_type = rpc_res
                .license_type
                .unwrap_or_else(|| "Commercial Lifetime".to_string());

            let cache = license_storage::LicenseCacheData {
                schema_version: license_storage::LICENSE_SCHEMA_VERSION,
                license_key: trimmed_key,
                license_key_masked: masked_key.clone(),
                license_type: license_type.clone(),
                hwid_version: device_identity::HWID_VERSION.to_string(),
                hwid: identity.hwid,
                status: rpc_res.status.clone(),
                saved_at: now,
                last_seen_at: now,
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
            let msg = rpc_res
                .message
                .unwrap_or_else(|| status_default_message(&rpc_res.status).to_string());
            Ok(LicenseSummary {
                is_valid: false,
                status: rpc_res.status,
                masked_key,
                license_type: rpc_res.license_type.unwrap_or_else(|| "N/A".to_string()),
                expires_at_formatted: format_epoch_date(rpc_res.expires_at),
                error_message: Some(msg),
                can_use_app: false,
            })
        }
    }

    /// Verifies existing cached license online on startup/refresh, with 3-day Offline Grace
    /// strictly limited to transient `NETWORK_ERROR` / `SERVER_ERROR`.
    pub fn verify(base_dir: &Path, app_version: &str) -> Result<LicenseSummary, String> {
        let identity = match device_identity::get_device_identity(Some(base_dir)) {
            Ok(id) => id,
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
            None => return Ok(Self::get_summary_with_hwid(base_dir, Ok(identity.hwid))),
        };

        // Support transparent migration if an older v1 DPAPI cache exists on disk:
        // include cached.hwid in legacy_candidates and re-verify online immediately.
        let mut legacy_candidates = identity.legacy_candidates.clone();
        if cached.hwid != identity.hwid && !legacy_candidates.contains(&cached.hwid) {
            legacy_candidates.insert(0, cached.hwid.clone());
        }

        let (supabase_url, anon_key) = match license_client::get_supabase_config() {
            Some(cfg) => cfg,
            None => {
                return Ok(LicenseSummary {
                    is_valid: false,
                    status: "CLIENT_CONFIG_ERROR".to_string(),
                    masked_key: cached.license_key_masked,
                    license_type: cached.license_type,
                    expires_at_formatted: format_epoch_date(cached.expires_at),
                    error_message: Some(
                        "Chưa cấu hình kết nối máy chủ bản quyền Supabase.".to_string(),
                    ),
                    can_use_app: false,
                });
            }
        };

        let rpc_result = license_client::verify_with_server(
            &supabase_url,
            &anon_key,
            &cached.license_key,
            &identity.hwid,
            identity.version,
            &legacy_candidates,
            app_version,
        );

        let now = now_epoch_secs();

        match rpc_result {
            Ok(rpc_res) => {
                if is_success_status(&rpc_res.status) {
                    cached.schema_version = license_storage::LICENSE_SCHEMA_VERSION;
                    cached.hwid_version = device_identity::HWID_VERSION.to_string();
                    cached.hwid = identity.hwid;
                    cached.status = rpc_res.status.clone();
                    cached.last_seen_at = now;
                    cached.last_verified_at = now;
                    cached.last_server_status = Some(rpc_res.status.clone());
                    cached.expires_at = rpc_res.expires_at;
                    if let Some(lic_type) = rpc_res.license_type {
                        cached.license_type = lic_type;
                    }
                    cached.license_key_masked =
                        license_storage::mask_license_key(&cached.license_key);

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
                    // Transient outage: check 3-day Offline Grace WITHOUT extending last_verified_at
                    if Self::can_grant_offline_grace(
                        &cached,
                        &identity.hwid,
                        DEFAULT_OFFLINE_GRACE_DAYS,
                    ) {
                        cached.status = "OFFLINE_GRACE".to_string();
                        if now > cached.last_seen_at {
                            cached.last_seen_at = now;
                        }
                        let _ = license_storage::save_license_cache(base_dir, &cached);

                        Ok(LicenseSummary {
                            is_valid: true,
                            status: "OFFLINE_GRACE".to_string(),
                            masked_key: cached.license_key_masked,
                            license_type: cached.license_type,
                            expires_at_formatted: format_epoch_date(cached.expires_at),
                            error_message: Some(
                                "Đang hoạt động ngoại tuyến (Ân hạn tối đa 3 ngày).".to_string(),
                            ),
                            can_use_app: true,
                        })
                    } else {
                        Ok(LicenseSummary {
                            is_valid: false,
                            status: rpc_res.status.clone(),
                            masked_key: cached.license_key_masked,
                            license_type: cached.license_type,
                            expires_at_formatted: format_epoch_date(cached.expires_at),
                            error_message: Some(
                                rpc_res.message.unwrap_or_else(|| {
                                    "Không thể kết nối máy chủ bản quyền và thời gian ân hạn ngoại tuyến đã hết."
                                        .to_string()
                                }),
                            ),
                            can_use_app: false,
                        })
                    }
                } else {
                    // Definitive rejection (EXPIRED, DISABLED, DEVICE_MISMATCH, DEVICE_LIMIT, NOT_FOUND, AUTH_ERROR, CLIENT_CONFIG_ERROR)
                    cached.status = rpc_res.status.clone();
                    cached.last_server_status = Some(rpc_res.status.clone());
                    cached.expires_at = rpc_res.expires_at.or(cached.expires_at);
                    if now > cached.last_seen_at {
                        cached.last_seen_at = now;
                    }
                    let _ = license_storage::save_license_cache(base_dir, &cached);

                    let msg = rpc_res
                        .message
                        .unwrap_or_else(|| status_default_message(&rpc_res.status).to_string());

                    Ok(LicenseSummary {
                        is_valid: false,
                        status: rpc_res.status,
                        masked_key: cached.license_key_masked,
                        license_type: cached.license_type,
                        expires_at_formatted: format_epoch_date(cached.expires_at),
                        error_message: Some(msg),
                        can_use_app: false,
                    })
                }
            }
            Err(e) => {
                if Self::can_grant_offline_grace(
                    &cached,
                    &identity.hwid,
                    DEFAULT_OFFLINE_GRACE_DAYS,
                ) {
                    cached.status = "OFFLINE_GRACE".to_string();
                    if now > cached.last_seen_at {
                        cached.last_seen_at = now;
                    }
                    let _ = license_storage::save_license_cache(base_dir, &cached);

                    Ok(LicenseSummary {
                        is_valid: true,
                        status: "OFFLINE_GRACE".to_string(),
                        masked_key: cached.license_key_masked,
                        license_type: cached.license_type,
                        expires_at_formatted: format_epoch_date(cached.expires_at),
                        error_message: Some(
                            "Đang hoạt động ngoại tuyến (Ân hạn tối đa 3 ngày).".to_string(),
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
                        error_message: Some(format!("Lỗi kết nối máy chủ bản quyền: {}", e)),
                        can_use_app: false,
                    })
                }
            }
        }
    }

    /// Changes license key (LICENSE-AC-13).
    pub fn change_key(
        base_dir: &Path,
        new_key: &str,
        app_version: &str,
    ) -> Result<LicenseSummary, String> {
        Self::activate(base_dir, new_key, app_version)
    }

    /// Returns whether mandatory commercial license enforcement is active at the Rust boundary.
    /// Enabled by default (Gate E approved); can only be explicitly disabled in local test builds
    /// via `VOXLAB_ENFORCE_LICENSE=0` / `false`.
    pub fn is_commercial_enforcement_enabled() -> bool {
        let val = std::env::var("VOXLAB_ENFORCE_LICENSE")
            .ok()
            .or_else(|| option_env!("VOXLAB_ENFORCE_LICENSE").map(String::from));

        match val {
            Some(v) => {
                let norm = v.trim().to_ascii_lowercase();
                !(norm == "0" || norm == "false" || norm == "no" || norm == "off")
            }
            None => true,
        }
    }

    /// Centralized Rust-layer commercial feature guard.
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

    /// Enforces commercial license check when `is_commercial_enforcement_enabled()` is active.
    pub fn require_commercial_access_if_enabled(
        base_dir: &Path,
        action_name: &str,
    ) -> Result<(), String> {
        if !Self::is_commercial_enforcement_enabled() {
            return Ok(());
        }
        Self::check_commercial_access_for_dir(
            base_dir,
            device_identity::get_device_identity(Some(base_dir)).map(|id| id.hwid),
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
        let now = now_epoch_secs();
        license_storage::LicenseCacheData {
            schema_version: license_storage::LICENSE_SCHEMA_VERSION,
            license_key: "VOXLAB-8DEE-C4E6-24D5-462B".to_string(),
            license_key_masked: "VOXLAB-****-****-462B".to_string(),
            license_type: "Commercial Lifetime".to_string(),
            hwid_version: device_identity::HWID_VERSION.to_string(),
            hwid: hwid.to_string(),
            status: status.to_string(),
            saved_at: now,
            last_seen_at: now,
            last_verified_at: now,
            expires_at,
            last_server_status: Some("ACTIVATED".to_string()),
        }
    }

    #[test]
    fn test_format_epoch_date_utc() {
        assert_eq!(format_epoch_date(None), "Vĩnh viễn");
        assert_eq!(format_epoch_date(Some(0)), "Vĩnh viễn");
        // 2026-10-26 00:00:00 UTC = 1792972800
        assert_eq!(format_epoch_date(Some(1_792_972_800)), "26/10/2026 00:00 UTC");
    }

    #[test]
    fn test_can_grant_offline_grace_matching_hwid_within_3_days() {
        let current_hwid = "a".repeat(64);
        let cache = make_sample_cache(&current_hwid, "VALID", None);
        assert!(SecurityService::can_grant_offline_grace(
            &cache,
            &current_hwid,
            DEFAULT_OFFLINE_GRACE_DAYS
        ));
    }

    #[test]
    fn test_rejects_offline_grace_on_device_mismatch() {
        let cache = make_sample_cache(&"a".repeat(64), "VALID", None);
        let mismatched_hwid = "b".repeat(64);
        assert!(!SecurityService::can_grant_offline_grace(
            &cache,
            &mismatched_hwid,
            DEFAULT_OFFLINE_GRACE_DAYS
        ));
    }

    #[test]
    fn test_rejects_offline_grace_when_expired() {
        let current_hwid = "a".repeat(64);
        let past_time = now_epoch_secs().saturating_sub(3600);
        let cache = make_sample_cache(&current_hwid, "VALID", Some(past_time));
        assert!(!SecurityService::can_grant_offline_grace(
            &cache,
            &current_hwid,
            DEFAULT_OFFLINE_GRACE_DAYS
        ));
    }

    #[test]
    fn test_rejects_offline_grace_on_clock_rollback() {
        let current_hwid = "a".repeat(64);
        let mut cache = make_sample_cache(&current_hwid, "VALID", None);
        cache.last_seen_at = now_epoch_secs() + 86_400;
        assert!(!SecurityService::can_grant_offline_grace(
            &cache,
            &current_hwid,
            DEFAULT_OFFLINE_GRACE_DAYS
        ));
    }

    #[test]
    fn test_rejects_offline_grace_when_3_day_window_exceeded() {
        let current_hwid = "a".repeat(64);
        let mut cache = make_sample_cache(&current_hwid, "ACTIVATED", None);
        cache.last_verified_at = now_epoch_secs().saturating_sub(4 * 86_400);
        assert!(!SecurityService::can_grant_offline_grace(
            &cache,
            &current_hwid,
            DEFAULT_OFFLINE_GRACE_DAYS
        ));
    }

    #[test]
    fn test_rejects_offline_grace_after_definitive_server_rejection() {
        let current_hwid = "a".repeat(64);
        for rejected_status in [
            "EXPIRED",
            "DISABLED",
            "DEVICE_MISMATCH",
            "DEVICE_LIMIT",
            "NOT_FOUND",
            "AUTH_ERROR",
            "CLIENT_CONFIG_ERROR",
        ] {
            let mut cache = make_sample_cache(&current_hwid, "ACTIVATED", None);
            cache.last_server_status = Some(rejected_status.to_string());
            assert!(
                !SecurityService::can_grant_offline_grace(
                    &cache,
                    &current_hwid,
                    DEFAULT_OFFLINE_GRACE_DAYS
                ),
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
        let hwid = "a".repeat(64);
        let cache = make_sample_cache(&hwid, "VALID", None);
        license_storage::save_license_cache(&temp_dir, &cache).unwrap();

        let summary = SecurityService::get_summary_with_hwid(&temp_dir, Ok(hwid));
        assert!(summary.is_valid);
        assert!(summary.can_use_app);
        assert_eq!(summary.masked_key, "VOXLAB-****-****-462B");
        assert!(!format!("{:?}", summary).contains("VOXLAB-8DEE-C4E6-24D5-462B"));

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
        let hwid = "a".repeat(64);

        // 1. No key -> blocked
        let no_key_res = SecurityService::check_commercial_access_for_dir(
            &temp_dir,
            Ok(hwid.clone()),
            "tts.synthesize",
        );
        assert!(no_key_res.is_err());
        assert!(no_key_res.unwrap_err().contains("NO_KEY"));

        // 2. Valid activated cache on matching HWID -> allowed
        let valid_cache = make_sample_cache(&hwid, "ACTIVATED", None);
        license_storage::save_license_cache(&temp_dir, &valid_cache).unwrap();
        assert!(SecurityService::check_commercial_access_for_dir(
            &temp_dir,
            Ok(hwid.clone()),
            "tts.synthesize"
        )
        .is_ok());

        // 3. Copied to another machine (different HWID) -> blocked with DEVICE_MISMATCH
        let copied_res = SecurityService::check_commercial_access_for_dir(
            &temp_dir,
            Ok("b".repeat(64)),
            "tts.synthesize",
        );
        assert!(copied_res.is_err());
        assert!(copied_res.unwrap_err().contains("DEVICE_MISMATCH"));

        // 4. Expired cache -> blocked with EXPIRED
        let expired_cache =
            make_sample_cache(&hwid, "ACTIVATED", Some(now_epoch_secs().saturating_sub(60)));
        license_storage::save_license_cache(&temp_dir, &expired_cache).unwrap();
        let exp_res = SecurityService::check_commercial_access_for_dir(
            &temp_dir,
            Ok(hwid.clone()),
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
            Ok(hwid),
            "tts.synthesize",
        );
        assert!(corrupt_res.is_err());
        assert!(corrupt_res.unwrap_err().contains("CORRUPT_CACHE"));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    #[ignore = "Requires live Supabase connection and VOXLAB_LIVE_TEST_KEY env var"]
    fn live_supabase_e2e_activate_and_verify() {
        let test_key = std::env::var("VOXLAB_LIVE_TEST_KEY")
            .expect("Set VOXLAB_LIVE_TEST_KEY to run live E2E license verification");
        let temp_dir = std::env::temp_dir().join(format!(
            "voxlab_live_e2e_{}_{}",
            std::process::id(),
            now_epoch_secs()
        ));
        std::fs::create_dir_all(&temp_dir).unwrap();

        // 1. Reject non-existent key via live RPC
        let not_found = SecurityService::activate(
            &temp_dir,
            "VOXLAB-0000-0000-0000-0000",
            "0.1.0-e2e",
        )
        .unwrap();
        assert!(!not_found.is_valid);
        assert_eq!(not_found.status, "NOT_FOUND");
        assert!(!not_found.can_use_app);

        // 2. Activate real key via live RPC + persist DPAPI license.enc
        let activated = SecurityService::activate(&temp_dir, &test_key, "0.1.0-e2e").unwrap();
        assert!(
            activated.is_valid,
            "Expected valid activation, got: {:?}",
            activated
        );
        assert!(activated.status == "ACTIVATED" || activated.status == "VALID");
        assert!(activated.can_use_app);
        assert!(activated.masked_key.starts_with("VOXLAB-****-****-"));
        assert!(temp_dir.join(license_storage::LICENSE_CACHE_FILE).exists());

        // 3. Re-verify cached DPAPI license online via live RPC -> VALID
        let verified = SecurityService::verify(&temp_dir, "0.1.0-e2e").unwrap();
        assert!(verified.is_valid);
        assert_eq!(verified.status, "VALID");
        assert!(verified.can_use_app);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
