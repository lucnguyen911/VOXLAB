use serde::{Deserialize, Serialize};

// Default Supabase project configuration (anon key only, no service-role - LICENSE-AC-06)
pub const DEFAULT_SUPABASE_URL: &str = "https://voxlab-auth.supabase.co";
pub const DEFAULT_SUPABASE_ANON_KEY: &str = "sb_anon_public_voxlab_desktop_token";

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
