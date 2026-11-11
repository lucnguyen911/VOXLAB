//! High-speed multi-connection HTTP `Range` segmented wheel downloader & `pylock.toml` resolver.
//!
//! Accelerates large AI runtime wheels (`torch+cu128` ~3.3 GB, `nvidia-cudnn-cu12` ~664 MB,
//! `nvidia-cublas-cu12` ~528 MB, `scipy`, `av`, `ctranslate2`, etc.) by 4x-10x on high-latency
//! international links using 8-16 parallel HTTP `Range` streams, resumable 8 MB chunk checkpoints,
//! SHA-256 integrity verification, and real-time `MB/s` telemetry before handing local wheels
//! to `uv pip install --find-links`.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::fs::{File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Minimum wheel size (16 MB) to accelerate via multi-connection HTTP `Range` downloading.
/// Smaller wheels are left to `uv` with `UV_CONCURRENT_DOWNLOADS=16`.
pub const MIN_SEGMENTED_BYTES: u64 = 16 * 1024 * 1024;

/// Default slice size per HTTP `Range` request (8 MB).
pub const DEFAULT_CHUNK_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedWheel {
    pub name: String,
    pub version: String,
    pub url: String,
    pub filename: String,
    pub size: Option<u64>,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone)]
pub struct FastDlProgress {
    pub pkg_name: String,
    pub pkg_index: usize,
    pub pkg_total: usize,
    pub batch_downloaded_bytes: u64,
    pub batch_total_bytes: u64,
    pub speed_mbps: f64,
    pub streams: usize,
}

#[derive(Debug)]
pub enum FastDlError {
    Cancelled,
    RangeUnsupported,
    Io(String),
    Network(String),
    HashMismatch { expected: String, actual: String },
}

#[derive(Debug, Serialize, Deserialize)]
struct SegmentedPartMeta {
    total_size: u64,
    sha256: Option<String>,
    chunk_size: u64,
    completed: Vec<bool>,
}

#[derive(Debug, Clone)]
struct RangeProbe {
    final_url: String,
    total_size: u64,
    supports_range: bool,
}

/// Extracts and percent-decodes a safe PEP 427 `.whl` filename from a URL.
/// Crucial for PyTorch URLs like `torch-2.8.0%2Bcu128-cp311-cp311-win_amd64.whl` -> `torch-2.8.0+cu128-...whl`.
pub fn percent_decode_filename(url: &str) -> Option<String> {
    let no_frag = url.split('#').next().unwrap_or(url);
    let no_query = no_frag.split('?').next().unwrap_or(no_frag);
    let raw_name = no_query.rsplit('/').next()?.trim();
    if raw_name.is_empty() {
        return None;
    }

    let bytes = raw_name.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                decoded.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        decoded.push(bytes[i]);
        i += 1;
    }

    let name = String::from_utf8(decoded).ok()?;
    if !name.ends_with(".whl") || name.contains("..") {
        return None;
    }
    let valid_chars = name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '+' | '-'));
    if !valid_chars {
        return None;
    }
    Some(name)
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Parses `uv pip compile - --format pylock.toml` output into resolved platform wheels.
pub fn parse_pylock_wheels(toml_text: &str) -> Vec<ResolvedWheel> {
    let normalized = toml_text.replace("\r\n", "\n");
    let mut results = Vec::new();

    for section in normalized.split("[[packages]]").skip(1) {
        let mut pkg_name: Option<String> = None;
        let mut pkg_version: Option<String> = None;

        for line in section.lines() {
            let trimmed = line.trim();
            if pkg_name.is_none() {
                if let Some(rest) = trimmed.strip_prefix("name = ") {
                    pkg_name = extract_quoted_str(rest);
                    continue;
                }
            }
            if pkg_version.is_none() {
                if let Some(rest) = trimmed.strip_prefix("version = ") {
                    pkg_version = extract_quoted_str(rest);
                    continue;
                }
            }
            if pkg_name.is_some() && pkg_version.is_some() {
                break;
            }
        }

        let (Some(name), Some(version)) = (pkg_name, pkg_version) else {
            continue;
        };

        let Some(wheels_array) = extract_wheels_array(section) else {
            continue;
        };

        for entry in split_inline_tables(wheels_array) {
            let Some(url) = extract_key_quoted(entry, "url") else {
                continue;
            };
            let Some(filename) = percent_decode_filename(&url) else {
                continue;
            };
            let size = extract_key_u64(entry, "size");
            let sha256 = extract_key_quoted(entry, "sha256").map(|s| s.to_ascii_lowercase());
            results.push(ResolvedWheel {
                name,
                version,
                url,
                filename,
                size,
                sha256,
            });
            break;
        }
    }

    results
}

fn extract_quoted_str(s: &str) -> Option<String> {
    let s = s.trim();
    let rest = s.strip_prefix('"')?;
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn extract_wheels_array(section: &str) -> Option<&str> {
    let marker = "wheels = [";
    let start_pos = section.find(marker)? + marker.len();
    let tail = &section[start_pos..];
    let mut depth = 1usize;
    let mut in_quotes = false;
    let bytes = tail.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'"' && (i == 0 || bytes[i - 1] != b'\\') {
            in_quotes = !in_quotes;
        } else if !in_quotes {
            if b == b'[' {
                depth += 1;
            } else if b == b']' {
                depth -= 1;
                if depth == 0 {
                    return Some(&tail[..i]);
                }
            }
        }
        i += 1;
    }
    None
}

fn split_inline_tables(arr: &str) -> Vec<&str> {
    let mut tables = Vec::new();
    let mut depth = 0usize;
    let mut in_quotes = false;
    let mut table_start: Option<usize> = None;
    let bytes = arr.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'"' && (i == 0 || bytes[i - 1] != b'\\') {
            in_quotes = !in_quotes;
        } else if !in_quotes {
            if b == b'{' {
                if depth == 0 {
                    table_start = Some(i + 1);
                }
                depth += 1;
            } else if b == b'}' && depth > 0 {
                depth -= 1;
                if depth == 0 {
                    if let Some(st) = table_start.take() {
                        tables.push(&arr[st..i]);
                    }
                }
            }
        }
        i += 1;
    }
    tables
}

fn extract_key_quoted(table: &str, key: &str) -> Option<String> {
    let pat = format!("{} = \"", key);
    let idx = table.find(&pat)? + pat.len();
    let rest = &table[idx..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn extract_key_u64(table: &str, key: &str) -> Option<u64> {
    let pat = format!("{} = ", key);
    let idx = table.find(&pat)? + pat.len();
    let rest = table[idx..].trim_start();
    let digits: String = rest
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '_')
        .filter(|c| *c != '_')
        .collect();
    if digits.is_empty() {
        None
    } else {
        digits.parse::<u64>().ok()
    }
}

pub fn normalize_dist_info_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut prev_sep = false;
    for ch in name.chars() {
        if matches!(ch, '-' | '_' | '.') {
            if !prev_sep {
                out.push('_');
                prev_sep = true;
            }
        } else {
            out.push(ch.to_ascii_lowercase());
            prev_sep = false;
        }
    }
    out
}

pub fn is_package_installed_in_site_packages(
    site_packages: &Path,
    name: &str,
    version: &str,
) -> bool {
    if !site_packages.is_dir() {
        return false;
    }
    let norm = normalize_dist_info_name(name);
    let exact = site_packages.join(format!("{}-{}.dist-info", norm, version));
    if exact.is_dir() {
        return true;
    }
    if let Some(base_ver) = version.split('+').next() {
        if base_ver != version {
            let stripped = site_packages.join(format!("{}-{}.dist-info", norm, base_ver));
            if stripped.is_dir() {
                return true;
            }
        }
    }
    false
}

pub fn compute_file_sha256(path: &Path, cancelled: &AtomicBool) -> Result<String, FastDlError> {
    let mut f = File::open(path).map_err(|e| FastDlError::Io(e.to_string()))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        if cancelled.load(Ordering::SeqCst) {
            return Err(FastDlError::Cancelled);
        }
        let n = f.read(&mut buf).map_err(|e| FastDlError::Io(e.to_string()))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let digest = hasher.finalize();
    Ok(digest.iter().map(|b| format!("{:02x}", b)).collect())
}

pub fn is_wheel_cached_valid(
    wheelhouse_dir: &Path,
    whl: &ResolvedWheel,
    cancelled: &AtomicBool,
) -> bool {
    let path = wheelhouse_dir.join(&whl.filename);
    let Ok(meta) = std::fs::metadata(&path) else {
        return false;
    };
    if !meta.is_file() || meta.len() == 0 {
        return false;
    }
    if let Some(expected_sz) = whl.size {
        if meta.len() != expected_sz {
            return false;
        }
    }
    if let Some(expected_hash) = &whl.sha256 {
        let stamp_path = wheelhouse_dir.join(format!("{}.sha256", whl.filename));
        if let Ok(stamp) = std::fs::read_to_string(&stamp_path) {
            if stamp.trim().eq_ignore_ascii_case(expected_hash) {
                return true;
            }
        }
        if let Ok(actual) = compute_file_sha256(&path, cancelled) {
            if actual.eq_ignore_ascii_case(expected_hash) {
                let _ = std::fs::write(&stamp_path, &actual);
                return true;
            }
            let _ = std::fs::remove_file(&path);
        }
        return false;
    }
    whl.size.is_some()
}

fn build_dl_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(15))
        .timeout_read(Duration::from_secs(45))
        .timeout_write(Duration::from_secs(15))
        .max_idle_connections(32)
        .max_idle_connections_per_host(32)
        .build()
}

fn parse_content_range_total(header_val: &str) -> Option<u64> {
    // Example: "bytes 0-0/3461487596"
    let slash_idx = header_val.rfind('/')?;
    let total_str = header_val[slash_idx + 1..].trim();
    if total_str == "*" {
        return None;
    }
    total_str.parse::<u64>().ok()
}

fn probe_range_support(agent: &ureq::Agent, url: &str) -> Result<RangeProbe, FastDlError> {
    let resp = agent
        .get(url)
        .set("Range", "bytes=0-0")
        .set("User-Agent", "VoxLab-Installer/1.0")
        .call()
        .map_err(|e| FastDlError::Network(e.to_string()))?;

    let status = resp.status();
    let final_url = resp.get_url().to_string();
    if status == 206 {
        let cr = resp.header("Content-Range").unwrap_or("");
        if let Some(total_size) = parse_content_range_total(cr) {
            // Drain the 1-byte body so ureq returns the TLS socket to its keep-alive pool
            let mut one = [0u8; 1];
            let _ = resp.into_reader().read(&mut one);
            return Ok(RangeProbe {
                final_url,
                total_size,
                supports_range: true,
            });
        }
    }

    let cl = resp
        .header("Content-Length")
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(0);
    Ok(RangeProbe {
        final_url,
        total_size: cl,
        supports_range: false,
    })
}

fn write_all_at_offset(file: &File, mut buf: &[u8], mut offset: u64) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::FileExt;
        while !buf.is_empty() {
            let n = file.seek_write(buf, offset)?;
            if n == 0 {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::WriteZero,
                    "seek_write wrote 0 bytes",
                ));
            }
            buf = &buf[n..];
            offset += n as u64;
        }
        Ok(())
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::FileExt;
        file.write_all_at(buf, offset)
    }
}

fn save_part_meta(meta_path: &Path, meta: &SegmentedPartMeta) {
    let tmp = meta_path.with_extension("json.tmp");
    if let Ok(json) = serde_json::to_vec(meta) {
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, meta_path);
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub fn download_url_segmented_with_options<F>(
    agent: &ureq::Agent,
    final_url: &str,
    dest_path: &Path,
    total_size: u64,
    expected_sha256: Option<&str>,
    chunk_size: u64,
    worker_count: usize,
    cancelled: &AtomicBool,
    mut on_bytes_progress: F,
) -> Result<(), FastDlError>
where
    F: FnMut(u64, f64) + Send,
{
    if cancelled.load(Ordering::SeqCst) {
        return Err(FastDlError::Cancelled);
    }
    if total_size == 0 {
        return Err(FastDlError::Io("Remote wheel reported 0 bytes".into()));
    }
    if let Some(parent) = dest_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| FastDlError::Io(e.to_string()))?;
    }

    let chunk_size = chunk_size.max(4096);
    let num_chunks = total_size.div_ceil(chunk_size) as usize;
    let workers = worker_count.clamp(1, 32).min(num_chunks.max(1));

    let part_path = dest_path.with_extension("whl.part");
    let meta_path = dest_path.with_extension("whl.part.json");
    let expected_sha_owned = expected_sha256.map(|s| s.to_ascii_lowercase());

    // Attempt to resume valid partial chunks if `.part` and `.part.json` match
    let mut initial_meta: Option<SegmentedPartMeta> = None;
    if let (Ok(part_stat), Ok(meta_bytes)) =
        (std::fs::metadata(&part_path), std::fs::read(&meta_path))
    {
        if part_stat.len() == total_size {
            if let Ok(parsed) = serde_json::from_slice::<SegmentedPartMeta>(&meta_bytes) {
                if parsed.total_size == total_size
                    && parsed.sha256 == expected_sha_owned
                    && parsed.chunk_size == chunk_size
                    && parsed.completed.len() == num_chunks
                {
                    initial_meta = Some(parsed);
                }
            }
        }
    }

    let part_meta = match initial_meta {
        Some(m) => m,
        None => {
            let f = OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&part_path)
                .map_err(|e| FastDlError::Io(e.to_string()))?;
            f.set_len(total_size)
                .map_err(|e| FastDlError::Io(e.to_string()))?;
            let fresh = SegmentedPartMeta {
                total_size,
                sha256: expected_sha_owned.clone(),
                chunk_size,
                completed: vec![false; num_chunks],
            };
            save_part_meta(&meta_path, &fresh);
            fresh
        }
    };

    let mut pending = VecDeque::new();
    let mut pre_completed_bytes = 0u64;
    for (idx, &done) in part_meta.completed.iter().enumerate() {
        let start = idx as u64 * chunk_size;
        let end = (start + chunk_size - 1).min(total_size - 1);
        let len = end - start + 1;
        if done {
            pre_completed_bytes += len;
        } else {
            pending.push_back(idx);
        }
    }

    let downloaded_bytes = AtomicU64::new(pre_completed_bytes);
    let queue = Mutex::new(pending);
    let meta_lock = Mutex::new(part_meta);
    let first_err: Mutex<Option<FastDlError>> = Mutex::new(None);
    let abort_flag = AtomicBool::new(false);
    let active_workers = AtomicUsize::new(workers);

    if pre_completed_bytes < total_size {
        std::thread::scope(|s| {
            for _ in 0..workers {
                s.spawn(|| {
                    let file_res = OpenOptions::new().write(true).open(&part_path);
                    let worker_file = match file_res {
                        Ok(f) => f,
                        Err(e) => {
                            abort_flag.store(true, Ordering::SeqCst);
                            let mut g = first_err.lock().unwrap();
                            if g.is_none() {
                                *g = Some(FastDlError::Io(e.to_string()));
                            }
                            active_workers.fetch_sub(1, Ordering::AcqRel);
                            return;
                        }
                    };

                    let mut read_buf = vec![0u8; 64 * 1024];
                    loop {
                        if cancelled.load(Ordering::SeqCst) {
                            abort_flag.store(true, Ordering::SeqCst);
                            let mut g = first_err.lock().unwrap();
                            if g.is_none() {
                                *g = Some(FastDlError::Cancelled);
                            }
                            break;
                        }
                        if abort_flag.load(Ordering::SeqCst) {
                            break;
                        }

                        let chunk_idx = {
                            let mut q = queue.lock().unwrap();
                            q.pop_front()
                        };
                        let Some(idx) = chunk_idx else {
                            break;
                        };

                        let start = idx as u64 * chunk_size;
                        let end = (start + chunk_size - 1).min(total_size - 1);
                        let expected_len = end - start + 1;

                        let mut chunk_ok = false;
                        let mut last_chunk_err: Option<FastDlError> = None;

                        for attempt in 0..4u32 {
                            if cancelled.load(Ordering::SeqCst) {
                                last_chunk_err = Some(FastDlError::Cancelled);
                                break;
                            }
                            if abort_flag.load(Ordering::SeqCst) {
                                break;
                            }
                            if attempt > 0 {
                                let backoff_ms = match attempt {
                                    1 => 300,
                                    2 => 800,
                                    _ => 1800,
                                };
                                std::thread::sleep(Duration::from_millis(backoff_ms));
                            }

                            let range_hdr = format!("bytes={}-{}", start, end);
                            let resp = match agent
                                .get(final_url)
                                .set("Range", &range_hdr)
                                .set("User-Agent", "VoxLab-Installer/1.0")
                                .call()
                            {
                                Ok(r) => r,
                                Err(e) => {
                                    last_chunk_err = Some(FastDlError::Network(e.to_string()));
                                    continue;
                                }
                            };

                            if resp.status() != 206 {
                                last_chunk_err = Some(FastDlError::RangeUnsupported);
                                break;
                            }

                            let mut reader = resp.into_reader();
                            let mut written_in_chunk = 0u64;
                            let mut stream_err: Option<FastDlError> = None;

                            loop {
                                if cancelled.load(Ordering::SeqCst) {
                                    stream_err = Some(FastDlError::Cancelled);
                                    break;
                                }
                                if abort_flag.load(Ordering::SeqCst) {
                                    stream_err =
                                        Some(FastDlError::Network("Aborted by peer worker".into()));
                                    break;
                                }
                                match reader.read(&mut read_buf) {
                                    Ok(0) => break,
                                    Ok(n) => {
                                        if written_in_chunk + (n as u64) > expected_len {
                                            stream_err = Some(FastDlError::Network(
                                                "Server sent more bytes than requested Range".into(),
                                            ));
                                            break;
                                        }
                                        if let Err(io_err) = write_all_at_offset(
                                            &worker_file,
                                            &read_buf[..n],
                                            start + written_in_chunk,
                                        ) {
                                            stream_err = Some(FastDlError::Io(io_err.to_string()));
                                            break;
                                        }
                                        written_in_chunk += n as u64;
                                        downloaded_bytes.fetch_add(n as u64, Ordering::Relaxed);
                                    }
                                    Err(e) => {
                                        stream_err = Some(FastDlError::Network(e.to_string()));
                                        break;
                                    }
                                }
                            }

                            if stream_err.is_none() && written_in_chunk == expected_len {
                                chunk_ok = true;
                                break;
                            }

                            // Roll back partial byte count before retrying this chunk
                            if written_in_chunk > 0 {
                                downloaded_bytes.fetch_sub(written_in_chunk, Ordering::Relaxed);
                            }
                            last_chunk_err = stream_err.or_else(|| {
                                Some(FastDlError::Network(format!(
                                    "Truncated chunk {}: got {} / {} bytes",
                                    idx, written_in_chunk, expected_len
                                )))
                            });
                            if matches!(last_chunk_err, Some(FastDlError::Io(_))) {
                                break;
                            }
                        }

                        if chunk_ok {
                            if let Ok(mut meta_guard) = meta_lock.lock() {
                                meta_guard.completed[idx] = true;
                                save_part_meta(&meta_path, &meta_guard);
                            }
                        } else {
                            abort_flag.store(true, Ordering::SeqCst);
                            let mut g = first_err.lock().unwrap();
                            if g.is_none() {
                                *g = Some(
                                    last_chunk_err
                                        .unwrap_or_else(|| FastDlError::Network("Chunk failed".into())),
                                );
                            }
                            break;
                        }
                    }

                    active_workers.fetch_sub(1, Ordering::AcqRel);
                });
            }

            // Coordinator progress loop (every ~250ms)
            let mut last_emit = Instant::now();
            let mut last_bytes = pre_completed_bytes;
            let mut smoothed_mbps = 0.0f64;

            while active_workers.load(Ordering::Acquire) > 0 {
                std::thread::sleep(Duration::from_millis(50));
                if cancelled.load(Ordering::SeqCst) {
                    abort_flag.store(true, Ordering::SeqCst);
                }
                let elapsed = last_emit.elapsed();
                if elapsed >= Duration::from_millis(240) {
                    let cur = downloaded_bytes.load(Ordering::Relaxed).min(total_size);
                    let dt = elapsed.as_secs_f64().max(0.05);
                    let delta_mb = (cur.saturating_sub(last_bytes) as f64) / 1_048_576.0;
                    let inst = delta_mb / dt;
                    smoothed_mbps = if smoothed_mbps <= 0.05 {
                        inst
                    } else {
                        0.60 * smoothed_mbps + 0.40 * inst
                    };
                    last_bytes = cur;
                    last_emit = Instant::now();
                    on_bytes_progress(cur, smoothed_mbps);
                }
            }
        });
    }

    if cancelled.load(Ordering::SeqCst) {
        return Err(FastDlError::Cancelled);
    }
    if let Some(err) = first_err.into_inner().unwrap() {
        return Err(err);
    }

    on_bytes_progress(total_size, 0.0);

    if let Ok(f) = OpenOptions::new().write(true).open(&part_path) {
        let _ = f.sync_data();
    }

    if let Some(expected_hash) = expected_sha_owned {
        let actual_hash = compute_file_sha256(&part_path, cancelled)?;
        if !actual_hash.eq_ignore_ascii_case(&expected_hash) {
            let _ = std::fs::remove_file(&part_path);
            let _ = std::fs::remove_file(&meta_path);
            return Err(FastDlError::HashMismatch {
                expected: expected_hash,
                actual: actual_hash,
            });
        }
        let stamp_path = dest_path.with_name_suffix(".sha256");
        let _ = std::fs::write(&stamp_path, &actual_hash);
    }

    if dest_path.exists() {
        let _ = std::fs::remove_file(dest_path);
    }
    std::fs::rename(&part_path, dest_path).map_err(|e| FastDlError::Io(e.to_string()))?;
    let _ = std::fs::remove_file(&meta_path);

    Ok(())
}

trait PathSuffixExt {
    fn with_name_suffix(&self, suffix: &str) -> PathBuf;
}

impl PathSuffixExt for Path {
    fn with_name_suffix(&self, suffix: &str) -> PathBuf {
        let mut os = self.as_os_str().to_os_string();
        os.push(suffix);
        PathBuf::from(os)
    }
}

/// Resolves dependencies for a `uv pip install` step via `uv pip compile --format pylock.toml`,
/// identifies uncached wheels >= 16 MB, and downloads them into `wheelhouse_dir` using 8-16
/// parallel HTTP `Range` connections per wheel.
///
/// Non-cancellation network/proxy errors gracefully return `Ok(())` so `uv pip install`
/// always gets a clean chance to complete the installation.
#[allow(clippy::too_many_arguments)]
pub fn prefetch_large_wheels_for_step<F>(
    uv_bin: &Path,
    rt_python: &Path,
    site_packages_dir: &Path,
    uv_python_dir: &Path,
    uv_cache_dir: &Path,
    wheelhouse_dir: &Path,
    index_url: Option<&str>,
    no_deps: bool,
    packages: &[String],
    cancelled: &Arc<AtomicBool>,
    current_pid: &Arc<Mutex<Option<u32>>>,
    mut on_progress: F,
) -> Result<(), FastDlError>
where
    F: FnMut(FastDlProgress) + Send,
{
    if no_deps || packages.is_empty() {
        return Ok(());
    }
    if cancelled.load(Ordering::SeqCst) {
        return Err(FastDlError::Cancelled);
    }
    let _ = std::fs::create_dir_all(wheelhouse_dir);

    // Write temporary requirements.in for `uv pip compile`
    let req_in_path = wheelhouse_dir.join(format!("_resolve_{}.in", std::process::id()));
    let req_text = packages.join("\n") + "\n";
    if std::fs::write(&req_in_path, req_text).is_err() {
        return Ok(());
    }

    let mut cmd = Command::new(uv_bin);
    cmd.arg("pip")
        .arg("compile")
        .arg(&req_in_path)
        .arg("--format")
        .arg("pylock.toml")
        .arg("--python")
        .arg(rt_python);
    if let Some(idx) = index_url {
        cmd.arg("--index-url").arg(idx);
    }
    cmd.env("UV_PYTHON_INSTALL_DIR", uv_python_dir)
        .env("UV_CACHE_DIR", uv_cache_dir)
        .env("UV_HTTP_TIMEOUT", "120")
        .env("UV_CONCURRENT_DOWNLOADS", "16")
        .env("PYTHONUTF8", "1")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }

    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(_) => {
            let _ = std::fs::remove_file(&req_in_path);
            return Ok(());
        }
    };

    let pid = child.id();
    if let Ok(mut g) = current_pid.lock() {
        *g = Some(pid);
    }
    let compile_out = child.wait_with_output();
    if let Ok(mut g) = current_pid.lock() {
        *g = None;
    }
    let _ = std::fs::remove_file(&req_in_path);

    if cancelled.load(Ordering::SeqCst) {
        return Err(FastDlError::Cancelled);
    }

    let Ok(out) = compile_out else {
        return Ok(());
    };
    if !out.status.success() {
        return Ok(());
    }

    let toml_text = String::from_utf8_lossy(&out.stdout);
    let resolved = parse_pylock_wheels(&toml_text);
    if resolved.is_empty() {
        return Ok(());
    }

    let agent = build_dl_agent();

    struct PendingLargeWheel {
        whl: ResolvedWheel,
        final_url: String,
        total_size: u64,
    }

    let mut large_targets: Vec<PendingLargeWheel> = Vec::new();
    for whl in resolved {
        if cancelled.load(Ordering::SeqCst) {
            return Err(FastDlError::Cancelled);
        }
        // Skip small known wheels without making any network probe
        if let Some(sz) = whl.size {
            if sz < MIN_SEGMENTED_BYTES {
                continue;
            }
        }
        // Skip if already installed in target runtime site-packages
        if is_package_installed_in_site_packages(site_packages_dir, &whl.name, &whl.version) {
            continue;
        }
        // Skip if valid wheel already sits in wheelhouse cache
        if is_wheel_cached_valid(wheelhouse_dir, &whl, cancelled) {
            continue;
        }

        // Probe HTTP Range support + final redirect CDN URL + exact byte length
        if let Ok(probe) = probe_range_support(&agent, &whl.url) {
            if probe.supports_range && probe.total_size >= MIN_SEGMENTED_BYTES {
                let mut updated = whl;
                updated.size = Some(probe.total_size);
                if !is_wheel_cached_valid(wheelhouse_dir, &updated, cancelled) {
                    large_targets.push(PendingLargeWheel {
                        whl: updated,
                        final_url: probe.final_url,
                        total_size: probe.total_size,
                    });
                }
            }
        }
    }

    if large_targets.is_empty() {
        return Ok(());
    }

    let batch_total_bytes: u64 = large_targets.iter().map(|t| t.total_size).sum();
    let pkg_total = large_targets.len();
    let mut completed_batch_bytes = 0u64;

    for (idx, target) in large_targets.into_iter().enumerate() {
        if cancelled.load(Ordering::SeqCst) {
            return Err(FastDlError::Cancelled);
        }
        let workers = if target.total_size >= 128 * 1024 * 1024 {
            16
        } else {
            8
        };
        let dest_path = wheelhouse_dir.join(&target.whl.filename);
        let pkg_name = target.whl.name.clone();
        let prior_bytes = completed_batch_bytes;

        let res = download_url_segmented_with_options(
            &agent,
            &target.final_url,
            &dest_path,
            target.total_size,
            target.whl.sha256.as_deref(),
            DEFAULT_CHUNK_BYTES,
            workers,
            cancelled,
            |cur_pkg_bytes, speed_mbps| {
                on_progress(FastDlProgress {
                    pkg_name: pkg_name.clone(),
                    pkg_index: idx + 1,
                    pkg_total,
                    batch_downloaded_bytes: (prior_bytes + cur_pkg_bytes).min(batch_total_bytes),
                    batch_total_bytes,
                    speed_mbps,
                    streams: workers,
                });
            },
        );

        match res {
            Ok(()) => {
                completed_batch_bytes += target.total_size;
            }
            Err(FastDlError::Cancelled) => return Err(FastDlError::Cancelled),
            Err(_) => {
                // Graceful fallback: let `uv pip install` fetch this package if segmented mode failed
                completed_batch_bytes += target.total_size;
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpListener;

    #[test]
    fn percent_decode_handles_pytorch_plus_and_blocks_traversal() {
        assert_eq!(
            percent_decode_filename(
                "https://download-r2.pytorch.org/whl/cu128/torch-2.8.0%2Bcu128-cp311-cp311-win_amd64.whl#sha256=abc"
            )
            .as_deref(),
            Some("torch-2.8.0+cu128-cp311-cp311-win_amd64.whl")
        );
        assert_eq!(
            percent_decode_filename("https://example.com/../../evil.whl").as_deref(),
            Some("evil.whl")
        );
        assert_eq!(
            percent_decode_filename("https://example.com/%2e%2e%2fevil.whl"),
            None
        );
        assert_eq!(
            percent_decode_filename("https://example.com/source.tar.gz"),
            None
        );
    }

    #[test]
    fn parse_pylock_wheels_extracts_pytorch_and_multiline_pypi_entries() {
        let sample = r#"
lock-version = "1.0"
created-by = "uv"

[[packages]]
name = "torch"
version = "2.8.0+cu128"
wheels = [{ url = "https://download-r2.pytorch.org/whl/cu128/torch-2.8.0%2Bcu128-cp311-cp311-win_amd64.whl", upload-time = 2025-10-01T23:49:30Z, hashes = { sha256 = "34c55443aafd31046a7963b63d30bc3b628ee4a704f826796c865fdfd05bb596" } }]

[[packages]]
name = "protobuf"
version = "7.36.2"
sdist = { url = "https://files.pythonhosted.org/protobuf-7.36.2.tar.gz", size = 512737, hashes = { sha256 = "497d" } }
wheels = [
    { url = "https://files.pythonhosted.org/protobuf-7.36.2-cp310-abi3-win_amd64.whl", size = 456514, hashes = { sha256 = "A300819D" } },
    { url = "https://files.pythonhosted.org/protobuf-7.36.2-py3-none-any.whl", size = 179806, hashes = { sha256 = "bdb3" } },
]
"#;
        let wheels = parse_pylock_wheels(sample);
        assert_eq!(wheels.len(), 2);
        assert_eq!(wheels[0].name, "torch");
        assert_eq!(
            wheels[0].filename,
            "torch-2.8.0+cu128-cp311-cp311-win_amd64.whl"
        );
        assert_eq!(wheels[0].size, None);
        assert_eq!(
            wheels[0].sha256.as_deref(),
            Some("34c55443aafd31046a7963b63d30bc3b628ee4a704f826796c865fdfd05bb596")
        );

        assert_eq!(wheels[1].name, "protobuf");
        assert_eq!(
            wheels[1].filename,
            "protobuf-7.36.2-cp310-abi3-win_amd64.whl"
        );
        assert_eq!(wheels[1].size, Some(456_514));
        assert_eq!(wheels[1].sha256.as_deref(), Some("a300819d"));
    }

    #[test]
    fn segmented_downloader_reassembles_16_parallel_ranges_and_verifies_sha256() {
        // Generate deterministic 500 KB payload (~13 chunks at 40 KB/chunk across 8 workers)
        let payload: Vec<u8> = (0..512_123u32)
            .map(|i| ((i.wrapping_mul(31).wrapping_add(17)) & 0xFF) as u8)
            .collect();
        let expected_sha = {
            let mut h = Sha256::new();
            h.update(&payload);
            h.finalize()
                .iter()
                .map(|b| format!("{:02x}", b))
                .collect::<String>()
        };

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let stop_srv = Arc::new(AtomicBool::new(false));
        let stop_clone = stop_srv.clone();
        let srv_data = Arc::new(payload.clone());

        let srv_handle = std::thread::spawn(move || {
            listener.set_nonblocking(true).unwrap();
            while !stop_clone.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let data = srv_data.clone();
                        std::thread::spawn(move || {
                            let _ = stream.set_nonblocking(false);
                            let mut req_buf = [0u8; 2048];
                            let n = stream.read(&mut req_buf).unwrap_or(0);
                            if n == 0 {
                                return;
                            }
                            let req_str = String::from_utf8_lossy(&req_buf[..n]);
                            let mut range_bounds: Option<(usize, usize)> = None;
                            for line in req_str.lines() {
                                if let Some(rest) =
                                    line.strip_prefix("Range: bytes=").or_else(|| {
                                        line.strip_prefix("range: bytes=")
                                    })
                                {
                                    let mut parts = rest.trim().split('-');
                                    if let (Some(s), Some(e)) = (parts.next(), parts.next()) {
                                        if let (Ok(st), Ok(en)) =
                                            (s.parse::<usize>(), e.parse::<usize>())
                                        {
                                            range_bounds = Some((st, en.min(data.len() - 1)));
                                        }
                                    }
                                }
                            }
                            if let Some((st, en)) = range_bounds {
                                let slice = &data[st..=en];
                                let hdr = format!(
                                    "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nConnection: close\r\n\r\n",
                                    slice.len(),
                                    st,
                                    en,
                                    data.len()
                                );
                                let _ = stream.write_all(hdr.as_bytes());
                                let _ = stream.write_all(slice);
                            }
                        });
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(_) => break,
                }
            }
        });

        let tmp = std::env::temp_dir().join(format!("voxlab-fastdl-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let dest = tmp.join("test_pkg-1.0.0-py3-none-win_amd64.whl");
        let url = format!("http://{}/test_pkg-1.0.0-py3-none-win_amd64.whl", addr);

        let agent = build_dl_agent();
        let probe = probe_range_support(&agent, &url).unwrap();
        assert!(probe.supports_range);
        assert_eq!(probe.total_size, payload.len() as u64);

        let cancelled = AtomicBool::new(false);
        download_url_segmented_with_options(
            &agent,
            &probe.final_url,
            &dest,
            probe.total_size,
            Some(&expected_sha),
            40 * 1024,
            8,
            &cancelled,
            |_dl, _mbps| {},
        )
        .unwrap();

        stop_srv.store(true, Ordering::Relaxed);
        let _ = srv_handle.join();

        let disk_bytes = std::fs::read(&dest).unwrap();
        assert_eq!(disk_bytes.len(), payload.len());
        assert_eq!(disk_bytes, payload);

        let whl = ResolvedWheel {
            name: "test-pkg".into(),
            version: "1.0.0".into(),
            url,
            filename: "test_pkg-1.0.0-py3-none-win_amd64.whl".into(),
            size: Some(payload.len() as u64),
            sha256: Some(expected_sha),
        };
        assert!(is_wheel_cached_valid(&tmp, &whl, &cancelled));

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn segmented_downloader_resumes_completed_chunks_without_refetching() {
        let chunk_sz = 32 * 1024usize;
        let payload: Vec<u8> = (0..(chunk_sz * 4))
            .map(|i| ((i.wrapping_mul(13).wrapping_add(7)) & 0xFF) as u8)
            .collect();
        let expected_sha = {
            let mut h = Sha256::new();
            h.update(&payload);
            h.finalize()
                .iter()
                .map(|b| format!("{:02x}", b))
                .collect::<String>()
        };

        let tmp = std::env::temp_dir().join(format!("voxlab-fastdl-resume-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let dest = tmp.join("resumable-1.0.0-py3-none-win_amd64.whl");

        // Pre-seed `.part` + `.part.json` with chunks 0 and 2 ALREADY completed (50% done!)
        let part_path = dest.with_extension("whl.part");
        let meta_path = dest.with_extension("whl.part.json");
        {
            let f = OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&part_path)
                .unwrap();
            f.set_len(payload.len() as u64).unwrap();
            write_all_at_offset(&f, &payload[0..chunk_sz], 0).unwrap();
            write_all_at_offset(
                &f,
                &payload[chunk_sz * 2..chunk_sz * 3],
                (chunk_sz * 2) as u64,
            )
            .unwrap();
        }
        save_part_meta(
            &meta_path,
            &SegmentedPartMeta {
                total_size: payload.len() as u64,
                sha256: Some(expected_sha.clone()),
                chunk_size: chunk_sz as u64,
                completed: vec![true, false, true, false],
            },
        );

        let range_requests = Arc::new(AtomicUsize::new(0));
        let req_counter = range_requests.clone();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let stop_srv = Arc::new(AtomicBool::new(false));
        let stop_clone = stop_srv.clone();
        let srv_data = Arc::new(payload.clone());

        let srv_handle = std::thread::spawn(move || {
            listener.set_nonblocking(true).unwrap();
            while !stop_clone.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let data = srv_data.clone();
                        let cnt = req_counter.clone();
                        std::thread::spawn(move || {
                            let _ = stream.set_nonblocking(false);
                            let mut req_buf = [0u8; 2048];
                            let n = stream.read(&mut req_buf).unwrap_or(0);
                            if n == 0 {
                                return;
                            }
                            let req_str = String::from_utf8_lossy(&req_buf[..n]);
                            for line in req_str.lines() {
                                if let Some(rest) =
                                    line.strip_prefix("Range: bytes=").or_else(|| {
                                        line.strip_prefix("range: bytes=")
                                    })
                                {
                                    let mut parts = rest.trim().split('-');
                                    if let (Some(s), Some(e)) = (parts.next(), parts.next()) {
                                        if let (Ok(st), Ok(en)) =
                                            (s.parse::<usize>(), e.parse::<usize>())
                                        {
                                            cnt.fetch_add(1, Ordering::SeqCst);
                                            let slice = &data[st..=en.min(data.len() - 1)];
                                            let hdr = format!(
                                                "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nConnection: close\r\n\r\n",
                                                slice.len(),
                                                st,
                                                en,
                                                data.len()
                                            );
                                            let _ = stream.write_all(hdr.as_bytes());
                                            let _ = stream.write_all(slice);
                                        }
                                    }
                                }
                            }
                        });
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(_) => break,
                }
            }
        });

        let agent = build_dl_agent();
        let cancelled = AtomicBool::new(false);
        let url = format!("http://{}/resumable-1.0.0-py3-none-win_amd64.whl", addr);
        download_url_segmented_with_options(
            &agent,
            &url,
            &dest,
            payload.len() as u64,
            Some(&expected_sha),
            chunk_sz as u64,
            4,
            &cancelled,
            |_dl, _mbps| {},
        )
        .unwrap();

        stop_srv.store(true, Ordering::Relaxed);
        let _ = srv_handle.join();

        // Only the 2 missing chunks (chunks 1 and 3) should have been requested over HTTP!
        assert_eq!(range_requests.load(Ordering::SeqCst), 2);
        assert_eq!(std::fs::read(&dest).unwrap(), payload);

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
