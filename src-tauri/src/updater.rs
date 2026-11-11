//! Commercial application auto-updater aligned with Audio Factory (`MMO-TOOL-Manager`).
//!
//! Queries `public.get_active_app_version_v3(p_app_id => 'voxlab')` over HTTPS using the
//! compile-time obfuscated Supabase configuration, compares semantic versions (`optional` vs `forced`
//! + `minimum_supported_version`), downloads the installer via multi-stream HTTP `Range` acceleration,
//! verifies `file_size`, `sha256`, and Windows PE/MSI header, cleanly shuts down AI sidecars so no
//! files remain locked, launches the installer, and exits the running process.

use crate::ai::fast_dl::{download_file_accelerated, FastDlError};
use crate::security::{license_client, APP_VERSION};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::io::Read;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

pub const VOXLAB_APP_ID: &str = "voxlab";

static UPDATE_CANCELLED: OnceLock<AtomicBool> = OnceLock::new();

fn cancel_flag() -> &'static AtomicBool {
    UPDATE_CANCELLED.get_or_init(|| AtomicBool::new(false))
}

#[derive(Debug, Clone, Deserialize)]
pub struct RemoteAppVersionRecord {
    pub app_id: Option<String>,
    pub latest_version: String,
    pub download_url: String,
    pub changelog: Option<String>,
    pub minimum_supported_version: Option<String>,
    #[serde(default)]
    pub enforcement: String,
    pub sha256: Option<String>,
    pub file_size: Option<i64>,
    pub is_active: Option<bool>,
    pub published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub is_forced: bool,
    pub download_url: Option<String>,
    pub changelog: Option<String>,
    pub sha256: Option<String>,
    pub file_size: Option<u64>,
    pub published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateProgressEvent {
    pub stage: &'static str, // "downloading" | "verifying" | "launching" | "error"
    pub pct: u8,
    pub downloaded_mb: f64,
    pub total_mb: f64,
    pub speed_mbps: f64,
    pub message: String,
}

/// Parses a semantic version string (e.g. `"v1.0.9"`, `"1.2.0-beta.1"`) into numeric components.
pub fn parse_semver_parts(raw: &str) -> Vec<u64> {
    let trimmed = raw
        .trim()
        .trim_start_matches(['v', 'V'])
        .split(['-', '+'])
        .next()
        .unwrap_or("");
    let mut parts: Vec<u64> = trimmed
        .split('.')
        .filter(|s| !s.is_empty())
        .map(|seg| seg.trim().parse::<u64>().unwrap_or(0))
        .collect();
    while parts.len() < 3 {
        parts.push(0);
    }
    parts
}

pub fn compare_semver(a: &str, b: &str) -> Ordering {
    let pa = parse_semver_parts(a);
    let pb = parse_semver_parts(b);
    let max_len = pa.len().max(pb.len());
    for i in 0..max_len {
        let va = pa.get(i).copied().unwrap_or(0);
        let vb = pb.get(i).copied().unwrap_or(0);
        match va.cmp(&vb) {
            Ordering::Equal => continue,
            non_eq => return non_eq,
        }
    }
    Ordering::Equal
}

pub fn evaluate_remote_version(
    current_version: &str,
    remote: Option<RemoteAppVersionRecord>,
) -> UpdateCheckResult {
    let Some(rec) = remote else {
        return UpdateCheckResult {
            current_version: current_version.to_string(),
            latest_version: current_version.to_string(),
            update_available: false,
            is_forced: false,
            download_url: None,
            changelog: None,
            sha256: None,
            file_size: None,
            published_at: None,
        };
    };

    if rec.is_active == Some(false) || rec.latest_version.trim().is_empty() {
        return UpdateCheckResult {
            current_version: current_version.to_string(),
            latest_version: current_version.to_string(),
            update_available: false,
            is_forced: false,
            download_url: None,
            changelog: None,
            sha256: None,
            file_size: None,
            published_at: None,
        };
    }

    let latest_clean = rec.latest_version.trim().trim_start_matches(['v', 'V']).to_string();
    let url_clean = rec.download_url.trim().to_string();
    let update_available =
        !url_clean.is_empty() && compare_semver(&latest_clean, current_version) == Ordering::Greater;

    let below_minimum = rec
        .minimum_supported_version
        .as_deref()
        .map(|m| !m.trim().is_empty() && compare_semver(current_version, m) == Ordering::Less)
        .unwrap_or(false);

    let is_forced =
        update_available && (rec.enforcement.trim().eq_ignore_ascii_case("forced") || below_minimum);

    UpdateCheckResult {
        current_version: current_version.to_string(),
        latest_version: latest_clean,
        update_available,
        is_forced,
        download_url: if url_clean.is_empty() { None } else { Some(url_clean) },
        changelog: rec.changelog.map(|c| c.trim().to_string()).filter(|c| !c.is_empty()),
        sha256: rec
            .sha256
            .map(|s| s.trim().to_ascii_lowercase())
            .filter(|s| !s.is_empty()),
        file_size: rec.file_size.and_then(|sz| u64::try_from(sz).ok()).filter(|&sz| sz > 0),
        published_at: rec.published_at,
    }
}

fn fetch_active_version_blocking() -> Result<Option<RemoteAppVersionRecord>, String> {
    let (supabase_url, anon_key) = license_client::get_supabase_config()
        .ok_or_else(|| "Chưa cấu hình kết nối máy chủ cập nhật.".to_string())?;

    let rpc_path = crate::security::obf::decode_rpc_app_version_path();
    let mut endpoint = format!(
        "{}{}",
        supabase_url.trim_end_matches('/'),
        rpc_path.as_str_lossy()
    );

    let agent = ureq::AgentBuilder::new()
        .try_proxy_from_env(false)
        .timeout(Duration::from_secs(12))
        .build();

    let mut auth_header = format!("Bearer {}", anon_key);
    let resp = agent
        .post(&endpoint)
        .set("apikey", &anon_key)
        .set("Authorization", &auth_header)
        .set("Content-Type", "application/json")
        .send_json(serde_json::json!({ "p_app_id": VOXLAB_APP_ID }));

    // Zeroize temporary endpoint & Authorization header buffers
    unsafe {
        for b in endpoint.as_bytes_mut() {
            std::ptr::write_volatile(b, 0);
        }
        for b in auth_header.as_bytes_mut() {
            std::ptr::write_volatile(b, 0);
        }
    }

    match resp {
        Ok(r) => {
            let val: serde_json::Value = r
                .into_json()
                .map_err(|_| "Phản hồi máy chủ cập nhật không đúng định dạng.".to_string())?;
            if val.is_null() {
                return Ok(None);
            }
            let rec: RemoteAppVersionRecord = serde_json::from_value(val)
                .map_err(|_| "Không thể đọc thông tin phiên bản mới từ máy chủ.".to_string())?;
            Ok(Some(rec))
        }
        Err(ureq::Error::Status(code, _)) => Err(format!(
            "Máy chủ cập nhật phản hồi mã lỗi HTTP {}.",
            code
        )),
        Err(_) => Err("Không thể kết nối máy chủ cập nhật. Vui lòng kiểm tra mạng Internet.".to_string()),
    }
}

fn verify_installer_binary_signature(path: &Path, is_msi: bool) -> Result<(), String> {
    let mut f = std::fs::File::open(path)
        .map_err(|e| format!("Không thể mở gói cài đặt vừa tải: {}", e))?;
    let mut magic = [0u8; 8];
    let n = f
        .read(&mut magic)
        .map_err(|e| format!("Không thể đọc tiêu đề gói cài đặt: {}", e))?;
    if is_msi {
        // Compound File Binary Format (OLE2 MSI): D0 CF 11 E0 A1 B1 1A E1
        if n < 8 || magic != [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1] {
            return Err("Gói cập nhật (.msi) tải về không hợp lệ hoặc bị hỏng.".to_string());
        }
    } else if n < 2 || &magic[0..2] != b"MZ" {
        return Err("Gói cập nhật (.exe) tải về không hợp lệ hoặc bị hỏng.".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn check_app_update() -> Result<UpdateCheckResult, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let remote = fetch_active_version_blocking()?;
        Ok(evaluate_remote_version(APP_VERSION, remote))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn cancel_app_update_download() -> bool {
    cancel_flag().store(true, AtomicOrdering::SeqCst);
    true
}

#[tauri::command]
pub async fn download_and_install_update(
    app: AppHandle,
    state: State<'_, crate::ai::AiState>,
) -> Result<(), String> {
    cancel_flag().store(false, AtomicOrdering::SeqCst);

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Không thể xác định thư mục dữ liệu ứng dụng: {}", e))?;

    let sidecar_mgr = state.0.clone();
    let app_handle = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let remote = fetch_active_version_blocking()?;
        let eval = evaluate_remote_version(APP_VERSION, remote);
        if !eval.update_available {
            return Err("Hiện không có bản cập nhật mới cần cài đặt.".to_string());
        }

        let download_url = eval
            .download_url
            .ok_or_else(|| "Đường dẫn tải bản cập nhật không hợp lệ.".to_string())?;

        #[cfg(not(debug_assertions))]
        if !download_url.to_ascii_lowercase().starts_with("https://") {
            return Err("Đường dẫn tải cập nhật bắt buộc phải dùng giao thức bảo mật HTTPS.".to_string());
        }

        let is_msi = download_url
            .split(['?', '#'])
            .next()
            .unwrap_or(&download_url)
            .to_ascii_lowercase()
            .ends_with(".msi");
        let ext = if is_msi { "msi" } else { "exe" };
        let safe_ver: String = eval
            .latest_version
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' { c } else { '_' })
            .collect();
        let updates_dir = app_data.join("scratch").join("updates");
        let installer_path = updates_dir.join(format!("VoxLab_Setup_v{}.{}", safe_ver, ext));

        let _ = app_handle.emit(
            "app://update-progress",
            AppUpdateProgressEvent {
                stage: "downloading",
                pct: 1,
                downloaded_mb: 0.0,
                total_mb: eval.file_size.unwrap_or(0) as f64 / (1024.0 * 1024.0),
                speed_mbps: 0.0,
                message: format!("Đang kết nối tải bản cập nhật v{}...", eval.latest_version),
            },
        );

        let emit_handle = app_handle.clone();
        let ver_for_cb = eval.latest_version.clone();
        let downloaded_bytes = download_file_accelerated(
            &download_url,
            &installer_path,
            eval.file_size,
            eval.sha256.as_deref(),
            cancel_flag(),
            move |done, total, mbps| {
                let done_mb = done as f64 / (1024.0 * 1024.0);
                let total_mb = total as f64 / (1024.0 * 1024.0);
                let pct = if total > 0 {
                    ((done as f64 / total as f64) * 96.0).round().clamp(1.0, 96.0) as u8
                } else {
                    50
                };
                let _ = emit_handle.emit(
                    "app://update-progress",
                    AppUpdateProgressEvent {
                        stage: "downloading",
                        pct,
                        downloaded_mb: (done_mb * 10.0).round() / 10.0,
                        total_mb: (total_mb * 10.0).round() / 10.0,
                        speed_mbps: (mbps * 10.0).round() / 10.0,
                        message: format!("Đang tải VoxLab v{}...", ver_for_cb),
                    },
                );
            },
        )
        .map_err(|err| match err {
            FastDlError::Cancelled => "CANCELLED: Đã hủy tải bản cập nhật.".to_string(),
            FastDlError::HashMismatch { .. } => {
                "Mã kiểm tra toàn vẹn SHA-256 không khớp. Gói tải về đã bị loại bỏ để bảo vệ an toàn."
                    .to_string()
            }
            FastDlError::Network(m) => format!("Lỗi mạng khi tải bản cập nhật: {}", m),
            FastDlError::Io(m) => format!("Lỗi ghi tệp bản cập nhật: {}", m),
            FastDlError::RangeUnsupported => "Máy chủ không hỗ trợ tải tệp cập nhật.".to_string(),
        })?;

        if let Some(expected_sz) = eval.file_size {
            if expected_sz > 0 && downloaded_bytes != expected_sz {
                let _ = std::fs::remove_file(&installer_path);
                return Err(format!(
                    "Dung lượng gói cập nhật không khớp (nhận {} byte, kỳ vọng {} byte).",
                    downloaded_bytes, expected_sz
                ));
            }
        }

        let _ = app_handle.emit(
            "app://update-progress",
            AppUpdateProgressEvent {
                stage: "verifying",
                pct: 98,
                downloaded_mb: (downloaded_bytes as f64 / (1024.0 * 1024.0) * 10.0).round() / 10.0,
                total_mb: (downloaded_bytes as f64 / (1024.0 * 1024.0) * 10.0).round() / 10.0,
                speed_mbps: 0.0,
                message: "Đang kiểm tra chữ ký định dạng và đóng tiến trình nền...".to_string(),
            },
        );

        if let Err(e) = verify_installer_binary_signature(&installer_path, is_msi) {
            let _ = std::fs::remove_file(&installer_path);
            return Err(e);
        }

        // Shut down all Python AI sidecars so zero binaries/DLLs inside the app folder are locked
        sidecar_mgr.shutdown_all();

        let _ = app_handle.emit(
            "app://update-progress",
            AppUpdateProgressEvent {
                stage: "launching",
                pct: 100,
                downloaded_mb: (downloaded_bytes as f64 / (1024.0 * 1024.0) * 10.0).round() / 10.0,
                total_mb: (downloaded_bytes as f64 / (1024.0 * 1024.0) * 10.0).round() / 10.0,
                speed_mbps: 0.0,
                message: "Đang khởi chạy trình cài đặt phiên bản mới...".to_string(),
            },
        );

        let (program, args) = build_installer_launch_spec(&installer_path, is_msi);
        let spawn_res = Command::new(&program).args(&args).spawn();

        spawn_res.map_err(|e| format!("Không thể khởi chạy bộ cài đặt cập nhật: {}", e))?;

        let exit_handle = app_handle.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(400));
            exit_handle.exit(0);
        });

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Builds the OS command and arguments to install an update in-place without interactive
/// "Already Installed" / uninstall prompts, then automatically relaunch VoxLab (for NSIS).
pub fn build_installer_launch_spec(
    installer_path: &Path,
    is_msi: bool,
) -> (std::ffi::OsString, Vec<std::ffi::OsString>) {
    if is_msi {
        (
            std::ffi::OsString::from("msiexec"),
            vec![
                std::ffi::OsString::from("/i"),
                installer_path.as_os_str().to_os_string(),
                std::ffi::OsString::from("/passive"),
            ],
        )
    } else {
        (
            installer_path.as_os_str().to_os_string(),
            vec![
                std::ffi::OsString::from("/P"),
                std::ffi::OsString::from("/UPDATE"),
                std::ffi::OsString::from("/R"),
            ],
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installer_launch_spec_uses_passive_overwrite_and_relaunch_flags() {
        let exe_path = Path::new(r"C:\Users\test\AppData\Roaming\com.voxlab.app\scratch\updates\VoxLab_Setup_v1.0.2.exe");
        let (exe_prog, exe_args) = build_installer_launch_spec(exe_path, false);
        assert_eq!(exe_prog, exe_path.as_os_str());
        assert_eq!(
            exe_args,
            vec![
                std::ffi::OsString::from("/P"),
                std::ffi::OsString::from("/UPDATE"),
                std::ffi::OsString::from("/R"),
            ]
        );

        let msi_path = Path::new(r"C:\Users\test\AppData\Roaming\com.voxlab.app\scratch\updates\VoxLab_Setup_v1.0.2.msi");
        let (msi_prog, msi_args) = build_installer_launch_spec(msi_path, true);
        assert_eq!(msi_prog, std::ffi::OsString::from("msiexec"));
        assert_eq!(
            msi_args,
            vec![
                std::ffi::OsString::from("/i"),
                msi_path.as_os_str().to_os_string(),
                std::ffi::OsString::from("/passive"),
            ]
        );
    }

    #[test]
    fn semver_comparison_handles_prefixes_and_multidigit_versions() {
        assert_eq!(compare_semver("1.0.0", "v1.0.0"), Ordering::Equal);
        assert_eq!(compare_semver("1.0.10", "1.0.9"), Ordering::Greater);
        assert_eq!(compare_semver("2.0.0", "1.99.99"), Ordering::Greater);
        assert_eq!(compare_semver("1.0.0", "1.0.1"), Ordering::Less);
        assert_eq!(compare_semver("1.2", "1.2.0"), Ordering::Equal);
    }

    #[test]
    fn evaluate_remote_version_handles_up_to_date_optional_and_forced() {
        let none_res = evaluate_remote_version("1.0.0", None);
        assert!(!none_res.update_available);
        assert!(!none_res.is_forced);

        let same_ver = evaluate_remote_version(
            "1.0.0",
            Some(RemoteAppVersionRecord {
                app_id: Some("voxlab".into()),
                latest_version: "1.0.0".into(),
                download_url: "https://example.com/VoxLab_1.0.0.exe".into(),
                changelog: Some("Initial release".into()),
                minimum_supported_version: Some("1.0.0".into()),
                enforcement: "forced".into(),
                sha256: None,
                file_size: Some(150_000_000),
                is_active: Some(true),
                published_at: None,
            }),
        );
        assert!(!same_ver.update_available);
        assert!(!same_ver.is_forced);

        let opt_ver = evaluate_remote_version(
            "1.0.0",
            Some(RemoteAppVersionRecord {
                app_id: Some("voxlab".into()),
                latest_version: "v1.0.1".into(),
                download_url: "https://example.com/VoxLab_1.0.1.exe".into(),
                changelog: Some("Faster downloads".into()),
                minimum_supported_version: Some("1.0.0".into()),
                enforcement: "optional".into(),
                sha256: Some("ABCDEF1234".into()),
                file_size: Some(155_000_000),
                is_active: Some(true),
                published_at: None,
            }),
        );
        assert!(opt_ver.update_available);
        assert!(!opt_ver.is_forced);
        assert_eq!(opt_ver.latest_version, "1.0.1");
        assert_eq!(opt_ver.sha256.as_deref(), Some("abcdef1234"));

        // Forced via minimum_supported_version even when enforcement says "optional"
        let min_forced = evaluate_remote_version(
            "1.0.0",
            Some(RemoteAppVersionRecord {
                app_id: Some("voxlab".into()),
                latest_version: "1.2.0".into(),
                download_url: "https://example.com/VoxLab_1.2.0.exe".into(),
                changelog: None,
                minimum_supported_version: Some("1.1.0".into()),
                enforcement: "optional".into(),
                sha256: None,
                file_size: None,
                is_active: Some(true),
                published_at: None,
            }),
        );
        assert!(min_forced.update_available);
        assert!(min_forced.is_forced);
    }
}
