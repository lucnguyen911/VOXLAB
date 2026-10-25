use serde::{Deserialize, Serialize};

/// Retrieves Supabase URL and anon key from compile-time polymorphically obfuscated constants.
/// - In **Release** builds (`not(debug_assertions)`), runtime environment variable overrides are
///   strictly ignored so an attacker cannot redirect license RPCs to a localhost mock server.
/// - In **Debug/Test** builds (`debug_assertions`), env overrides remain available for local CI.
pub fn get_supabase_config() -> Option<(String, String)> {
    #[cfg(debug_assertions)]
    let (url, key) = {
        let u = std::env::var("VOXLAB_SUPABASE_URL")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| super::obf::decode_supabase_url().as_str_lossy().into_owned());
        let k = std::env::var("VOXLAB_SUPABASE_ANON_KEY")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| super::obf::decode_supabase_anon_key().as_str_lossy().into_owned());
        (u, k)
    };

    #[cfg(not(debug_assertions))]
    let (url, key) = {
        let u = super::obf::decode_supabase_url().as_str_lossy().into_owned();
        let k = super::obf::decode_supabase_anon_key().as_str_lossy().into_owned();
        (u, k)
    };

    let clean_url = url.trim().trim_end_matches('/').to_string();
    let clean_key = key.trim().to_string();

    if clean_url.is_empty() || clean_key.is_empty() {
        return None;
    }

    // Enforce HTTPS transport strictly in Release builds (prevents plaintext HTTP downgrade).
    #[cfg(not(debug_assertions))]
    if !clean_url.to_ascii_lowercase().starts_with("https://") {
        return None;
    }

    Some((clean_url, clean_key))
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RpcLicenseRequest<'a> {
    pub p_license_key: &'a str,
    pub p_hwid: &'a str,
    pub p_hwid_version: u32,
    pub p_legacy_candidates: &'a [String],
    pub p_app_version: &'a str,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RpcLicenseResponse {
    pub valid: Option<bool>,
    pub status: String,
    pub license_type: Option<String>,
    pub expires_at: Option<u64>,
    pub expired_at: Option<String>,
    pub device_count: Option<u32>,
    pub max_devices: Option<u32>,
    pub message: Option<String>,
}

fn classify_http_error(code: u16) -> (&'static str, &'static str) {
    if code == 408 || code == 429 || code >= 500 {
        (
            "SERVER_ERROR",
            "Lỗi máy chủ bản quyền tạm thời. Vui lòng thử lại sau.",
        )
    } else if code == 401 || code == 403 {
        (
            "AUTH_ERROR",
            "Lỗi xác thực máy chủ bản quyền. Vui lòng liên hệ hỗ trợ.",
        )
    } else {
        (
            "CLIENT_CONFIG_ERROR",
            "Lỗi cấu hình máy chủ bản quyền. Vui lòng cập nhật phần mềm hoặc liên hệ hỗ trợ.",
        )
    }
}

/// Calls Supabase RPC via `ureq` with proxy-environment injection disabled (`try_proxy_from_env(false)`).
/// RPC path is decoded on demand from polymorphic compile-time storage and zeroized immediately.
pub fn verify_with_server(
    supabase_url: &str,
    anon_key: &str,
    license_key: &str,
    hwid: &str,
    hwid_version: u32,
    legacy_candidates: &[String],
    app_version: &str,
) -> Result<RpcLicenseResponse, String> {
    #[cfg(not(debug_assertions))]
    if !supabase_url.to_ascii_lowercase().starts_with("https://") {
        return Ok(RpcLicenseResponse {
            valid: Some(false),
            status: "CLIENT_CONFIG_ERROR".to_string(),
            license_type: None,
            expires_at: None,
            expired_at: None,
            device_count: None,
            max_devices: None,
            message: Some("Giao thức kết nối máy chủ bản quyền không hợp lệ.".to_string()),
        });
    }

    let rpc_path = super::obf::decode_rpc_activate_path();
    let url = format!(
        "{}{}",
        supabase_url.trim_end_matches('/'),
        rpc_path.as_str_lossy()
    );
    drop(rpc_path);

    let request_body = RpcLicenseRequest {
        p_license_key: license_key,
        p_hwid: hwid,
        p_hwid_version: hwid_version,
        p_legacy_candidates: legacy_candidates,
        p_app_version: app_version,
    };

    // Disable automatic HTTP_PROXY / HTTPS_PROXY environment variable pickup so Fiddler/mitmproxy
    // env-injection cannot silently hijack license verification traffic.
    let agent = ureq::AgentBuilder::new()
        .try_proxy_from_env(false)
        .timeout(std::time::Duration::from_secs(10))
        .build();

    let mut auth_header = format!("Bearer {}", anon_key);
    let response = agent
        .post(&url)
        .set("apikey", anon_key)
        .set("Authorization", &auth_header)
        .set("Content-Type", "application/json")
        .send_json(&request_body);

    // Wipe temporary Bearer token string from heap
    unsafe {
        for b in auth_header.as_bytes_mut() {
            std::ptr::write_volatile(b, 0);
        }
    }

    match response {
        Ok(res) => {
            let rpc_res: RpcLicenseResponse = res
                .into_json()
                .map_err(|_| "Phản hồi từ máy chủ bản quyền không hợp lệ.".to_string())?;
            Ok(rpc_res)
        }
        Err(ureq::Error::Status(code, _res)) => {
            let (status, msg) = classify_http_error(code);
            Ok(RpcLicenseResponse {
                valid: Some(false),
                status: status.to_string(),
                license_type: None,
                expires_at: None,
                expired_at: None,
                device_count: None,
                max_devices: None,
                message: Some(format!("{} (HTTP {})", msg, code)),
            })
        }
        Err(ureq::Error::Transport(_transport_err)) => Ok(RpcLicenseResponse {
            valid: Some(false),
            status: "NETWORK_ERROR".to_string(),
            license_type: None,
            expires_at: None,
            expired_at: None,
            device_count: None,
            max_devices: None,
            message: Some(
                "Lỗi kết nối kiểm tra bản quyền. Vui lòng kiểm tra mạng Internet và thử lại."
                    .to_string(),
            ),
        }),
    }
}
