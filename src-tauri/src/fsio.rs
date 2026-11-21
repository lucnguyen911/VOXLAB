//! Filesystem commands for Batch outputs and durable state.
//! All writes are atomic: unique temp file in the target directory → fsync → rename over target
//! (`std::fs::rename` uses MOVEFILE_REPLACE_EXISTING on Windows, so the target is never absent).

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn atomic_write(target: &Path, bytes: &[u8]) -> Result<(), String> {
    atomic_write_inner(target, bytes, true)
}

pub fn atomic_write_fast(target: &Path, bytes: &[u8]) -> Result<(), String> {
    atomic_write_inner(target, bytes, false)
}

fn atomic_write_inner(target: &Path, bytes: &[u8], durable_sync: bool) -> Result<(), String> {
    let parent = target.parent().ok_or_else(|| "target has no parent directory".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let name = target.file_name().and_then(|s| s.to_str()).unwrap_or("file");
    let n = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp = parent.join(format!(".{}.{}.{}.tmp", name, std::process::id(), n));
    let result = (|| {
        let mut f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(bytes).map_err(|e| e.to_string())?;
        if durable_sync {
            f.sync_all().map_err(|e| e.to_string())?;
        } else {
            f.flush().map_err(|e| e.to_string())?;
        }
        drop(f);
        std::fs::rename(&tmp, target).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

fn absolute(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if !p.is_absolute() {
        return Err(format!("path must be absolute: {path}"));
    }
    if p.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err("path must not contain '..'".to_string());
    }
    Ok(p)
}

fn ensure_not_protected_vault(path: &Path) -> Result<(), String> {
    if crate::security::license_storage::is_protected_vault_path(path) {
        return Err("ACCESS_DENIED: Protected security vault file cannot be accessed via generic filesystem IPC.".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn fs_write_text(path: String, content: String) -> Result<(), String> {
    let p = absolute(&path)?;
    ensure_not_protected_vault(&p)?;
    atomic_write_fast(&p, content.as_bytes())
}

#[tauri::command]
pub fn fs_write_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let p = absolute(&path)?;
    ensure_not_protected_vault(&p)?;
    atomic_write_fast(&p, &bytes)
}

#[tauri::command]
pub fn fs_read_text(path: String) -> Result<String, String> {
    let p = absolute(&path)?;
    ensure_not_protected_vault(&p)?;
    std::fs::read_to_string(p).map_err(|e| e.to_string())
}

/// File names (not paths) in a directory; empty when the directory does not exist yet.
#[tauri::command]
pub fn fs_list_dir(path: String) -> Result<Vec<String>, String> {
    let dir = absolute(&path)?;
    let Ok(entries) = std::fs::read_dir(&dir) else { return Ok(vec![]) };
    Ok(entries.flatten().filter_map(|e| e.file_name().to_str().map(String::from)).collect())
}

#[tauri::command]
pub fn fs_exists(path: String) -> Result<bool, String> {
    Ok(absolute(&path)?.exists())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub size: u64,
    pub mtime_ms: f64,
}

/// Size and modification time; `None` when the file does not exist.
#[tauri::command]
pub fn fs_stat(path: String) -> Result<Option<FileStat>, String> {
    let p = absolute(&path)?;
    let meta = match std::fs::metadata(&p) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);
    Ok(Some(FileStat { size: meta.len(), mtime_ms }))
}

#[tauri::command]
pub fn fs_remove_file(path: String) -> Result<(), String> {
    let p = absolute(&path)?;
    ensure_not_protected_vault(&p)?;
    match std::fs::remove_file(&p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

const STORAGE_SETTINGS_REL_PATH: &str = "settings/storage.json";
const SCRATCH_MARKER_FILE: &str = ".voxlab-cache";

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct StorageSettingsFile {
    schema_version: u32,
    custom_scratch_dir: bool,
    scratch_dir: Option<String>,
}

/// Parses `<app_data>/settings/storage.json` and extracts a user-configured custom `scratchDir`
/// when `customScratchDir` is `true` and `scratchDir` is a clean absolute path.
pub fn parse_custom_scratch_dir_from_json(raw_json: &str) -> Option<PathBuf> {
    let parsed: serde_json::Value = serde_json::from_str(raw_json).ok()?;
    let is_custom = parsed
        .get("customScratchDir")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !is_custom {
        return None;
    }
    let dir_str = parsed.get("scratchDir").and_then(|v| v.as_str())?.trim();
    if dir_str.is_empty() {
        return None;
    }
    let p = PathBuf::from(dir_str);
    if !p.is_absolute()
        || p.components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return None;
    }
    Some(p)
}

fn strip_windows_verbatim_prefix(s: String) -> String {
    #[cfg(windows)]
    {
        if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{}", rest);
        }
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            return rest.to_string();
        }
    }
    s
}

fn clean_lexical_path(path: &Path) -> PathBuf {
    use std::path::Component;
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            _ => out.push(comp.as_os_str()),
        }
    }
    out
}

fn format_clean_dir_path(path: &Path) -> PathBuf {
    let cleaned = clean_lexical_path(path);
    #[cfg(windows)]
    {
        let mut s = cleaned.to_string_lossy().replace('/', "\\");
        while s.len() > 3 && s.ends_with('\\') {
            s.pop();
        }
        if s.starts_with(r"\\") && s.ends_with('\\') {
            s.pop();
        }
        PathBuf::from(s)
    }
    #[cfg(not(windows))]
    {
        cleaned
    }
}

fn resolve_canonical_or_ancestor(path: &Path) -> PathBuf {
    if let Ok(canon) = std::fs::canonicalize(path) {
        return PathBuf::from(strip_windows_verbatim_prefix(
            canon.to_string_lossy().into_owned(),
        ));
    }
    let mut cur = path;
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    while let Some(name) = cur.file_name() {
        if let Some(parent) = cur.parent() {
            tail.push(name.to_os_string());
            if parent.exists() {
                if let Ok(canon_parent) = std::fs::canonicalize(parent) {
                    let mut combined = PathBuf::from(strip_windows_verbatim_prefix(
                        canon_parent.to_string_lossy().into_owned(),
                    ));
                    for seg in tail.iter().rev() {
                        if seg != "." {
                            combined.push(seg);
                        }
                    }
                    return clean_lexical_path(&combined);
                }
            }
            cur = parent;
        } else {
            break;
        }
    }
    clean_lexical_path(path)
}

fn normalize_path_for_compare(path: &Path) -> String {
    let resolved = resolve_canonical_or_ancestor(path);
    let mut s = strip_windows_verbatim_prefix(resolved.to_string_lossy().into_owned());
    #[cfg(windows)]
    {
        s = s.replace('/', "\\");
        while s.len() > 3 && s.ends_with('\\') {
            s.pop();
        }
        if s.starts_with(r"\\") && s.ends_with('\\') {
            s.pop();
        }
        s.make_ascii_lowercase();
    }
    #[cfg(not(windows))]
    {
        while s.len() > 1 && s.ends_with('/') {
            s.pop();
        }
    }
    s
}

fn paths_equal_or_ancestor(candidate: &Path, target: &Path) -> bool {
    let cand = normalize_path_for_compare(candidate);
    let tgt = normalize_path_for_compare(target);
    if cand == tgt {
        return true;
    }
    #[cfg(windows)]
    {
        if cand.ends_with('\\') {
            tgt.starts_with(&cand)
        } else {
            tgt.starts_with(&cand) && tgt.as_bytes().get(cand.len()) == Some(&b'\\')
        }
    }
    #[cfg(not(windows))]
    {
        if cand == "/" {
            tgt.starts_with('/')
        } else {
            tgt.starts_with(&cand) && tgt.as_bytes().get(cand.len()) == Some(&b'/')
        }
    }
}

fn is_known_voxlab_scratch_entry(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        ".voxlab-cache"
            | "tmp"
            | "hf-cache"
            | "hf-xet-cache"
            | "torch-cache"
            | "uv-cache"
            | "wheelhouse"
            | "updates"
            | "export"
            | "dialogue"
            | "clone_test"
            | "subtitle_tab"
            | "tts"
            | "dub"
    ) || lower.starts_with("tts-")
        || lower.starts_with("dlg-")
        || lower.starts_with("dub-")
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ScratchTargetResolution {
    UseDefault,
    UseCustom(PathBuf),
}

fn validate_custom_scratch_dir(
    target: &Path,
    app_data_dir: &Path,
    models_dir: Option<&Path>,
    exe_dir: Option<&Path>,
) -> Result<ScratchTargetResolution, String> {
    if !target.is_absolute() {
        return Err("Đường dẫn thư mục Cache phải là đường dẫn tuyệt đối.".to_string());
    }
    if target
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("Đường dẫn thư mục Cache không được chứa '..'.".to_string());
    }

    let default_scratch = app_data_dir.join("scratch");
    if normalize_path_for_compare(target) == normalize_path_for_compare(&default_scratch) {
        return Ok(ScratchTargetResolution::UseDefault);
    }

    if target.parent().is_none() {
        return Err("Không thể chọn thư mục gốc ổ đĩa làm thư mục Cache.".to_string());
    }

    if paths_equal_or_ancestor(target, app_data_dir) {
        return Err(
            "Không thể chọn thư mục trùng với hoặc chứa thư mục dữ liệu VoxLab.".to_string(),
        );
    }

    for sub in ["models", "runtimes", "webview", "settings", "voices"] {
        if paths_equal_or_ancestor(&app_data_dir.join(sub), target) {
            return Err(format!(
                "Không thể chọn thư mục '{}' của VoxLab làm thư mục Cache.",
                sub
            ));
        }
    }

    if let Some(m) = models_dir {
        if paths_equal_or_ancestor(target, m) || paths_equal_or_ancestor(m, target) {
            return Err(
                "Không thể chọn thư mục trùng với, nằm trong hoặc chứa thư mục mô hình AI."
                    .to_string(),
            );
        }
    }

    if let Some(e) = exe_dir {
        if paths_equal_or_ancestor(target, e)
            || paths_equal_or_ancestor(&e.join("sidecar"), target)
            || paths_equal_or_ancestor(&e.join("resources"), target)
        {
            return Err(
                "Không thể chọn thư mục cài đặt hoặc thư mục thực thi của VoxLab làm thư mục Cache."
                    .to_string(),
            );
        }
    }

    #[cfg(windows)]
    {
        let norm_target = normalize_path_for_compare(target);
        let win_dir = std::env::var_os("SystemRoot")
            .or_else(|| std::env::var_os("WINDIR"))
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        if paths_equal_or_ancestor(target, &win_dir) || paths_equal_or_ancestor(&win_dir, target) {
            return Err(
                "Không thể chọn thư mục hệ thống Windows làm thư mục Cache.".to_string(),
            );
        }

        for env_key in ["ProgramFiles", "ProgramFiles(x86)", "ProgramData"] {
            if let Some(val) = std::env::var_os(env_key) {
                let sys_path = PathBuf::from(val);
                if paths_equal_or_ancestor(target, &sys_path) {
                    return Err(
                        "Không thể chọn thư mục hệ thống hoặc thư mục chứa chương trình làm thư mục Cache."
                            .to_string(),
                    );
                }
            }
        }

        if let Some(profile) = std::env::var_os("USERPROFILE") {
            let profile_path = PathBuf::from(profile);
            if norm_target == normalize_path_for_compare(&profile_path) {
                return Err(
                    "Không thể chọn trực tiếp thư mục người dùng làm thư mục Cache. Vui lòng tạo một thư mục con riêng."
                        .to_string(),
                );
            }
            for user_sub in [
                "Desktop",
                "Documents",
                "Downloads",
                "Pictures",
                "Music",
                "Videos",
            ] {
                let sub_path = profile_path.join(user_sub);
                if norm_target == normalize_path_for_compare(&sub_path) {
                    return Err(format!(
                        "Không thể chọn trực tiếp thư mục '{}' làm thư mục Cache. Vui lòng chọn hoặc tạo một thư mục con riêng.",
                        user_sub
                    ));
                }
            }
        }
    }

    if target.exists() {
        if !target.is_dir() {
            return Err("Đường dẫn đã chọn không phải là một thư mục hợp lệ.".to_string());
        }
        let has_marker = target.join(SCRATCH_MARKER_FILE).is_file();
        if !has_marker {
            let entries = std::fs::read_dir(target)
                .map_err(|e| format!("Không thể kiểm tra thư mục đã chọn: {e}"))?;
            for entry_res in entries {
                let entry = entry_res
                    .map_err(|e| format!("Không thể đọc nội dung thư mục đã chọn: {e}"))?;
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if !is_known_voxlab_scratch_entry(&name_str) {
                    return Err(
                        "Thư mục đã chọn đang chứa tệp hoặc dữ liệu không thuộc bộ nhớ tạm VoxLab. Vui lòng chọn một thư mục trống hoặc tạo thư mục con mới."
                            .to_string(),
                    );
                }
            }
        }
    }

    if !crate::is_dir_writable(target) {
        return Err(
            "VoxLab không có quyền ghi vào thư mục đã chọn. Vui lòng chọn thư mục khác."
                .to_string(),
        );
    }

    Ok(ScratchTargetResolution::UseCustom(format_clean_dir_path(
        target,
    )))
}

/// Resolves the active scratch directory along with `(active, default, is_custom)`.
pub fn resolve_scratch_dir_with_meta(app_data_dir: &Path) -> (PathBuf, PathBuf, bool) {
    let default_dir = app_data_dir.join("scratch");
    let settings_file = app_data_dir.join(STORAGE_SETTINGS_REL_PATH);
    if let Ok(raw) = std::fs::read_to_string(&settings_file) {
        if let Some(custom) = parse_custom_scratch_dir_from_json(&raw) {
            if normalize_path_for_compare(&custom) == normalize_path_for_compare(&default_dir) {
                return (default_dir.clone(), default_dir, false);
            }
            if custom.is_dir() || std::fs::create_dir_all(&custom).is_ok() {
                return (custom, default_dir, true);
            }
        }
    }
    (default_dir.clone(), default_dir, false)
}

pub fn resolve_scratch_dir_from_app_data(app_data_dir: &Path) -> PathBuf {
    resolve_scratch_dir_with_meta(app_data_dir).0
}

pub fn resolve_scratch_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = crate::resolve_app_storage_dir(app)?;
    Ok(resolve_scratch_dir_from_app_data(&app_data_dir))
}

/// Per-purpose scratch directory under the active scratch root (e.g. TTS chunk WAVs).
#[tauri::command]
pub fn fs_scratch_dir(app: tauri::AppHandle, name: String) -> Result<String, String> {
    if name.is_empty() || name.contains(['/', '\\', '.']) {
        return Err("invalid scratch name".to_string());
    }
    let dir = resolve_scratch_dir(&app)?.join(name);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

fn dir_size_bytes_excluding(path: &Path, exclude_dir_names: &[&str]) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    let mut total: u64 = 0;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if exclude_dir_names
            .iter()
            .any(|ex| name_str.eq_ignore_ascii_case(ex))
        {
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.is_dir() {
            total = total.saturating_add(dir_size_bytes_excluding(&entry.path(), &[]));
        } else {
            total = total.saturating_add(meta.len());
        }
    }
    total
}

fn clear_dir_contents_best_effort_except(path: &Path, keep_names: &[&str]) {
    let Ok(entries) = std::fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if keep_names
            .iter()
            .any(|keep| name_str.eq_ignore_ascii_case(keep))
        {
            continue;
        }
        let p = entry.path();
        if p.is_dir() {
            clear_dir_contents_best_effort_except(&p, &[]);
            let _ = std::fs::remove_dir(&p);
        } else {
            let _ = std::fs::remove_file(&p);
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStats {
    pub app_data_path: String,
    pub app_data_bytes: u64,
    pub scratch_path: String,
    pub scratch_bytes: u64,
    pub default_scratch_path: String,
    pub is_custom_scratch_path: bool,
}

fn compute_storage_stats(app_data_dir: &Path) -> StorageStats {
    let _ = std::fs::create_dir_all(app_data_dir);
    let (scratch_dir, default_scratch_dir, is_custom_scratch_path) =
        resolve_scratch_dir_with_meta(app_data_dir);
    let _ = std::fs::create_dir_all(&scratch_dir);
    let scratch_bytes = dir_size_bytes_excluding(&scratch_dir, &[SCRATCH_MARKER_FILE]);

    // Exclude heavy runtime/webview/models trees when computing lightweight app state size,
    // and avoid double-counting if a custom scratch dir is a direct child of app_data_dir.
    let mut excludes: Vec<String> = vec![
        "models".to_string(),
        "runtimes".to_string(),
        "webview".to_string(),
        "scratch".to_string(),
    ];
    if is_custom_scratch_path {
        if let Some(parent) = scratch_dir.parent() {
            if normalize_path_for_compare(parent) == normalize_path_for_compare(app_data_dir) {
                if let Some(name) = scratch_dir.file_name().and_then(|n| n.to_str()) {
                    excludes.push(name.to_string());
                }
            }
        }
    }
    let exclude_refs: Vec<&str> = excludes.iter().map(String::as_str).collect();
    let app_data_only_bytes = dir_size_bytes_excluding(app_data_dir, &exclude_refs);
    let total_bytes = app_data_only_bytes.saturating_add(scratch_bytes);

    StorageStats {
        app_data_path: app_data_dir.to_string_lossy().to_string(),
        app_data_bytes: total_bytes,
        scratch_path: scratch_dir.to_string_lossy().to_string(),
        scratch_bytes,
        default_scratch_path: default_scratch_dir.to_string_lossy().to_string(),
        is_custom_scratch_path,
    }
}

#[tauri::command]
pub async fn fs_storage_stats(app: tauri::AppHandle) -> Result<StorageStats, String> {
    let app_data_dir = crate::resolve_app_storage_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || Ok(compute_storage_stats(&app_data_dir)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_set_scratch_dir(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::ai::AiState>,
    path: Option<String>,
) -> Result<StorageStats, String> {
    if state.0.has_active_requests() || crate::ai::installer::is_install_active() {
        return Err(
            "Không thể thay đổi thư mục Cache khi tác vụ AI hoặc quá trình tải mô hình đang chạy."
                .to_string(),
        );
    }
    let app_data_dir = crate::resolve_app_storage_dir(&app)?;
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));
    let mgr = state.0.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let models_dir = {
            let ai_settings = app_data_dir.join("settings").join("ai_runtime.json");
            std::fs::read_to_string(&ai_settings)
                .ok()
                .and_then(|raw| crate::ai::parse_custom_models_dir_from_json(&raw))
                .unwrap_or_else(|| app_data_dir.join("models"))
        };
        let settings_path = app_data_dir.join(STORAGE_SETTINGS_REL_PATH);
        let trimmed = path.as_deref().map(str::trim).filter(|s| !s.is_empty());

        match trimmed {
            None => {
                let settings = StorageSettingsFile {
                    schema_version: 1,
                    custom_scratch_dir: false,
                    scratch_dir: None,
                };
                let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
                atomic_write(&settings_path, json.as_bytes())?;
            }
            Some(raw_path) => {
                let target = Path::new(raw_path);
                match validate_custom_scratch_dir(
                    target,
                    &app_data_dir,
                    Some(&models_dir),
                    exe_dir.as_deref(),
                )? {
                    ScratchTargetResolution::UseDefault => {
                        let settings = StorageSettingsFile {
                            schema_version: 1,
                            custom_scratch_dir: false,
                            scratch_dir: None,
                        };
                        let json =
                            serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
                        atomic_write(&settings_path, json.as_bytes())?;
                    }
                    ScratchTargetResolution::UseCustom(clean_path) => {
                        let marker_path = clean_path.join(SCRATCH_MARKER_FILE);
                        atomic_write(&marker_path, b"voxlab-cache-v1\n")?;
                        let settings = StorageSettingsFile {
                            schema_version: 1,
                            custom_scratch_dir: true,
                            scratch_dir: Some(clean_path.to_string_lossy().to_string()),
                        };
                        let json =
                            serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
                        atomic_write(&settings_path, json.as_bytes())?;
                    }
                }
            }
        }

        mgr.shutdown_idle();
        Ok(compute_storage_stats(&app_data_dir))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_clear_scratch(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::ai::AiState>,
) -> Result<u64, String> {
    if state.0.has_active_requests() || crate::ai::installer::is_install_active() {
        return Err(
            "Không thể dọn bộ nhớ tạm khi tác vụ AI hoặc quá trình tải mô hình đang chạy."
                .to_string(),
        );
    }
    let app_data_dir = crate::resolve_app_storage_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (scratch_dir, _default_dir, is_custom) = resolve_scratch_dir_with_meta(&app_data_dir);
        if is_custom
            && (scratch_dir.parent().is_none()
                || paths_equal_or_ancestor(&scratch_dir, &app_data_dir)
                || !scratch_dir.join(SCRATCH_MARKER_FILE).is_file())
        {
            return Err(
                "Thư mục Cache tùy chỉnh không hợp lệ hoặc thiếu tệp xác thực an toàn (.voxlab-cache). Đã hủy dọn dẹp để bảo vệ dữ liệu."
                    .to_string(),
            );
        }
        let before = dir_size_bytes_excluding(&scratch_dir, &[SCRATCH_MARKER_FILE]);
        clear_dir_contents_best_effort_except(&scratch_dir, &[SCRATCH_MARKER_FILE]);
        std::fs::create_dir_all(&scratch_dir).map_err(|e| e.to_string())?;
        let after = dir_size_bytes_excluding(&scratch_dir, &[SCRATCH_MARKER_FILE]);
        Ok(before.saturating_sub(after))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_read_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    let p = absolute(&path)?;
    ensure_not_protected_vault(&p)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(&p))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WavHeaderProbe {
    pub duration_sec: f64,
    pub sample_rate: u32,
    pub channels: u16,
    pub size_bytes: u64,
}

/// Fast-path WAV header parser that reads only chunk headers (< 200 bytes) via Seek,
/// computing exact duration in < 0.2ms without loading the audio payload into memory.
pub fn parse_wav_header_fast(path: &Path) -> Option<WavHeaderProbe> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path).ok()?;
    let file_len = f.metadata().ok()?.len();
    if file_len < 44 {
        return None;
    }
    let mut riff = [0u8; 12];
    f.read_exact(&mut riff).ok()?;
    if &riff[0..4] != b"RIFF" || &riff[8..12] != b"WAVE" {
        return None;
    }

    let mut channels: u16 = 0;
    let mut sample_rate: u32 = 0;
    let mut byte_rate: u32 = 0;
    let mut block_align: u16 = 0;
    let mut bits_per_sample: u16 = 0;
    let mut data_bytes: Option<u64> = None;

    let mut pos: u64 = 12;
    while pos + 8 <= file_len {
        if f.seek(SeekFrom::Start(pos)).is_err() {
            break;
        }
        let mut chunk_hdr = [0u8; 8];
        if f.read_exact(&mut chunk_hdr).is_err() {
            break;
        }
        let chunk_id = &chunk_hdr[0..4];
        let chunk_size = u32::from_le_bytes([chunk_hdr[4], chunk_hdr[5], chunk_hdr[6], chunk_hdr[7]]) as u64;

        if chunk_id == b"fmt " && chunk_size >= 16 {
            let mut fmt_buf = [0u8; 16];
            if f.read_exact(&mut fmt_buf).is_ok() {
                channels = u16::from_le_bytes([fmt_buf[2], fmt_buf[3]]);
                sample_rate = u32::from_le_bytes([fmt_buf[4], fmt_buf[5], fmt_buf[6], fmt_buf[7]]);
                byte_rate = u32::from_le_bytes([fmt_buf[8], fmt_buf[9], fmt_buf[10], fmt_buf[11]]);
                block_align = u16::from_le_bytes([fmt_buf[12], fmt_buf[13]]);
                bits_per_sample = u16::from_le_bytes([fmt_buf[14], fmt_buf[15]]);
            }
        } else if chunk_id == b"data" {
            let remaining = file_len.saturating_sub(pos + 8);
            data_bytes = Some( if chunk_size == 0 || chunk_size > remaining { remaining } else { chunk_size } );
            if sample_rate > 0 && channels > 0 {
                break;
            }
        }

        let padded = chunk_size + (chunk_size & 1);
        pos = pos.saturating_add(8).saturating_add(padded);
    }

    if sample_rate == 0 || channels == 0 {
        return None;
    }
    let effective_byte_rate = if byte_rate > 0 {
        byte_rate as f64
    } else if block_align > 0 {
        (sample_rate as f64) * (block_align as f64)
    } else if bits_per_sample > 0 {
        (sample_rate as f64) * (channels as f64) * ((bits_per_sample as f64) / 8.0)
    } else {
        return None;
    };
    if effective_byte_rate <= 0.0 {
        return None;
    }
    let payload_bytes = data_bytes.unwrap_or_else(|| file_len.saturating_sub(44));
    let duration_sec = (payload_bytes as f64) / effective_byte_rate;

    Some(WavHeaderProbe {
        duration_sec: (duration_sec * 1000.0).round() / 1000.0,
        sample_rate,
        channels,
        size_bytes: file_len,
    })
}

#[tauri::command]
pub async fn fs_probe_wav_header(path: String) -> Result<Option<WavHeaderProbe>, String> {
    let p = absolute(&path)?;
    tauri::async_runtime::spawn_blocking(move || Ok(parse_wav_header_fast(&p)))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WavConcatInput {
    pub path: String,
    #[serde(default)]
    pub gap_after_ms: f64,
}

#[derive(serde::Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WavConcatSegment {
    pub index: usize,
    pub start_sec: f64,
    pub end_sec: f64,
    pub duration_sec: f64,
}

#[derive(serde::Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WavConcatResult {
    pub output_path: String,
    pub sample_rate: u32,
    pub duration_sec: f64,
    pub segments: Vec<WavConcatSegment>,
}

fn probe_pcm16_mono_wav_slice(path: &Path) -> Option<(u32, u64, u64)> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path).ok()?;
    let file_len = f.metadata().ok()?.len();
    if file_len < 44 {
        return None;
    }
    let mut riff = [0u8; 12];
    f.read_exact(&mut riff).ok()?;
    if &riff[0..4] != b"RIFF" || &riff[8..12] != b"WAVE" {
        return None;
    }

    let mut audio_format: u16 = 0;
    let mut channels: u16 = 0;
    let mut sample_rate: u32 = 0;
    let mut bits_per_sample: u16 = 0;
    let mut data_slice: Option<(u64, u64)> = None;

    let mut pos: u64 = 12;
    while pos + 8 <= file_len {
        if f.seek(SeekFrom::Start(pos)).is_err() {
            break;
        }
        let mut chunk_hdr = [0u8; 8];
        if f.read_exact(&mut chunk_hdr).is_err() {
            break;
        }
        let chunk_id = &chunk_hdr[0..4];
        let chunk_size = u32::from_le_bytes([chunk_hdr[4], chunk_hdr[5], chunk_hdr[6], chunk_hdr[7]]) as u64;

        if chunk_id == b"fmt " && chunk_size >= 16 {
            let mut fmt_buf = [0u8; 16];
            if f.read_exact(&mut fmt_buf).is_ok() {
                audio_format = u16::from_le_bytes([fmt_buf[0], fmt_buf[1]]);
                channels = u16::from_le_bytes([fmt_buf[2], fmt_buf[3]]);
                sample_rate = u32::from_le_bytes([fmt_buf[4], fmt_buf[5], fmt_buf[6], fmt_buf[7]]);
                bits_per_sample = u16::from_le_bytes([fmt_buf[14], fmt_buf[15]]);
            }
        } else if chunk_id == b"data" {
            let offset = pos + 8;
            let remaining = file_len.saturating_sub(offset);
            let raw_bytes = if chunk_size == 0 || chunk_size > remaining {
                remaining
            } else {
                chunk_size
            };
            data_slice = Some((offset, raw_bytes & !1));
            if sample_rate > 0 && channels > 0 {
                break;
            }
        }

        let padded = chunk_size + (chunk_size & 1);
        pos = pos.saturating_add(8).saturating_add(padded);
    }

    if audio_format != 1 || channels != 1 || bits_per_sample != 16 || sample_rate == 0 {
        return None;
    }
    let (data_offset, data_bytes) = data_slice?;
    Some((sample_rate, data_offset, data_bytes))
}

pub fn concat_pcm16_mono_wavs_sync(
    inputs: &[WavConcatInput],
    target: &Path,
) -> Result<Option<WavConcatResult>, String> {
    use std::io::{BufWriter, Read, Seek, SeekFrom};
    if inputs.is_empty() {
        return Err("inputs must not be empty".to_string());
    }
    ensure_not_protected_vault(target)?;

    let mut resolved_slices: Vec<(PathBuf, u64, u64, f64)> = Vec::with_capacity(inputs.len());
    let mut common_sr: Option<u32> = None;

    for item in inputs {
        let p = absolute(&item.path)?;
        ensure_not_protected_vault(&p)?;
        let Some((sr, offset, len)) = probe_pcm16_mono_wav_slice(&p) else {
            return Ok(None);
        };
        if let Some(expected_sr) = common_sr {
            if expected_sr != sr {
                return Ok(None);
            }
        } else {
            common_sr = Some(sr);
        }
        resolved_slices.push((p, offset, len, item.gap_after_ms));
    }

    let sr = common_sr.unwrap_or(24000);
    let mut total_samples: u64 = 0;
    let mut segments: Vec<WavConcatSegment> = Vec::with_capacity(resolved_slices.len());
    let mut gap_samples_per_chunk: Vec<u64> = Vec::with_capacity(resolved_slices.len());

    for (idx, (_p, _offset, data_bytes, gap_ms)) in resolved_slices.iter().enumerate() {
        let chunk_samples = data_bytes / 2;
        let start_sec = (total_samples as f64) / (sr as f64);
        let dur_sec = (chunk_samples as f64) / (sr as f64);
        let end_sec = start_sec + dur_sec;
        segments.push(WavConcatSegment {
            index: idx,
            start_sec: (start_sec * 10000.0).round() / 10000.0,
            end_sec: (end_sec * 10000.0).round() / 10000.0,
            duration_sec: (dur_sec * 10000.0).round() / 10000.0,
        });
        let gap_samples = if *gap_ms > 0.0 && gap_ms.is_finite() {
            ((*gap_ms * (sr as f64)) / 1000.0).round() as u64
        } else {
            0
        };
        gap_samples_per_chunk.push(gap_samples);
        total_samples = total_samples.saturating_add(chunk_samples).saturating_add(gap_samples);
    }

    let total_data_bytes = total_samples.saturating_mul(2);
    if total_data_bytes > (u32::MAX as u64).saturating_sub(36) {
        return Ok(None);
    }
    let data_u32 = total_data_bytes as u32;
    let riff_size_u32 = 36u32.saturating_add(data_u32);
    let byte_rate = sr.saturating_mul(2);

    let parent = target.parent().ok_or_else(|| "target has no parent directory".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let name = target.file_name().and_then(|s| s.to_str()).unwrap_or("master.wav");
    let n = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp = parent.join(format!(".{}.{}.{}.tmp", name, std::process::id(), n));

    let write_res = (|| -> Result<(), String> {
        let f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        let mut w = BufWriter::with_capacity(256 * 1024, f);

        let mut hdr = [0u8; 44];
        hdr[0..4].copy_from_slice(b"RIFF");
        hdr[4..8].copy_from_slice(&riff_size_u32.to_le_bytes());
        hdr[8..12].copy_from_slice(b"WAVE");
        hdr[12..16].copy_from_slice(b"fmt ");
        hdr[16..20].copy_from_slice(&16u32.to_le_bytes());
        hdr[20..22].copy_from_slice(&1u16.to_le_bytes()); // PCM
        hdr[22..24].copy_from_slice(&1u16.to_le_bytes()); // Mono
        hdr[24..28].copy_from_slice(&sr.to_le_bytes());
        hdr[28..32].copy_from_slice(&byte_rate.to_le_bytes());
        hdr[32..34].copy_from_slice(&2u16.to_le_bytes()); // BlockAlign = 2
        hdr[34..36].copy_from_slice(&16u16.to_le_bytes()); // BitsPerSample = 16
        hdr[36..40].copy_from_slice(b"data");
        hdr[40..44].copy_from_slice(&data_u32.to_le_bytes());
        w.write_all(&hdr).map_err(|e| e.to_string())?;

        let zero_buf = [0u8; 16384];
        for (idx, (p, offset, data_bytes, _)) in resolved_slices.iter().enumerate() {
            if *data_bytes > 0 {
                let mut src = std::fs::File::open(p).map_err(|e| e.to_string())?;
                src.seek(SeekFrom::Start(*offset)).map_err(|e| e.to_string())?;
                let mut slice_reader = src.take(*data_bytes);
                std::io::copy(&mut slice_reader, &mut w).map_err(|e| e.to_string())?;
            }
            let mut rem_gap_bytes = gap_samples_per_chunk[idx].saturating_mul(2);
            while rem_gap_bytes > 0 {
                let chunk = std::cmp::min(rem_gap_bytes as usize, zero_buf.len());
                w.write_all(&zero_buf[..chunk]).map_err(|e| e.to_string())?;
                rem_gap_bytes -= chunk as u64;
            }
        }

        w.flush().map_err(|e| e.to_string())?;
        drop(w);
        std::fs::rename(&tmp, target).map_err(|e| e.to_string())
    })();

    if write_res.is_err() {
        let _ = std::fs::remove_file(&tmp);
        write_res?;
    }

    let total_dur = ((total_samples as f64) / (sr as f64) * 10000.0).round() / 10000.0;
    Ok(Some(WavConcatResult {
        output_path: target.to_string_lossy().to_string(),
        sample_rate: sr,
        duration_sec: total_dur,
        segments,
    }))
}

/// Fast-path native PCM_16 mono WAV stitcher (`<5ms` without Python sidecar IPC).
/// Returns `Ok(None)` if inputs are not uniform mono 16-bit PCM WAVs so callers can fall back to `ai.assemble`.
#[tauri::command]
pub async fn fs_concat_pcm_wavs(
    inputs: Vec<WavConcatInput>,
    output_path: String,
) -> Result<Option<WavConcatResult>, String> {
    let target = absolute(&output_path)?;
    ensure_not_protected_vault(&target)?;
    tauri::async_runtime::spawn_blocking(move || concat_pcm16_mono_wavs_sync(&inputs, &target))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn fs_show_in_folder(path: String) -> Result<(), String> {
    let p = absolute(&path)?;
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("explorer.exe");
        if p.is_dir() {
            cmd.raw_arg(format!("\"{}\"", p.to_string_lossy()));
        } else {
            cmd.raw_arg(format!("/select,\"{}\"", p.to_string_lossy()));
        }
        cmd.spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = p;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_test_pcm16_wav(path: &Path, sr: u32, samples: &[i16]) {
        let data_len = (samples.len() * 2) as u32;
        let mut buf = Vec::with_capacity(44 + data_len as usize);
        buf.extend_from_slice(b"RIFF");
        buf.extend_from_slice(&(36 + data_len).to_le_bytes());
        buf.extend_from_slice(b"WAVE");
        buf.extend_from_slice(b"fmt ");
        buf.extend_from_slice(&16u32.to_le_bytes());
        buf.extend_from_slice(&1u16.to_le_bytes());
        buf.extend_from_slice(&1u16.to_le_bytes());
        buf.extend_from_slice(&sr.to_le_bytes());
        buf.extend_from_slice(&(sr * 2).to_le_bytes());
        buf.extend_from_slice(&2u16.to_le_bytes());
        buf.extend_from_slice(&16u16.to_le_bytes());
        buf.extend_from_slice(b"data");
        buf.extend_from_slice(&data_len.to_le_bytes());
        for s in samples {
            buf.extend_from_slice(&s.to_le_bytes());
        }
        atomic_write_fast(path, &buf).unwrap();
    }

    #[test]
    fn concat_pcm16_mono_wavs_stitches_samples_and_gaps_instantly() {
        let dir = std::env::temp_dir().join(format!("voxlab-wav-concat-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let c1 = dir.join("c1.wav");
        let c2 = dir.join("c2.wav");
        let c_diff_sr = dir.join("c_44k.wav");
        let non_wav = dir.join("fake.mp3");
        let out = dir.join("master.wav");

        // 24000 Hz: 2400 samples = 0.1s each, 500ms gap = 12000 zero samples -> total 16800 samples = 0.7s
        write_test_pcm16_wav(&c1, 24000, &vec![1000i16; 2400]);
        write_test_pcm16_wav(&c2, 24000, &vec![-1000i16; 2400]);
        write_test_pcm16_wav(&c_diff_sr, 44100, &vec![500i16; 4410]);
        atomic_write_fast(&non_wav, b"ID3-not-a-wav").unwrap();

        let res = concat_pcm16_mono_wavs_sync(
            &[
                WavConcatInput { path: c1.to_string_lossy().into(), gap_after_ms: 500.0 },
                WavConcatInput { path: c2.to_string_lossy().into(), gap_after_ms: 0.0 },
            ],
            &out,
        )
        .unwrap()
        .expect("should fast-concat matching PCM16 mono WAVs");

        assert_eq!(res.sample_rate, 24000);
        assert!((res.duration_sec - 0.7).abs() < 1e-4);
        assert_eq!(res.segments.len(), 2);
        assert!((res.segments[0].duration_sec - 0.1).abs() < 1e-4);
        assert!((res.segments[1].start_sec - 0.6).abs() < 1e-4);

        let probed = parse_wav_header_fast(&out).expect("valid output WAV");
        assert_eq!(probed.sample_rate, 24000);
        assert_eq!(probed.channels, 1);
        assert!((probed.duration_sec - 0.7).abs() < 1e-3);

        // Mixed sample rates -> returns Ok(None) cleanly for fallback
        let mixed = concat_pcm16_mono_wavs_sync(
            &[
                WavConcatInput { path: c1.to_string_lossy().into(), gap_after_ms: 0.0 },
                WavConcatInput { path: c_diff_sr.to_string_lossy().into(), gap_after_ms: 0.0 },
            ],
            &out,
        )
        .unwrap();
        assert!(mixed.is_none());

        // Non-WAV input -> returns Ok(None) cleanly for fallback
        let mp3_try = concat_pcm16_mono_wavs_sync(
            &[WavConcatInput { path: non_wav.to_string_lossy().into(), gap_after_ms: 0.0 }],
            &out,
        )
        .unwrap();
        assert!(mp3_try.is_none());

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn atomic_write_replaces_existing_and_leaves_no_tmp() {
        let dir = std::env::temp_dir().join(format!("voxlab-fsio-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let target = dir.join("nested").join("out.srt");
        atomic_write(&target, b"first").unwrap();
        atomic_write(&target, b"second").unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "second");
        let leftovers: Vec<_> = std::fs::read_dir(target.parent().unwrap())
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_relative_and_parent_paths_and_protected_vaults() {
        assert!(absolute("relative/file.txt").is_err());
        assert!(absolute("C:\\a\\..\\b.txt").is_err());
        assert!(fs_list_dir("C:\\definitely\\missing\\voxlab".into()).unwrap().is_empty());

        // Protected vault files must be blocked across generic WebView FS IPC
        assert!(fs_read_text("C:\\Users\\test\\AppData\\Roaming\\com.voxlab.app\\license.enc".into()).is_err());
        assert!(fs_write_text("C:\\Users\\test\\AppData\\Roaming\\com.voxlab.app\\license.enc".into(), "{}".into()).is_err());
        assert!(fs_write_bytes("C:\\Users\\test\\AppData\\Roaming\\com.voxlab.app\\device_profile.enc".into(), vec![1, 2]).is_err());
        assert!(fs_remove_file("C:\\Users\\test\\AppData\\Roaming\\com.voxlab.app\\gemini_keys.enc".into()).is_err());
    }

    #[test]
    fn parses_custom_scratch_dir_from_json_safely() {
        let enabled = r#"{"schemaVersion":1,"customScratchDir":true,"scratchDir":"D:\\VoxLabCache"}"#;
        assert_eq!(
            parse_custom_scratch_dir_from_json(enabled),
            Some(PathBuf::from(r"D:\VoxLabCache"))
        );

        let disabled = r#"{"schemaVersion":1,"customScratchDir":false,"scratchDir":"D:\\VoxLabCache"}"#;
        assert_eq!(parse_custom_scratch_dir_from_json(disabled), None);

        let blank = r#"{"schemaVersion":1,"customScratchDir":true,"scratchDir":"   "}"#;
        assert_eq!(parse_custom_scratch_dir_from_json(blank), None);

        let relative = r#"{"schemaVersion":1,"customScratchDir":true,"scratchDir":"cache\\tmp"}"#;
        assert_eq!(parse_custom_scratch_dir_from_json(relative), None);

        let parent_traversal =
            r#"{"schemaVersion":1,"customScratchDir":true,"scratchDir":"D:\\VoxLab\\..\\Other"}"#;
        assert_eq!(parse_custom_scratch_dir_from_json(parent_traversal), None);
    }

    #[test]
    fn validates_custom_scratch_dir_safety_rules() {
        let base = std::env::temp_dir().join(format!("voxlab-scratch-val-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let app_data = base.join("app_data");
        let models_dir = base.join("models_store");
        let exe_dir = base.join("bin_dir");
        std::fs::create_dir_all(&app_data).unwrap();
        std::fs::create_dir_all(&models_dir).unwrap();
        std::fs::create_dir_all(&exe_dir).unwrap();

        // Empty new or existing dir is accepted
        let empty_custom = base.join("custom_cache_empty");
        std::fs::create_dir_all(&empty_custom).unwrap();
        assert!(matches!(
            validate_custom_scratch_dir(&empty_custom, &app_data, Some(&models_dir), Some(&exe_dir)),
            Ok(ScratchTargetResolution::UseCustom(_))
        ));

        // Directory with known VoxLab scratch subdirectories or marker is accepted
        let known_dir = base.join("custom_cache_known");
        std::fs::create_dir_all(known_dir.join("hf-cache")).unwrap();
        std::fs::create_dir_all(known_dir.join("tts-job1")).unwrap();
        assert!(matches!(
            validate_custom_scratch_dir(&known_dir, &app_data, Some(&models_dir), Some(&exe_dir)),
            Ok(ScratchTargetResolution::UseCustom(_))
        ));

        let marked_dir = base.join("custom_cache_marked");
        std::fs::create_dir_all(&marked_dir).unwrap();
        atomic_write(&marked_dir.join(SCRATCH_MARKER_FILE), b"voxlab-cache-v1\n").unwrap();
        std::fs::write(marked_dir.join("leftover.wav"), b"audio").unwrap();
        assert!(matches!(
            validate_custom_scratch_dir(&marked_dir, &app_data, Some(&models_dir), Some(&exe_dir)),
            Ok(ScratchTargetResolution::UseCustom(_))
        ));

        // Selecting default <app_data>/scratch returns UseDefault
        let default_scratch = app_data.join("scratch");
        assert_eq!(
            validate_custom_scratch_dir(
                &default_scratch,
                &app_data,
                Some(&models_dir),
                Some(&exe_dir)
            )
            .unwrap(),
            ScratchTargetResolution::UseDefault
        );

        // Drive root rejected
        #[cfg(windows)]
        assert!(
            validate_custom_scratch_dir(Path::new(r"C:\"), &app_data, Some(&models_dir), Some(&exe_dir))
                .is_err()
        );

        // AppData itself, ancestor of AppData, and protected subdirs rejected
        assert!(
            validate_custom_scratch_dir(&app_data, &app_data, Some(&models_dir), Some(&exe_dir))
                .is_err()
        );
        assert!(
            validate_custom_scratch_dir(&base, &app_data, Some(&models_dir), Some(&exe_dir)).is_err()
        );
        for sub in ["models", "runtimes", "webview", "settings", "voices"] {
            assert!(
                validate_custom_scratch_dir(
                    &app_data.join(sub),
                    &app_data,
                    Some(&models_dir),
                    Some(&exe_dir)
                )
                .is_err(),
                "protected subdir {} must be rejected",
                sub
            );
            assert!(
                validate_custom_scratch_dir(
                    &app_data.join(sub).join("nested"),
                    &app_data,
                    Some(&models_dir),
                    Some(&exe_dir)
                )
                .is_err(),
                "nested inside protected subdir {} must be rejected",
                sub
            );
        }

        // Models dir and child inside models dir rejected
        assert!(
            validate_custom_scratch_dir(&models_dir, &app_data, Some(&models_dir), Some(&exe_dir))
                .is_err()
        );
        assert!(
            validate_custom_scratch_dir(
                &models_dir.join("sub"),
                &app_data,
                Some(&models_dir),
                Some(&exe_dir)
            )
            .is_err()
        );

        // Exe dir and sidecar/resources rejected
        assert!(
            validate_custom_scratch_dir(&exe_dir, &app_data, Some(&models_dir), Some(&exe_dir))
                .is_err()
        );
        assert!(
            validate_custom_scratch_dir(
                &exe_dir.join("sidecar"),
                &app_data,
                Some(&models_dir),
                Some(&exe_dir)
            )
            .is_err()
        );

        // Non-empty directory with unrelated user file (no marker) rejected
        let user_dir = base.join("user_photos");
        std::fs::create_dir_all(&user_dir).unwrap();
        std::fs::write(user_dir.join("family.jpg"), b"data").unwrap();
        assert!(
            validate_custom_scratch_dir(&user_dir, &app_data, Some(&models_dir), Some(&exe_dir))
                .is_err()
        );

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn resolves_scratch_dir_with_meta_and_clears_preserving_marker() {
        let base = std::env::temp_dir().join(format!("voxlab-scratch-meta-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let app_data = base.join("app_data");
        std::fs::create_dir_all(&app_data).unwrap();

        // Missing settings -> default
        let default_expected = app_data.join("scratch");
        let (active, default_path, is_custom) = resolve_scratch_dir_with_meta(&app_data);
        assert_eq!(active, default_expected);
        assert_eq!(default_path, default_expected);
        assert!(!is_custom);

        // Configured custom directory -> active custom
        let custom_dir = base.join("my_cache");
        std::fs::create_dir_all(&custom_dir).unwrap();
        let marker = custom_dir.join(SCRATCH_MARKER_FILE);
        atomic_write(&marker, b"voxlab-cache-v1\n").unwrap();
        let nested_file = custom_dir.join("tmp").join("chunk.wav");
        atomic_write(&nested_file, &[1u8; 512]).unwrap();

        let settings = StorageSettingsFile {
            schema_version: 1,
            custom_scratch_dir: true,
            scratch_dir: Some(custom_dir.to_string_lossy().to_string()),
        };
        atomic_write(
            &app_data.join(STORAGE_SETTINGS_REL_PATH),
            serde_json::to_string_pretty(&settings).unwrap().as_bytes(),
        )
        .unwrap();

        let (active2, default2, is_custom2) = resolve_scratch_dir_with_meta(&app_data);
        assert_eq!(active2, custom_dir);
        assert_eq!(default2, default_expected);
        assert!(is_custom2);

        // Clear contents preserving marker and verify size exclusion reports 0 bytes afterward
        assert_eq!(
            dir_size_bytes_excluding(&custom_dir, &[SCRATCH_MARKER_FILE]),
            512
        );
        clear_dir_contents_best_effort_except(&custom_dir, &[SCRATCH_MARKER_FILE]);
        assert!(marker.is_file(), ".voxlab-cache marker must be preserved");
        assert!(!nested_file.exists(), "temporary file should be removed");
        assert_eq!(
            dir_size_bytes_excluding(&custom_dir, &[SCRATCH_MARKER_FILE]),
            0
        );

        // Unusable custom path (points to an existing file) -> falls back to default
        let blocking_file = base.join("not_a_dir.txt");
        std::fs::write(&blocking_file, b"file").unwrap();
        let bad_settings = StorageSettingsFile {
            schema_version: 1,
            custom_scratch_dir: true,
            scratch_dir: Some(blocking_file.to_string_lossy().to_string()),
        };
        atomic_write(
            &app_data.join(STORAGE_SETTINGS_REL_PATH),
            serde_json::to_string_pretty(&bad_settings)
                .unwrap()
                .as_bytes(),
        )
        .unwrap();
        let (active3, default3, is_custom3) = resolve_scratch_dir_with_meta(&app_data);
        assert_eq!(active3, default_expected);
        assert_eq!(default3, default_expected);
        assert!(!is_custom3);

        let _ = std::fs::remove_dir_all(&base);
    }
}
