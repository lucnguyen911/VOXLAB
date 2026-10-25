use serde::{Deserialize, Serialize};

/// Retrieves Supabase URL and anon key from runtime environment or compile-time `.env.local`
/// injected by `src-tauri/build.rs`. Zero static secrets in git-tracked source code.
pub fn get_supabase_config() -> Option<(String, String)> {
    let url = std::env::var("VOXLAB_SUPABASE_URL")
        .ok()
        .or_else(|| option_env!("VOXLAB_SUPABASE_URL").map(String::from));
    let key = std::env::var("VOXLAB_SUPABASE_ANON_KEY")
        .ok()
        .or_else(|| option_env!("VOXLAB_SUPABASE_ANON_KEY").map(String::from));

    match (url, key) {
        (Some(u), Some(k)) if !u.trim().is_empty() && !k.trim().is_empty() => {
            Some((u.trim().trim_end_matches('/').to_string(), k.trim().to_string()))
        }
        _ => None,
    }
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

/// Calls Supabase RPC `activate_or_verify_voxlab_license_v3` via ureq (Security v3).
/// Classifies HTTP 4xx vs 5xx vs transport errors cleanly so client/auth errors never grant Offline Grace.
pub fn verify_with_server(
    supabase_url: &str,
    anon_key: &str,
    license_key: &str,
    hwid: &str,
    hwid_version: u32,
    legacy_candidates: &[String],
    app_version: &str,
) -> Result<RpcLicenseResponse, String> {
    let url = format!(
        "{}/rest/v1/rpc/activate_or_verify_voxlab_license_v3",
        supabase_url.trim_end_matches('/')
    );

    let request_body = RpcLicenseRequest {
        p_license_key: license_key,
        p_hwid: hwid,
        p_hwid_version: hwid_version,
        p_legacy_candidates: legacy_candidates,
        p_app_version: app_version,
    };

    let response = ureq::post(&url)
        .set("apikey", anon_key)
        .set("Authorization", &format!("Bearer {}", anon_key))
        .set("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(10))
        .send_json(&request_body);

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
