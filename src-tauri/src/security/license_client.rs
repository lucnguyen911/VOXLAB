use serde::{Deserialize, Serialize};

/// Retrieves Supabase URL and anon key from build-time or runtime environment.
/// Does NOT hardcode static secrets in source code (Gate E security requirement).
pub fn get_supabase_config() -> Option<(String, String)> {
    let url = std::env::var("VOXLAB_SUPABASE_URL")
        .ok()
        .or_else(|| option_env!("VOXLAB_SUPABASE_URL").map(String::from));
    let key = std::env::var("VOXLAB_SUPABASE_ANON_KEY")
        .ok()
        .or_else(|| option_env!("VOXLAB_SUPABASE_ANON_KEY").map(String::from));

    match (url, key) {
        (Some(u), Some(k)) if !u.trim().is_empty() && !k.trim().is_empty() => Some((u.trim().to_string(), k.trim().to_string())),
        _ => None,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RpcLicenseRequest<'a> {
    pub p_license_key: &'a str,
    pub p_hwid: &'a str,
    pub p_app_version: &'a str,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RpcLicenseResponse {
    pub status: String,
    pub license_type: Option<String>,
    pub expires_at: Option<u64>,
    pub message: Option<String>,
}

/// Calls Supabase RPC `activate_or_verify_license` via ureq (LICENSE-AC-05, LICENSE-AC-06).
pub fn verify_with_server(
    supabase_url: &str,
    anon_key: &str,
    license_key: &str,
    hwid: &str,
    app_version: &str,
) -> Result<RpcLicenseResponse, String> {
    let url = format!("{}/rest/v1/rpc/activate_or_verify_license", supabase_url.trim_end_matches('/'));

    let request_body = RpcLicenseRequest {
        p_license_key: license_key,
        p_hwid: hwid,
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
                .map_err(|e| format!("Failed to parse RPC JSON response: {}", e))?;
            Ok(rpc_res)
        }
        Err(ureq::Error::Status(code, res)) => {
            if code >= 500 {
                return Ok(RpcLicenseResponse {
                    status: "SERVER_ERROR".to_string(),
                    license_type: None,
                    expires_at: None,
                    message: Some(format!("Server returned HTTP {}", code)),
                });
            }
            let err_text = res.into_string().unwrap_or_default();
            Err(format!("HTTP Error {}: {}", code, err_text))
        }
        Err(ureq::Error::Transport(transport_err)) => {
            Ok(RpcLicenseResponse {
                status: "NETWORK_ERROR".to_string(),
                license_type: None,
                expires_at: None,
                message: Some(format!("Network connection failed: {}", transport_err)),
            })
        }
    }
}
