use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

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
    Ok(base_dir.join(rel))
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
fn activate_license(app: tauri::AppHandle, license_key: String) -> Result<LicenseSummary, String> {
    let base_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    SecurityService::activate(&base_dir, &license_key, APP_VERSION)
}

#[tauri::command]
fn verify_license(app: tauri::AppHandle) -> Result<LicenseSummary, String> {
    let base_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    SecurityService::verify(&base_dir, APP_VERSION)
}

#[tauri::command]
fn change_license_key(app: tauri::AppHandle, new_license_key: String) -> Result<LicenseSummary, String> {
    let base_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    SecurityService::change_key(&base_dir, &new_license_key, APP_VERSION)
}

#[tauri::command]
fn clear_local_license_if_allowed(app: tauri::AppHandle) -> Result<(), String> {
    let base_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    security::license_storage::clear_license_cache(&base_dir)
}

pub mod ai;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            eprintln!("[voxlab] setup hook entered");
            let state = ai::init(app.handle());
            app.manage(state);
            for (label, win) in app.webview_windows() {
                eprintln!("[voxlab] window found: {} (visible: {:?})", label, win.is_visible());
                let _ = win.show();
                let _ = win.set_focus();
            }
            eprintln!("[voxlab] setup hook finished");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_app_data_dir,
            save_app_data_file,
            read_app_data_file,
            get_license_summary,
            activate_license,
            verify_license,
            change_license_key,
            clear_local_license_if_allowed,
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
            fsio::fs_show_in_folder
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(|handle, event| {
        eprintln!("[voxlab] run event: {:?}", event);
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = handle.try_state::<ai::AiState>() {
                state.0.shutdown_all();
            }
        }
    });
}
