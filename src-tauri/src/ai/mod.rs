pub mod models;
pub mod sidecar;

use serde_json::Value;
use sidecar::{default_resolver, AiError, ProgressEvent, RuntimeStatus, SidecarManager};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct AiState(pub Arc<SidecarManager>);

/// Dev builds run the sidecar from `<repo>/sidecar/<venv>`; release builds use bundled binaries.
fn sidecar_root() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("VOXLAB_SIDECAR_ROOT") {
        return Some(PathBuf::from(p));
    }
    if cfg!(debug_assertions) {
        return Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("sidecar"));
    }
    None
}

pub fn init(app: &AppHandle) -> AiState {
    let handle = app.clone();
    let sink = Arc::new(move |e: ProgressEvent| {
        let _ = handle.emit("ai://progress", e);
    });
    AiState(Arc::new(SidecarManager::new(default_resolver(sidecar_root()), sink)))
}

/// Generic sidecar request. Runs on a blocking thread so the UI thread is never blocked.
#[tauri::command]
pub async fn ai_request(
    state: State<'_, AiState>,
    runtime: String,
    method: String,
    params: Value,
    request_id: Option<String>,
) -> Result<Value, AiError> {
    let mgr = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || mgr.request(&runtime, &method, params, request_id))
        .await
        .map_err(|e| AiError::new("INTERNAL", e.to_string()))?
}

#[tauri::command]
pub async fn ai_cancel(state: State<'_, AiState>, runtime: String, request_id: String, hard: bool) -> Result<bool, AiError> {
    let mgr = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || mgr.cancel(&runtime, &request_id, hard))
        .await
        .map_err(|e| AiError::new("INTERNAL", e.to_string()))?
}

#[tauri::command]
pub async fn ai_shutdown(state: State<'_, AiState>, runtime: Option<String>) -> Result<(), AiError> {
    let mgr = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || match runtime {
        Some(r) => mgr.shutdown(&r),
        None => mgr.shutdown_all(),
    })
    .await
    .map_err(|e| AiError::new("INTERNAL", e.to_string()))
}

#[tauri::command]
pub fn ai_status(state: State<'_, AiState>) -> Vec<RuntimeStatus> {
    state.0.status()
}

#[tauri::command]
pub fn ai_models_dir(app: AppHandle) -> Result<String, AiError> {
    let dir = app.path().app_data_dir().map_err(|e| AiError::new("INTERNAL", e.to_string()))?.join("models");
    std::fs::create_dir_all(&dir).map_err(|e| AiError::new("INTERNAL", e.to_string()))?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn ai_scan_models(app: AppHandle, models_dir: Option<String>) -> Result<Vec<models::ModelStatus>, AiError> {
    let dir = match models_dir {
        Some(d) if !d.trim().is_empty() => PathBuf::from(d),
        _ => PathBuf::from(ai_models_dir(app)?),
    };
    Ok(models::scan(&dir))
}
