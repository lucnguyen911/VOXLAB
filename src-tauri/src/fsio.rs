//! Filesystem commands for Batch outputs and durable state.
//! All writes are atomic: unique temp file in the target directory → fsync → rename over target
//! (`std::fs::rename` uses MOVEFILE_REPLACE_EXISTING on Windows, so the target is never absent).

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn atomic_write(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = target.parent().ok_or_else(|| "target has no parent directory".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let name = target.file_name().and_then(|s| s.to_str()).unwrap_or("file");
    let n = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp = parent.join(format!(".{}.{}.{}.tmp", name, std::process::id(), n));
    let result = (|| {
        let mut f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(bytes).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
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

#[tauri::command]
pub fn fs_write_text(path: String, content: String) -> Result<(), String> {
    atomic_write(&absolute(&path)?, content.as_bytes())
}

#[tauri::command]
pub fn fs_write_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    atomic_write(&absolute(&path)?, &bytes)
}

#[tauri::command]
pub fn fs_read_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(absolute(&path)?).map_err(|e| e.to_string())
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

#[tauri::command]
pub fn fs_remove_file(path: String) -> Result<(), String> {
    let p = absolute(&path)?;
    match std::fs::remove_file(&p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Per-purpose scratch directory under the app cache dir (e.g. TTS chunk WAVs).
#[tauri::command]
pub fn fs_scratch_dir(app: tauri::AppHandle, name: String) -> Result<String, String> {
    use tauri::Manager;
    if name.is_empty() || name.contains(['/', '\\', '.']) {
        return Err("invalid scratch name".to_string());
    }
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("scratch").join(name);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn rejects_relative_and_parent_paths() {
        assert!(absolute("relative/file.txt").is_err());
        assert!(absolute("C:\\a\\..\\b.txt").is_err());
        assert!(fs_list_dir("C:\\definitely\\missing\\voxlab".into()).unwrap().is_empty());
    }
}
