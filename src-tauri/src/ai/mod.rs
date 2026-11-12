pub mod fast_dl;
pub mod installer;
pub mod models;
pub mod sidecar;

use serde_json::Value;
use sidecar::{default_resolver, AiError, ProgressEvent, RuntimeStatus, SidecarManager};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

pub struct AiState(pub Arc<SidecarManager>);

/// Dev builds run the sidecar from `<repo>/sidecar/<venv>`; release builds strictly use
/// bundled binaries resolved relative to `current_exe()` (never overridden via env vars).
fn sidecar_root() -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    {
        if let Ok(p) = std::env::var("VOXLAB_SIDECAR_ROOT") {
            let trimmed = p.trim();
            if !trimmed.is_empty() {
                return Some(PathBuf::from(trimmed));
            }
        }
        return Some(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("sidecar"),
        );
    }
    #[cfg(not(debug_assertions))]
    {
        None
    }
}

/// Returns whether a sidecar method is a commercial AI operation subject to license guard.
/// System health checks (`system.ping`, `system.info`, `system.shutdown`, `tts.engines`) and
/// unload/probe cleanup (`tts.unload`, `asr.unload`, `audio.probe`) remain unblocked.
pub fn is_commercial_ai_method(method: &str) -> bool {
    if method == "tts.unload" || method == "asr.unload" || method == "tts.engines" {
        return false;
    }
    method.starts_with("tts.")
        || method.starts_with("asr.")
        || method == "audio.assemble"
        || method == "audio.enforce_punctuation_pauses"
        || method == "audio.validate_quality"
        || method == "subtitle.generate_srt"
        || method == "subtitle.optimize"
}

pub fn init(app: &AppHandle) -> AiState {
    let handle = app.clone();
    let sink = Arc::new(move |e: ProgressEvent| {
        let _ = handle.emit("ai://progress", e);
    });
    let storage_dir = crate::resolve_app_storage_dir(app).ok();
    AiState(Arc::new(SidecarManager::new_with_data_dir(
        default_resolver(sidecar_root()),
        sink,
        storage_dir,
    )))
}

/// Generic sidecar request. Runs on a blocking thread so the UI thread is never blocked.
/// Enforces centralized Rust-layer commercial license check for commercial AI methods when enabled.
#[tauri::command]
pub async fn ai_request(
    app: AppHandle,
    state: State<'_, AiState>,
    runtime: String,
    method: String,
    params: Value,
    request_id: Option<String>,
) -> Result<Value, AiError> {
    if is_commercial_ai_method(&method) {
        let base_dir = crate::resolve_app_storage_dir(&app)
            .unwrap_or_else(|_| std::env::temp_dir().join("voxlab_security"));
        crate::security::SecurityService::require_commercial_access_if_enabled(&base_dir, &method)
            .map_err(|msg| AiError::new("LICENSE_REQUIRED", msg))?;
    }

    let mgr = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || mgr.request(&runtime, &method, params, request_id))
        .await
        .map_err(|e| AiError::new("INTERNAL", e.to_string()))?
}

#[tauri::command]
pub async fn ai_cancel(
    state: State<'_, AiState>,
    runtime: String,
    request_id: String,
    hard: bool,
) -> Result<bool, AiError> {
    let mgr = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || mgr.cancel(&runtime, &request_id, hard))
        .await
        .map_err(|e| AiError::new("INTERNAL", e.to_string()))?
}

#[tauri::command]
pub async fn ai_shutdown(
    state: State<'_, AiState>,
    runtime: Option<String>,
) -> Result<(), AiError> {
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

/// Parses `<app_data>/settings/ai_runtime.json` and extracts a user-configured custom `modelsDir`
/// when `customModelsDir` is `true` and `modelsDir` is non-empty.
pub fn parse_custom_models_dir_from_json(raw_json: &str) -> Option<PathBuf> {
    let parsed: Value = serde_json::from_str(raw_json).ok()?;
    let is_custom = parsed.get("customModelsDir").and_then(|v| v.as_bool()).unwrap_or(false);
    if !is_custom {
        return None;
    }
    let dir_str = parsed.get("modelsDir").and_then(|v| v.as_str())?.trim();
    if dir_str.is_empty() {
        return None;
    }
    Some(PathBuf::from(dir_str))
}

fn resolve_configured_models_dir(
    app: &AppHandle,
    explicit_models_dir: Option<String>,
) -> Result<PathBuf, AiError> {
    if let Some(d) = explicit_models_dir {
        let trimmed = d.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }
    if let Ok(app_data) = crate::resolve_app_storage_dir(app) {
        let settings_file = app_data.join("settings").join("ai_runtime.json");
        if let Ok(raw) = std::fs::read_to_string(&settings_file) {
            if let Some(custom_dir) = parse_custom_models_dir_from_json(&raw) {
                return Ok(custom_dir);
            }
        }
    }
    Ok(PathBuf::from(ai_models_dir(app.clone())?))
}

#[tauri::command]
pub fn ai_models_dir(app: AppHandle) -> Result<String, AiError> {
    let dir = crate::resolve_app_storage_dir(&app)
        .map_err(|e| AiError::new("INTERNAL", e))?
        .join("models");
    std::fs::create_dir_all(&dir).map_err(|e| AiError::new("INTERNAL", e.to_string()))?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn ai_scan_models(
    app: AppHandle,
    models_dir: Option<String>,
) -> Result<Vec<models::ModelStatus>, AiError> {
    let app_data = crate::resolve_app_storage_dir(&app).ok();
    let dev_root = sidecar_root();
    let dir = resolve_configured_models_dir(&app, models_dir)?;
    Ok(models::scan_with_runtime(
        &dir,
        app_data.as_deref(),
        dev_root.as_deref(),
    ))
}

#[tauri::command]
pub fn ai_hardware_info() -> installer::HardwareAcceleratorInfo {
    installer::detect_hardware_accelerator()
}

#[tauri::command]
pub async fn ai_install_model(
    app: AppHandle,
    state: State<'_, AiState>,
    model_id: String,
    models_dir: Option<String>,
) -> Result<models::ModelStatus, AiError> {
    let app_data = crate::resolve_app_storage_dir(&app)
        .map_err(|e| AiError::new("INTERNAL", e))?;
    crate::security::SecurityService::require_commercial_access_if_enabled(
        &app_data,
        "ai.install_model",
    )
    .map_err(|msg| AiError::new("LICENSE_REQUIRED", msg))?;

    let spec = installer::find_model_spec(model_id.trim())?;
    let target_models_dir = resolve_configured_models_dir(&app, models_dir)?;
    let dev_root = sidecar_root();
    let mgr = state.0.clone();
    let emit_handle = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        installer::install_model_blocking(
            spec,
            &target_models_dir,
            &app_data,
            dev_root.as_deref(),
            &mgr,
            move |ev| {
                let _ = emit_handle.emit("ai://model-install-progress", ev);
            },
        )
    })
    .await
    .map_err(|e| AiError::new("INTERNAL", e.to_string()))?
}

#[tauri::command]
pub fn ai_cancel_model_install(model_id: Option<String>) -> Result<bool, AiError> {
    installer::cancel_active_install(model_id.as_deref())
}

#[tauri::command]
pub fn ai_bootstrap_status(app: AppHandle) -> Result<installer::RuntimeBootstrapStatus, AiError> {
    let app_data = crate::resolve_app_storage_dir(&app).ok();
    let dev_root = sidecar_root();
    Ok(installer::check_bootstrap_status(
        app_data.as_deref(),
        dev_root.as_deref(),
    ))
}

#[tauri::command]
pub async fn ai_bootstrap_runtimes(
    app: AppHandle,
    state: State<'_, AiState>,
) -> Result<installer::RuntimeBootstrapStatus, AiError> {
    let app_data = crate::resolve_app_storage_dir(&app)
        .map_err(|e| AiError::new("INTERNAL", e))?;
    crate::security::SecurityService::require_commercial_access_if_enabled(
        &app_data,
        "ai.bootstrap_runtimes",
    )
    .map_err(|msg| AiError::new("LICENSE_REQUIRED", msg))?;

    let target_models_dir = resolve_configured_models_dir(&app, None)?;
    let dev_root = sidecar_root();
    let mgr = state.0.clone();
    let emit_handle = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        installer::bootstrap_runtimes_blocking(
            &app_data,
            &target_models_dir,
            dev_root.as_deref(),
            &mgr,
            move |ev| {
                let _ = emit_handle.emit("ai://model-install-progress", ev);
            },
        )
    })
    .await
    .map_err(|e| AiError::new("INTERNAL", e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_custom_models_dir_when_enabled() {
        let json = r#"{"modelsDir":"D:\\AI_Models\\VoxLab","customModelsDir":true,"device":"auto"}"#;
        assert_eq!(
            parse_custom_models_dir_from_json(json),
            Some(PathBuf::from(r"D:\AI_Models\VoxLab"))
        );
    }

    #[test]
    fn ignores_models_dir_when_custom_flag_is_false_or_empty() {
        let not_custom = r#"{"modelsDir":"C:\\Default\\models","customModelsDir":false}"#;
        assert_eq!(parse_custom_models_dir_from_json(not_custom), None);

        let blank_dir = r#"{"modelsDir":"   ","customModelsDir":true}"#;
        assert_eq!(parse_custom_models_dir_from_json(blank_dir), None);
    }

    #[test]
    fn whisper_display_names_are_clean_and_consistent() {
        for spec in models::MODELS.iter().filter(|m| m.kind == "asr") {
            assert!(
                !spec.display_name.contains("faster-whisper"),
                "ASR display_name should not expose internal engine suffix: {}",
                spec.display_name
            );
        }
    }
}
