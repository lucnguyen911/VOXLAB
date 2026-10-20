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

#[tauri::command]
pub async fn fs_read_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    let p = absolute(&path)?;
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

#[tauri::command]
pub fn fs_show_in_folder(path: String) -> Result<(), String> {
    let p = absolute(&path)?;
    #[cfg(target_os = "windows")]
    {
        let arg = if p.is_dir() {
            p.to_string_lossy().to_string()
        } else {
            format!("/select,\"{}\"", p.to_string_lossy())
        };
        std::process::Command::new("explorer.exe")
            .arg(arg)
            .spawn()
            .map_err(|e| e.to_string())?;
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
