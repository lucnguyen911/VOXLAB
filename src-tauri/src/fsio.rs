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

fn dir_size_bytes_excluding(path: &Path, exclude_dir_name: Option<&str>) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    let mut total: u64 = 0;
    for entry in entries.flatten() {
        if let Some(ex) = exclude_dir_name {
            if entry.file_name().to_string_lossy().eq_ignore_ascii_case(ex) {
                continue;
            }
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.is_dir() {
            total = total.saturating_add(dir_size_bytes_excluding(&entry.path(), None));
        } else {
            total = total.saturating_add(meta.len());
        }
    }
    total
}

fn dir_size_bytes(path: &Path) -> u64 {
    dir_size_bytes_excluding(path, None)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStats {
    pub app_data_path: String,
    pub app_data_bytes: u64,
    pub scratch_path: String,
    pub scratch_bytes: u64,
}

#[tauri::command]
pub fn fs_storage_stats(app: tauri::AppHandle) -> Result<StorageStats, String> {
    use tauri::Manager;
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let _ = std::fs::create_dir_all(&app_data_dir);
    let scratch_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("scratch");
    let _ = std::fs::create_dir_all(&scratch_dir);
    let scratch_bytes = dir_size_bytes(&scratch_dir);
    // Exclude "models" directory since AI models have their own dedicated storage tab.
    let app_data_only_bytes = dir_size_bytes_excluding(&app_data_dir, Some("models"));
    let total_bytes = if scratch_dir.starts_with(&app_data_dir) {
        app_data_only_bytes
    } else {
        app_data_only_bytes.saturating_add(scratch_bytes)
    };
    Ok(StorageStats {
        app_data_path: app_data_dir.to_string_lossy().to_string(),
        app_data_bytes: total_bytes,
        scratch_path: scratch_dir.to_string_lossy().to_string(),
        scratch_bytes,
    })
}

#[tauri::command]
pub fn fs_clear_scratch(app: tauri::AppHandle) -> Result<u64, String> {
    use tauri::Manager;
    let scratch_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("scratch");
    let freed = dir_size_bytes(&scratch_dir);
    if scratch_dir.exists() {
        let _ = std::fs::remove_dir_all(&scratch_dir);
    }
    std::fs::create_dir_all(&scratch_dir).map_err(|e| e.to_string())?;
    Ok(freed)
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
}
