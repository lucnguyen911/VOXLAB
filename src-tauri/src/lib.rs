use tauri::Manager;

#[tauri::command]
fn get_app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

fn safe_app_data_path(base_dir: &std::path::Path, relative_path: &str) -> Result<std::path::PathBuf, String> {
    let rel = std::path::Path::new(relative_path);
    if rel.is_absolute() {
        return Err("relative_path must not be absolute".to_string());
    }
    if rel.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err("relative_path must not contain '..'".to_string());
    }
    let resolved = base_dir.join(rel);
    if security::license_storage::is_protected_vault_path(&resolved) {
        return Err("ACCESS_DENIED: Truy cập trực tiếp tệp kho khóa bảo mật bị từ chối.".to_string());
    }
    Ok(resolved)
}

#[tauri::command]
fn save_app_data_file(
    app: tauri::AppHandle,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    let base_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let target_path = safe_app_data_path(&base_dir, &relative_path)?;
    // Atomic: temp file + fsync + rename-over (target never deleted first).
    fsio::atomic_write(&target_path, content.as_bytes())
}

#[tauri::command]
fn read_app_data_file(app: tauri::AppHandle, relative_path: String) -> Result<String, String> {
    let base_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let target_path = safe_app_data_path(&base_dir, &relative_path)?;
    std::fs::read_to_string(&target_path).map_err(|e| e.to_string())
}

pub mod fsio;

pub mod security;

use security::{LicenseSummary, SecurityService, APP_VERSION};

#[tauri::command]
fn get_license_summary(app: tauri::AppHandle) -> Result<LicenseSummary, String> {
    let base_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(SecurityService::get_summary(&base_dir))
}

#[tauri::command]
async fn activate_license(app: tauri::AppHandle, license_key: String) -> Result<LicenseSummary, String> {
    let base_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        SecurityService::activate(&base_dir, &license_key, APP_VERSION)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn verify_license(app: tauri::AppHandle) -> Result<LicenseSummary, String> {
    let base_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        SecurityService::verify(&base_dir, APP_VERSION)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn change_license_key(app: tauri::AppHandle, new_license_key: String) -> Result<LicenseSummary, String> {
    let base_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        SecurityService::change_key(&base_dir, &new_license_key, APP_VERSION)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn clear_local_license_if_allowed(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(debug_assertions))]
    {
        let _ = app;
        return Err("Thao tác xóa bộ nhớ đệm bản quyền trực tiếp bị khóa ở bản thương mại.".to_string());
    }
    #[cfg(debug_assertions)]
    {
        let base_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        security::license_storage::clear_license_cache(&base_dir)
    }
}

#[tauri::command]
fn exit_application(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn save_gemini_keys_secure(app: tauri::AppHandle, payload_json: String) -> Result<(), String> {
    let base_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    SecurityService::require_commercial_access_if_enabled(&base_dir, "vault.save_gemini_keys")?;
    security::license_storage::save_encrypted_secret_file(
        &base_dir,
        security::license_storage::GEMINI_KEYS_VAULT_FILE,
        &payload_json,
    )
}

#[tauri::command]
fn load_gemini_keys_secure(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let base_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    SecurityService::require_commercial_access_if_enabled(&base_dir, "vault.load_gemini_keys")?;
    security::license_storage::load_encrypted_secret_file(
        &base_dir,
        security::license_storage::GEMINI_KEYS_VAULT_FILE,
    )
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct NativeHttpResponse {
    pub status: u16,
    pub status_text: String,
    pub body: String,
    pub retry_after: Option<String>,
}

struct HttpCancelState {
    cancelled: std::sync::Arc<std::sync::atomic::AtomicBool>,
    abort_tx: Option<std::sync::mpsc::Sender<Result<NativeHttpResponse, String>>>,
}

fn http_cancel_registry() -> &'static std::sync::Mutex<std::collections::HashMap<String, HttpCancelState>> {
    static REGISTRY: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, HttpCancelState>>> =
        std::sync::OnceLock::new();
    REGISTRY.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

#[tauri::command]
fn cancel_native_http_request(request_id: String) -> Result<bool, String> {
    let trimmed = request_id.trim().to_string();
    if trimmed.is_empty() {
        return Ok(false);
    }
    let mut guard = http_cancel_registry()
        .lock()
        .map_err(|_| "HTTP cancel registry poisoned".to_string())?;
    if let Some(entry) = guard.get_mut(&trimmed) {
        entry.cancelled.store(true, std::sync::atomic::Ordering::SeqCst);
        if let Some(tx) = entry.abort_tx.take() {
            let _ = tx.send(Err("CANCELLED: Request aborted by user.".to_string()));
        }
        return Ok(true);
    }
    // Pre-register cancellation if cancel arrived before request started
    guard.insert(
        trimmed,
        HttpCancelState {
            cancelled: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true)),
            abort_tx: None,
        },
    );
    Ok(true)
}

#[tauri::command]
async fn native_http_request(
    app: tauri::AppHandle,
    method: String,
    url: String,
    headers: std::collections::HashMap<String, String>,
    body: Option<String>,
    timeout_sec: Option<u64>,
    request_id: Option<String>,
) -> Result<NativeHttpResponse, String> {
    let base_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    SecurityService::require_commercial_access_if_enabled(&base_dir, "http.native_request")?;
    let req_id = request_id
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let (tx, rx) = std::sync::mpsc::channel::<Result<NativeHttpResponse, String>>();
    let cancelled_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

    if let Some(ref id) = req_id {
        if let Ok(mut guard) = http_cancel_registry().lock() {
            if let Some(existing) = guard.get(id) {
                if existing.cancelled.load(std::sync::atomic::Ordering::SeqCst) {
                    guard.remove(id);
                    return Err("CANCELLED: Request aborted by user.".to_string());
                }
            }
            guard.insert(
                id.clone(),
                HttpCancelState {
                    cancelled: cancelled_flag.clone(),
                    abort_tx: Some(tx.clone()),
                },
            );
        }
    }

    let worker_cancelled = cancelled_flag.clone();
    let worker_req_id = req_id.clone();
    std::thread::spawn(move || {
        if worker_cancelled.load(std::sync::atomic::Ordering::SeqCst) {
            let _ = tx.send(Err("CANCELLED: Request aborted by user.".to_string()));
            return;
        }
        let timeout = std::time::Duration::from_secs(timeout_sec.unwrap_or(60));
        let agent = ureq::AgentBuilder::new().timeout(timeout).build();
        let mut req = agent.request(&method, &url);
        for (k, v) in headers {
            req = req.set(&k, &v);
        }
        let res = if let Some(b) = body {
            req.send_string(&b)
        } else {
            req.call()
        };

        if worker_cancelled.load(std::sync::atomic::Ordering::SeqCst) {
            let _ = tx.send(Err("CANCELLED: Request aborted by user.".to_string()));
            return;
        }

        let outcome = match res {
            Ok(response) => {
                let status = response.status();
                let status_text = response.status_text().to_string();
                let retry_after = response.header("retry-after").map(|s| s.to_string());
                let body = response.into_string().unwrap_or_default();
                if worker_cancelled.load(std::sync::atomic::Ordering::SeqCst) {
                    Err("CANCELLED: Request aborted by user.".to_string())
                } else {
                    Ok(NativeHttpResponse {
                        status,
                        status_text,
                        body,
                        retry_after,
                    })
                }
            }
            Err(ureq::Error::Status(code, response)) => {
                let status_text = response.status_text().to_string();
                let retry_after = response.header("retry-after").map(|s| s.to_string());
                let body = response.into_string().unwrap_or_default();
                if worker_cancelled.load(std::sync::atomic::Ordering::SeqCst) {
                    Err("CANCELLED: Request aborted by user.".to_string())
                } else {
                    Ok(NativeHttpResponse {
                        status: code,
                        status_text,
                        body,
                        retry_after,
                    })
                }
            }
            Err(e) => Err(e.to_string()),
        };

        let _ = tx.send(outcome);
        if let Some(id) = worker_req_id {
            if let Ok(mut guard) = http_cancel_registry().lock() {
                guard.remove(&id);
            }
        }
    });

    let wait_res = tauri::async_runtime::spawn_blocking(move || {
        rx.recv()
            .unwrap_or_else(|_| Err("HTTP worker channel closed unexpectedly".to_string()))
    })
    .await
    .map_err(|e| e.to_string())?;

    if let Some(id) = req_id {
        if let Ok(mut guard) = http_cancel_registry().lock() {
            guard.remove(&id);
        }
    }

    wait_res
}

pub mod ai;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(debug_assertions)]
            eprintln!("[voxlab] setup hook entered");
            let state = ai::init(app.handle());
            app.manage(state);
            for (label, win) in app.webview_windows() {
                #[cfg(debug_assertions)]
                eprintln!("[voxlab] window found: {} (visible: {:?})", label, win.is_visible());
                let _ = label;
                let _ = win.show();
                let _ = win.set_focus();
            }
            #[cfg(debug_assertions)]
            eprintln!("[voxlab] setup hook finished");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_data_dir,
            save_app_data_file,
            read_app_data_file,
            get_license_summary,
            activate_license,
            verify_license,
            change_license_key,
            clear_local_license_if_allowed,
            exit_application,
            save_gemini_keys_secure,
            load_gemini_keys_secure,
            native_http_request,
            cancel_native_http_request,
            ai::ai_request,
            ai::ai_cancel,
            ai::ai_shutdown,
            ai::ai_status,
            ai::ai_models_dir,
            ai::ai_scan_models,
            fsio::fs_write_text,
            fsio::fs_write_bytes,
            fsio::fs_read_text,
            fsio::fs_list_dir,
            fsio::fs_exists,
            fsio::fs_stat,
            fsio::fs_remove_file,
            fsio::fs_scratch_dir,
            fsio::fs_read_bytes,
            fsio::fs_probe_wav_header,
            fsio::fs_show_in_folder
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(|handle, event| {
        #[cfg(debug_assertions)]
        eprintln!("[voxlab] run event: {:?}", event);
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = handle.try_state::<ai::AiState>() {
                state.0.shutdown_all();
            }
        }
    });
}
