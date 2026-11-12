//! Self-contained AI runtime & model weights installer for commercial Windows builds.
//!
//! Enables clean Windows PCs (with zero Python, pip, Git, or CUDA Toolkit pre-installed)
//! to install GPU-accelerated (CUDA 12.8) or CPU AI runtimes into `<appData>/runtimes/<rt>`
//! via bundled `uv.exe` and download HuggingFace model weights into `<modelsDir>/<modelId>`
//! with real-time progress and instant cancellation.

use crate::ai::models::{self, ModelSpec, ModelStatus, MODELS};
use crate::ai::sidecar::{AiError, SidecarManager};
use serde::Serialize;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareAcceleratorInfo {
    pub has_nvidia_gpu: bool,
    pub gpu_name: Option<String>,
    pub mode: String, // "cuda" | "cpu"
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInstallProgressEvent {
    pub model_id: String,
    pub status: String, // "installing" | "completed" | "cancelled" | "error"
    pub stage: String,  // "preparing" | "runtime" | "weights" | "verifying" | "done"
    pub pct: f64,
    pub message: String,
    pub downloaded_mb: Option<f64>,
    pub total_mb: Option<f64>,
    pub speed_mbps: Option<f64>,
}

pub const BOOTSTRAP_JOB_ID: &str = "__bootstrap__";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBootstrapStatus {
    pub ready: bool,
    pub has_nvidia_gpu: bool,
    pub gpu_name: Option<String>,
    pub missing_runtimes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UvInstallStep {
    pub label: String,
    pub index_url: Option<String>,
    pub no_deps: bool,
    pub packages: Vec<String>,
}

struct ActiveInstallJob {
    model_id: String,
    cancelled: Arc<AtomicBool>,
    current_pid: Arc<Mutex<Option<u32>>>,
}

fn active_install_slot() -> &'static Mutex<Option<ActiveInstallJob>> {
    static SLOT: OnceLock<Mutex<Option<ActiveInstallJob>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

fn cached_hw_info() -> &'static OnceLock<HardwareAcceleratorInfo> {
    static HW: OnceLock<HardwareAcceleratorInfo> = OnceLock::new();
    &HW
}

pub fn detect_hardware_accelerator() -> HardwareAcceleratorInfo {
    cached_hw_info()
        .get_or_init(|| {
            let mut cmd = Command::new("nvidia-smi");
            cmd.args(["--query-gpu=name", "--format=csv,noheader"])
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x0800_0000;
                cmd.creation_flags(CREATE_NO_WINDOW);
            }
            if let Ok(out) = cmd.output() {
                if out.status.success() {
                    let text = String::from_utf8_lossy(&out.stdout);
                    if let Some(first_line) = text.lines().map(str::trim).find(|l| !l.is_empty()) {
                        return HardwareAcceleratorInfo {
                            has_nvidia_gpu: true,
                            gpu_name: Some(first_line.to_string()),
                            mode: "cuda".to_string(),
                        };
                    }
                }
            }

            #[cfg(windows)]
            {
                let sys_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
                let nvcuda = PathBuf::from(sys_root).join("System32").join("nvcuda.dll");
                if nvcuda.is_file() {
                    return HardwareAcceleratorInfo {
                        has_nvidia_gpu: true,
                        gpu_name: Some("NVIDIA CUDA GPU".to_string()),
                        mode: "cuda".to_string(),
                    };
                }
            }

            HardwareAcceleratorInfo {
                has_nvidia_gpu: false,
                gpu_name: None,
                mode: "cpu".to_string(),
            }
        })
        .clone()
}

pub fn allow_patterns_for_model(model_id: &str) -> Option<Vec<&'static str>> {
    match model_id {
        "faster-whisper-large-v3-turbo" | "faster-whisper-large-v3" => Some(vec![
            "model.bin",
            "config.json",
            "tokenizer.json",
            "vocabulary.*",
            "preprocessor_config.json",
        ]),
        "faster-whisper-medium" | "faster-whisper-small" => Some(vec![
            "model.bin",
            "config.json",
            "tokenizer.json",
            "vocabulary.*",
        ]),
        "chatterbox-turbo" => Some(vec![
            "ve.safetensors",
            "t3_turbo_v1.safetensors",
            "t3_turbo_v1.yaml",
            "s3gen_meanflow.safetensors",
            "vocab.json",
            "merges.txt",
            "tokenizer_config.json",
            "special_tokens_map.json",
            "added_tokens.json",
            "conds.pt",
            "README.md",
        ]),
        // omnivoice & qwen3-tts-1.7b-base download full repo (including audio_tokenizer / speech_tokenizer subdirs)
        _ => None,
    }
}

fn json_str_vec(val: &serde_json::Value, key: &str) -> Vec<String> {
    val.get(key)
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

pub fn build_uv_install_steps(engine: &str, has_nvidia_gpu: bool) -> Result<Vec<UvInstallStep>, AiError> {
    let raw = crate::security::obf::decode_ai_runtime_specs_json();
    let spec_doc: serde_json::Value = serde_json::from_slice(raw.as_bytes()).map_err(|_| {
        AiError::new("INTERNAL", "Không thể đọc cấu hình môi trường thực thi.")
    })?;

    let torch_index_key = if has_nvidia_gpu {
        "torch_cu128_index"
    } else {
        "torch_cpu_index"
    };
    let torch_index = spec_doc
        .get(torch_index_key)
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let torch_packages = json_str_vec(&spec_doc, "torch_packages");
    let torch_label = "Đang đồng bộ nhân xử lý tốc độ cao...";

    match engine {
        "faster-whisper" => {
            let mut pkgs = json_str_vec(&spec_doc, "whisper_base");
            if has_nvidia_gpu {
                pkgs.extend(json_str_vec(&spec_doc, "whisper_cuda_extra"));
            }
            Ok(vec![UvInstallStep {
                label: "Đang cấu hình thành phần xử lý giọng nói...".to_string(),
                index_url: None,
                no_deps: false,
                packages: pkgs,
            }])
        }
        "omnivoice" => {
            let leaf = spec_doc
                .get("omnivoice_leaf")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            Ok(vec![
                UvInstallStep {
                    label: torch_label.to_string(),
                    index_url: Some(torch_index),
                    no_deps: false,
                    packages: torch_packages,
                },
                UvInstallStep {
                    label: "Đang cấu hình thành phần tổng hợp âm thanh...".to_string(),
                    index_url: None,
                    no_deps: false,
                    packages: json_str_vec(&spec_doc, "omnivoice_deps"),
                },
                UvInstallStep {
                    label: "Đang hoàn tất kích hoạt mô hình...".to_string(),
                    index_url: None,
                    no_deps: true,
                    packages: vec![leaf],
                },
            ])
        }
        "chatterbox" => {
            let leaf = spec_doc
                .get("chatterbox_leaf")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            Ok(vec![
                UvInstallStep {
                    label: torch_label.to_string(),
                    index_url: Some(torch_index),
                    no_deps: false,
                    packages: torch_packages,
                },
                UvInstallStep {
                    label: "Đang cấu hình thành phần tổng hợp âm thanh...".to_string(),
                    index_url: None,
                    no_deps: false,
                    packages: json_str_vec(&spec_doc, "chatterbox_deps"),
                },
                UvInstallStep {
                    label: "Đang hoàn tất kích hoạt mô hình...".to_string(),
                    index_url: None,
                    no_deps: true,
                    packages: vec![leaf],
                },
            ])
        }
        "qwen" => {
            let leaf = spec_doc
                .get("qwen_leaf")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            Ok(vec![
                UvInstallStep {
                    label: torch_label.to_string(),
                    index_url: Some(torch_index),
                    no_deps: false,
                    packages: torch_packages,
                },
                UvInstallStep {
                    label: "Đang cấu hình thành phần tổng hợp âm thanh...".to_string(),
                    index_url: None,
                    no_deps: false,
                    packages: json_str_vec(&spec_doc, "qwen_deps"),
                },
                UvInstallStep {
                    label: "Đang hoàn tất kích hoạt mô hình...".to_string(),
                    index_url: None,
                    no_deps: true,
                    packages: vec![leaf],
                },
            ])
        }
        _ => Err(AiError::new(
            "INVALID_REQUEST",
            "Không hỗ trợ khởi tạo tự động thành phần này.",
        )),
    }
}

fn resolve_uv_binary(dev_sidecar_root: Option<&Path>) -> Result<PathBuf, AiError> {
    let bin_name = if cfg!(windows) { "uv.exe" } else { "uv" };
    let mut candidates = Vec::new();

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("sidecar").join("tools").join(bin_name));
            candidates.push(
                exe_dir
                    .join("resources")
                    .join("sidecar")
                    .join("tools")
                    .join(bin_name),
            );
        }
    }

    if let Some(dev_root) = dev_sidecar_root {
        candidates.push(dev_root.join("tools").join(bin_name));
    }

    for cand in candidates {
        if cand.is_file() {
            return Ok(cand);
        }
    }

    // Fallback to system PATH if developer has uv installed globally
    let mut probe = Command::new(bin_name);
    probe
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        probe.creation_flags(0x0800_0000);
    }
    if probe.status().map(|s| s.success()).unwrap_or(false) {
        return Ok(PathBuf::from(bin_name));
    }

    Err(AiError::new(
        "INSTALLER_TOOL_MISSING",
        "Không tìm thấy bộ công cụ khởi tạo môi trường nội bộ. Vui lòng cài lại bộ cài VoxLab.",
    ))
}

fn kill_process_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x0800_0000)
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .status();
    }
}

pub fn cancel_active_install(model_id: Option<&str>) -> Result<bool, AiError> {
    let guard = active_install_slot()
        .lock()
        .map_err(|_| AiError::new("INTERNAL", "install lock poisoned"))?;
    let Some(job) = guard.as_ref() else {
        return Ok(false);
    };
    if let Some(req_id) = model_id {
        if !req_id.trim().is_empty() && job.model_id != req_id {
            return Ok(false);
        }
    }
    job.cancelled.store(true, Ordering::SeqCst);
    if let Ok(pid_guard) = job.current_pid.lock() {
        if let Some(pid) = *pid_guard {
            kill_process_tree(pid);
        }
    }
    Ok(true)
}

fn configure_hidden_command(cmd: &mut Command) {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

fn run_monitored_child<F>(
    mut child: Child,
    cancelled: &Arc<AtomicBool>,
    pid_slot: &Arc<Mutex<Option<u32>>>,
    mut on_line: F,
) -> Result<(), AiError>
where
    F: FnMut(&str) + Send,
{
    let pid = child.id();
    if let Ok(mut guard) = pid_slot.lock() {
        *guard = Some(pid);
    }
    if cancelled.load(Ordering::SeqCst) {
        kill_process_tree(pid);
        let _ = child.wait();
        if let Ok(mut guard) = pid_slot.lock() {
            *guard = None;
        }
        return Err(AiError::new("CANCELLED", "Đã hủy cài đặt mô hình."));
    }

    let (line_tx, line_rx) = std::sync::mpsc::channel::<String>();
    if let Some(stdout) = child.stdout.take() {
        let tx = line_tx.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let _ = tx.send(line);
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let tx = line_tx.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let _ = tx.send(line);
            }
        });
    }
    drop(line_tx);

    let mut tail_lines: Vec<String> = Vec::new();
    while let Ok(line) = line_rx.recv() {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            on_line(trimmed);
            if !trimmed.starts_with("VOXLAB_DL_PROGRESS:") {
                tail_lines.push(trimmed.to_string());
                if tail_lines.len() > 12 {
                    tail_lines.remove(0);
                }
            }
        }
    }

    let status = child
        .wait()
        .map_err(|e| AiError::new("INSTALL_FAILED", format!("Lỗi tiến trình cài đặt: {}", e)))?;
    if let Ok(mut guard) = pid_slot.lock() {
        *guard = None;
    }

    if cancelled.load(Ordering::SeqCst) {
        return Err(AiError::new("CANCELLED", "Đã hủy cài đặt mô hình."));
    }

    if !status.success() {
        let detail = tail_lines.join(" | ");
        return Err(AiError::new(
            "INSTALL_FAILED",
            if detail.is_empty() {
                format!("Tiến trình cài đặt kết thúc với mã lỗi {:?}.", status.code())
            } else {
                format!("Cài đặt thất bại: {}", detail)
            },
        ));
    }

    Ok(())
}

fn resolve_runtime_python(
    runtime: &str,
    app_data_dir: &Path,
    dev_sidecar_root: Option<&Path>,
) -> Option<PathBuf> {
    let user_py = if cfg!(windows) {
        app_data_dir
            .join("runtimes")
            .join(runtime)
            .join("Scripts")
            .join("python.exe")
    } else {
        app_data_dir
            .join("runtimes")
            .join(runtime)
            .join("bin")
            .join("python")
    };
    if user_py.is_file() {
        return Some(user_py);
    }

    if let Some(dev_root) = dev_sidecar_root {
        let venv = match runtime {
            "core" => ".venv",
            "chatterbox" => ".venv-chatterbox",
            "qwen" => ".venv-qwen",
            _ => ".venv",
        };
        let dev_py = if cfg!(windows) {
            dev_root.join(venv).join("Scripts").join("python.exe")
        } else {
            dev_root.join(venv).join("bin").join("python")
        };
        if dev_py.is_file() {
            return Some(dev_py);
        }
    }

    None
}

fn build_hf_downloader_cfg_preamble(
    model_id: &str,
    repo_id: &str,
    dest_dir: &Path,
    allow_patterns: &Option<Vec<&str>>,
    approx_size_mb: u32,
) -> String {
    let cfg_val = serde_json::json!({
        "model_id": model_id,
        "repo_id": repo_id,
        "dest_dir": dest_dir.to_string_lossy(),
        "allow_patterns": allow_patterns,
        "fallback_total_mb": approx_size_mb,
    });
    let mut cfg_json = serde_json::to_string(&cfg_val).unwrap_or_else(|_| "{}".into());
    let mut hex_cfg = String::with_capacity(cfg_json.len() * 2);
    for &b in cfg_json.as_bytes() {
        use std::fmt::Write as _;
        let _ = write!(&mut hex_cfg, "{:02x}", b);
    }
    unsafe {
        for b in cfg_json.as_bytes_mut() {
            std::ptr::write_volatile(b, 0);
        }
    }
    let preamble = format!(
        "import json as _vxl_json\n_VOXLAB_CFG = _vxl_json.loads(bytes.fromhex(\"{}\").decode(\"utf-8\"))\n",
        hex_cfg
    );
    unsafe {
        for b in hex_cfg.as_bytes_mut() {
            std::ptr::write_volatile(b, 0);
        }
    }
    preamble
}

pub fn install_model_blocking<F>(
    spec: &'static ModelSpec,
    models_dir: &Path,
    app_data_dir: &Path,
    dev_sidecar_root: Option<&Path>,
    sidecar_mgr: &SidecarManager,
    mut emit: F,
) -> Result<ModelStatus, AiError>
where
    F: FnMut(ModelInstallProgressEvent) + Send,
{
    let cancelled = Arc::new(AtomicBool::new(false));
    let current_pid = Arc::new(Mutex::new(None));

    {
        let mut guard = active_install_slot()
            .lock()
            .map_err(|_| AiError::new("INTERNAL", "install lock poisoned"))?;
        if let Some(existing) = guard.as_ref() {
            return Err(AiError::new(
                "INSTALL_BUSY",
                format!(
                    "Mô hình '{}' đang được cài đặt. Vui lòng đợi hoàn tất hoặc nhấn Hủy trước khi cài đặt mô hình khác.",
                    existing.model_id
                ),
            ));
        }
        *guard = Some(ActiveInstallJob {
            model_id: spec.id.to_string(),
            cancelled: cancelled.clone(),
            current_pid: current_pid.clone(),
        });
    }

    let result = install_model_inner(
        spec,
        models_dir,
        app_data_dir,
        dev_sidecar_root,
        sidecar_mgr,
        &cancelled,
        &current_pid,
        &mut emit,
    );

    if let Ok(mut guard) = active_install_slot().lock() {
        *guard = None;
    }

    match &result {
        Ok(st) => {
            emit(ModelInstallProgressEvent {
                model_id: spec.id.to_string(),
                status: "completed".to_string(),
                stage: "done".to_string(),
                pct: 100.0,
                message: format!("Đã cài đặt sẵn sàng {} ({} MB).", spec.display_name, st.size_on_disk_mb),
                downloaded_mb: Some(st.size_on_disk_mb as f64),
                total_mb: Some(st.size_on_disk_mb as f64),
                speed_mbps: None,
            });
        }
        Err(err) if err.code == "CANCELLED" => {
            emit(ModelInstallProgressEvent {
                model_id: spec.id.to_string(),
                status: "cancelled".to_string(),
                stage: "done".to_string(),
                pct: 0.0,
                message: "Đã hủy cài đặt theo yêu cầu người dùng.".to_string(),
                downloaded_mb: None,
                total_mb: None,
                speed_mbps: None,
            });
        }
        Err(err) => {
            emit(ModelInstallProgressEvent {
                model_id: spec.id.to_string(),
                status: "error".to_string(),
                stage: "done".to_string(),
                pct: 0.0,
                message: err.message.clone(),
                downloaded_mb: None,
                total_mb: None,
                speed_mbps: None,
            });
        }
    }

    result
}

#[allow(clippy::too_many_arguments)]
fn install_model_inner<F>(
    spec: &'static ModelSpec,
    models_dir: &Path,
    app_data_dir: &Path,
    dev_sidecar_root: Option<&Path>,
    sidecar_mgr: &SidecarManager,
    cancelled: &Arc<AtomicBool>,
    current_pid: &Arc<Mutex<Option<u32>>>,
    emit: &mut F,
) -> Result<ModelStatus, AiError>
where
    F: FnMut(ModelInstallProgressEvent) + Send,
{
    std::fs::create_dir_all(models_dir)
        .map_err(|e| AiError::new("IO_ERROR", format!("Không thể tạo thư mục mô hình: {}", e)))?;

    let initial_scan = models::scan_with_runtime(models_dir, Some(app_data_dir), dev_sidecar_root);
    let initial_state = initial_scan
        .iter()
        .find(|m| m.spec.id == spec.id)
        .ok_or_else(|| AiError::new("INVALID_REQUEST", format!("Unknown model '{}'", spec.id)))?;

    if initial_state.installed {
        return Ok(initial_state.clone());
    }

    let need_runtime = !initial_state.runtime_installed;
    let need_weights = !initial_state.weights_installed;
    let hw = detect_hardware_accelerator();

    let runtime_pct_span = if need_runtime && need_weights {
        (0.0, 45.0)
    } else if need_runtime {
        (0.0, 96.0)
    } else {
        (0.0, 0.0)
    };

    let weights_pct_span = if need_runtime && need_weights {
        (45.0, 98.0)
    } else if need_weights {
        (2.0, 98.0)
    } else {
        (96.0, 98.0)
    };

    if need_runtime {
        install_engine_runtime_only(
            spec.id,
            spec.engine,
            spec.runtime,
            hw.has_nvidia_gpu,
            runtime_pct_span,
            app_data_dir,
            dev_sidecar_root,
            sidecar_mgr,
            cancelled,
            current_pid,
            emit,
        )?;
    }

    if need_weights {
        let py_exe = resolve_runtime_python(spec.runtime, app_data_dir, dev_sidecar_root)
            .or_else(|| resolve_runtime_python("core", app_data_dir, dev_sidecar_root))
            .ok_or_else(|| {
                AiError::new(
                    "PYTHON_NOT_FOUND",
                    "Chưa khởi tạo xong môi trường thực thi để tải mô hình.",
                )
            })?;

        let mut repo_id = models::decode_model_source_repo(spec.id).ok_or_else(|| {
            AiError::new("INVALID_REQUEST", "Không tìm thấy thông tin nguồn tải mô hình.")
        })?;
        let dest_dir = models_dir.join(spec.id);
        let allow_patterns = allow_patterns_for_model(spec.id);

        emit(ModelInstallProgressEvent {
            model_id: spec.id.to_string(),
            status: "installing".to_string(),
            stage: "weights".to_string(),
            pct: weights_pct_span.0,
            message: format!(
                "Đang kết nối máy chủ tải {} (~{} MB)...",
                spec.display_name, spec.approx_size_mb
            ),
            downloaded_mb: Some(0.0),
            total_mb: Some(spec.approx_size_mb as f64),
            speed_mbps: None,
        });

        let scratch_root = app_data_dir.join("scratch");
        let hf_xet_cache_dir = scratch_root.join("hf-xet-cache");
        let hf_cache_dir = scratch_root.join("hf-cache");
        let tmp_dir = scratch_root.join("tmp");
        let _ = std::fs::create_dir_all(&hf_xet_cache_dir);
        let _ = std::fs::create_dir_all(&hf_cache_dir);
        let _ = std::fs::create_dir_all(&tmp_dir);

        let mut preamble = build_hf_downloader_cfg_preamble(
            spec.id,
            &repo_id,
            &dest_dir,
            &allow_patterns,
            spec.approx_size_mb,
        );
        let py_body = crate::security::obf::decode_hf_downloader_py();
        let mut full_script = format!("{}{}", preamble, py_body.as_str_lossy());

        unsafe {
            for b in repo_id.as_bytes_mut() {
                std::ptr::write_volatile(b, 0);
            }
            for b in preamble.as_bytes_mut() {
                std::ptr::write_volatile(b, 0);
            }
        }

        let mut dl_cmd = Command::new(&py_exe);
        configure_hidden_command(&mut dl_cmd);
        dl_cmd
            .stdin(Stdio::piped())
            .args(["-u", "-"])
            .env_remove("HF_HUB_OFFLINE")
            .env_remove("TRANSFORMERS_OFFLINE")
            .env("HF_HOME", &hf_cache_dir)
            .env("HF_XET_HIGH_PERFORMANCE", "1")
            .env("HF_XET_NUM_CONCURRENT_RANGE_GETS", "32")
            .env("HF_XET_CACHE", &hf_xet_cache_dir)
            .env("TMP", &tmp_dir)
            .env("TEMP", &tmp_dir)
            .env("PYTHONUTF8", "1")
            .env("PYTHONIOENCODING", "utf-8");

        let mut dl_child = dl_cmd.spawn().map_err(|e| {
            unsafe {
                for b in full_script.as_bytes_mut() {
                    std::ptr::write_volatile(b, 0);
                }
            }
            AiError::new(
                "DOWNLOAD_SPAWN_FAILED",
                format!("Không thể khởi chạy trình tải mô hình: {}", e),
            )
        })?;

        if let Some(mut stdin_pipe) = dl_child.stdin.take() {
            let _ = stdin_pipe.write_all(full_script.as_bytes());
            let _ = stdin_pipe.flush();
        }
        unsafe {
            for b in full_script.as_bytes_mut() {
                std::ptr::write_volatile(b, 0);
            }
        }

        let model_id_str = spec.id.to_string();
        let display_name = spec.display_name.to_string();
        run_monitored_child(dl_child, cancelled, current_pid, |line| {
            if let Some(json_str) = line.strip_prefix("VOXLAB_DL_PROGRESS:") {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
                    let raw_pct = val.get("pct").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let dl_mb = val.get("downloadedMb").and_then(|v| v.as_f64());
                    let tot_mb = val.get("totalMb").and_then(|v| v.as_f64());
                    let speed = val.get("speedMbps").and_then(|v| v.as_f64());
                    let mapped_pct = weights_pct_span.0
                        + (weights_pct_span.1 - weights_pct_span.0) * (raw_pct / 100.0);

                    let msg = match (dl_mb, tot_mb, speed) {
                        (Some(d), Some(t), Some(s)) if s > 0.05 => format!(
                            "Đang tải {}: {:.0} / {:.0} MB ({:.1} MB/s)",
                            display_name, d, t, s
                        ),
                        (Some(d), Some(t), _) => {
                            format!("Đang tải {}: {:.0} / {:.0} MB", display_name, d, t)
                        }
                        _ => format!("Đang tải {}...", display_name),
                    };

                    emit(ModelInstallProgressEvent {
                        model_id: model_id_str.clone(),
                        status: "installing".to_string(),
                        stage: "weights".to_string(),
                        pct: (mapped_pct * 10.0).round() / 10.0,
                        message: msg,
                        downloaded_mb: dl_mb,
                        total_mb: tot_mb,
                        speed_mbps: speed,
                    });
                }
            }
        })?;
    }

    emit(ModelInstallProgressEvent {
        model_id: spec.id.to_string(),
        status: "installing".to_string(),
        stage: "verifying".to_string(),
        pct: 99.0,
        message: "Đang kiểm tra tính toàn vẹn của mô hình...".to_string(),
        downloaded_mb: None,
        total_mb: None,
        speed_mbps: None,
    });

    // Small settle delay for Windows NTFS file handles after parallel download workers close
    std::thread::sleep(Duration::from_millis(150));

    let final_scan = models::scan_with_runtime(models_dir, Some(app_data_dir), dev_sidecar_root);
    let final_state = final_scan
        .into_iter()
        .find(|m| m.spec.id == spec.id)
        .ok_or_else(|| AiError::new("INTERNAL", "model spec vanished after install"))?;

    if !final_state.weights_installed {
        return Err(AiError::new(
            "WEIGHTS_INCOMPLETE",
            format!(
                "Tải mô hình chưa đầy đủ, thiếu tệp: {}",
                final_state.missing_files.join(", ")
            ),
        ));
    }
    if !final_state.runtime_installed {
        return Err(AiError::new(
            "RUNTIME_INCOMPLETE",
            "Môi trường thực thi chưa sẵn sàng sau khi cài đặt.",
        ));
    }

    Ok(final_state)
}

#[allow(clippy::too_many_arguments)]
fn install_engine_runtime_only<F>(
    job_model_id: &str,
    engine: &str,
    runtime: &str,
    has_nvidia_gpu: bool,
    pct_span: (f64, f64),
    app_data_dir: &Path,
    dev_sidecar_root: Option<&Path>,
    sidecar_mgr: &SidecarManager,
    cancelled: &Arc<AtomicBool>,
    current_pid: &Arc<Mutex<Option<u32>>>,
    emit: &mut F,
) -> Result<(), AiError>
where
    F: FnMut(ModelInstallProgressEvent) + Send,
{
    let uv_bin = resolve_uv_binary(dev_sidecar_root)?;
    let runtimes_root = app_data_dir.join("runtimes");
    let uv_python_dir = runtimes_root.join("_python");
    let uv_cache_dir = app_data_dir.join("scratch").join("uv-cache");
    let wheelhouse_dir = app_data_dir.join("scratch").join("wheelhouse");
    let tmp_dir = app_data_dir.join("scratch").join("tmp");
    let target_rt_dir = runtimes_root.join(runtime);
    let site_packages_dir = if cfg!(windows) {
        target_rt_dir.join("Lib").join("site-packages")
    } else {
        target_rt_dir.join("lib").join("python3.11").join("site-packages")
    };
    std::fs::create_dir_all(&uv_python_dir)
        .map_err(|e| AiError::new("IO_ERROR", e.to_string()))?;
    std::fs::create_dir_all(&uv_cache_dir)
        .map_err(|e| AiError::new("IO_ERROR", e.to_string()))?;
    std::fs::create_dir_all(&wheelhouse_dir)
        .map_err(|e| AiError::new("IO_ERROR", e.to_string()))?;
    let _ = std::fs::create_dir_all(&tmp_dir);

    // Shut down running sidecar for this runtime before mutating its site-packages
    sidecar_mgr.shutdown(runtime);

    let rt_python = if cfg!(windows) {
        target_rt_dir.join("Scripts").join("python.exe")
    } else {
        target_rt_dir.join("bin").join("python")
    };

    if !rt_python.is_file() {
        emit(ModelInstallProgressEvent {
            model_id: job_model_id.to_string(),
            status: "installing".to_string(),
            stage: "preparing".to_string(),
            pct: pct_span.0.max(2.0),
            message: "Đang chuẩn bị không gian thực thi...".to_string(),
            downloaded_mb: None,
            total_mb: None,
            speed_mbps: None,
        });

        let mut venv_cmd = Command::new(&uv_bin);
        configure_hidden_command(&mut venv_cmd);
        venv_cmd
            .args([
                "venv",
                &target_rt_dir.to_string_lossy(),
                "--python",
                "3.11.9",
            ])
            .env("UV_PYTHON_INSTALL_DIR", &uv_python_dir)
            .env("UV_CACHE_DIR", &uv_cache_dir)
            .env("TMP", &tmp_dir)
            .env("TEMP", &tmp_dir)
            .env("UV_HTTP_TIMEOUT", "180")
            .env("UV_CONCURRENT_DOWNLOADS", "16")
            .env("UV_CONCURRENT_INSTALLS", "8")
            .env("PYTHONUTF8", "1");

        let venv_child = venv_cmd.spawn().map_err(|e| {
            AiError::new(
                "INSTALL_FAILED",
                format!("Không thể khởi tạo không gian thực thi: {}", e),
            )
        })?;
        run_monitored_child(venv_child, cancelled, current_pid, |_line| {})?;
    }

    let steps = build_uv_install_steps(engine, has_nvidia_gpu)?;
    let step_count = steps.len().max(1);
    for (idx, step) in steps.iter().enumerate() {
        let step_base =
            pct_span.0 + (pct_span.1 - pct_span.0) * (idx as f64 / step_count as f64);
        let step_ceil =
            pct_span.0 + (pct_span.1 - pct_span.0) * ((idx + 1) as f64 / step_count as f64);

        emit(ModelInstallProgressEvent {
            model_id: job_model_id.to_string(),
            status: "installing".to_string(),
            stage: "runtime".to_string(),
            pct: (step_base.max(3.0) * 10.0).round() / 10.0,
            message: step.label.clone(),
            downloaded_mb: None,
            total_mb: None,
            speed_mbps: None,
        });

        let mut did_prefetch = false;
        let prefetch_ceil = step_base + (step_ceil - step_base) * 0.78;
        if !step.no_deps {
            let model_id_str = job_model_id.to_string();
            let is_bootstrap = job_model_id == BOOTSTRAP_JOB_ID;
            let prefetch_res = crate::ai::fast_dl::prefetch_large_wheels_for_step(
                &uv_bin,
                &rt_python,
                &site_packages_dir,
                &uv_python_dir,
                &uv_cache_dir,
                &wheelhouse_dir,
                step.index_url.as_deref(),
                step.no_deps,
                &step.packages,
                cancelled,
                current_pid,
                |p| {
                    did_prefetch = true;
                    let dl_mb = p.batch_downloaded_bytes as f64 / 1_048_576.0;
                    let tot_mb = p.batch_total_bytes as f64 / 1_048_576.0;
                    let ratio = (p.batch_downloaded_bytes as f64
                        / p.batch_total_bytes.max(1) as f64)
                        .clamp(0.0, 1.0);
                    let cur_pct = step_base + (prefetch_ceil - step_base) * ratio;
                    emit(ModelInstallProgressEvent {
                        model_id: model_id_str.clone(),
                        status: "installing".to_string(),
                        stage: "runtime".to_string(),
                        pct: (cur_pct.max(3.0) * 10.0).round() / 10.0,
                        message: "Đang đồng bộ thành phần xử lý...".to_string(),
                        downloaded_mb: if is_bootstrap {
                            None
                        } else {
                            Some((dl_mb * 10.0).round() / 10.0)
                        },
                        total_mb: if is_bootstrap {
                            None
                        } else {
                            Some((tot_mb * 10.0).round() / 10.0)
                        },
                        speed_mbps: if is_bootstrap || p.speed_mbps <= 0.05 {
                            None
                        } else {
                            Some((p.speed_mbps * 100.0).round() / 100.0)
                        },
                    });
                },
            );
            if matches!(prefetch_res, Err(crate::ai::fast_dl::FastDlError::Cancelled)) {
                return Err(AiError::new("CANCELLED", "Đã hủy cài đặt mô hình."));
            }
        }

        let uv_step_base = if did_prefetch {
            prefetch_ceil
        } else {
            step_base
        };

        let mut pip_cmd = Command::new(&uv_bin);
        configure_hidden_command(&mut pip_cmd);
        pip_cmd
            .arg("pip")
            .arg("install")
            .arg("--python")
            .arg(&rt_python)
            .arg("--find-links")
            .arg(&wheelhouse_dir);
        if let Some(idx_url) = &step.index_url {
            pip_cmd.arg("--index-url").arg(idx_url);
        }
        if step.no_deps {
            pip_cmd.arg("--no-deps");
        }
        for pkg in &step.packages {
            pip_cmd.arg(pkg);
        }
        pip_cmd
            .env("UV_PYTHON_INSTALL_DIR", &uv_python_dir)
            .env("UV_CACHE_DIR", &uv_cache_dir)
            .env("TMP", &tmp_dir)
            .env("TEMP", &tmp_dir)
            .env("UV_HTTP_TIMEOUT", "300")
            .env("UV_CONCURRENT_DOWNLOADS", "16")
            .env("UV_CONCURRENT_INSTALLS", "8")
            .env("PYTHONUTF8", "1");

        let pip_child = pip_cmd.spawn().map_err(|e| {
            AiError::new(
                "INSTALL_FAILED",
                format!("Không thể đồng bộ thành phần xử lý: {}", e),
            )
        })?;

        let mut line_counter = 0usize;
        let model_id_str = job_model_id.to_string();
        let base_label = step.label.clone();
        run_monitored_child(pip_child, cancelled, current_pid, |_line| {
            line_counter += 1;
            let progress_ratio = (1.0 - (-0.06 * line_counter as f64).exp()).clamp(0.05, 0.96);
            let cur_pct = uv_step_base + (step_ceil - uv_step_base) * progress_ratio;
            emit(ModelInstallProgressEvent {
                model_id: model_id_str.clone(),
                status: "installing".to_string(),
                stage: "runtime".to_string(),
                pct: (cur_pct * 10.0).round() / 10.0,
                message: base_label.clone(),
                downloaded_mb: None,
                total_mb: None,
                speed_mbps: None,
            });
        })?;
    }

    if !models::is_engine_runtime_installed(
        engine,
        runtime,
        Some(app_data_dir),
        dev_sidecar_root,
    ) {
        return Err(AiError::new(
            "RUNTIME_VERIFY_FAILED",
            "Chưa hoàn tất đồng bộ thành phần xử lý cần thiết. Vui lòng kiểm tra kết nối mạng và thử lại.",
        ));
    }

    // Ensure sidecar reloads new site-packages on next AI request
    sidecar_mgr.shutdown(runtime);
    Ok(())
}

/// Returns `(engine, runtime)` bootstrap targets required on first launch.
pub fn required_bootstrap_targets(_has_nvidia_gpu: bool) -> Vec<(&'static str, &'static str)> {
    vec![("faster-whisper", "core")]
}

pub fn check_bootstrap_status_with_hw(
    hw: &HardwareAcceleratorInfo,
    app_data_dir: Option<&Path>,
    dev_sidecar_root: Option<&Path>,
) -> RuntimeBootstrapStatus {
    let mut missing = Vec::new();
    for (engine, runtime) in required_bootstrap_targets(hw.has_nvidia_gpu) {
        let ok =
            models::is_engine_runtime_installed(engine, runtime, app_data_dir, dev_sidecar_root);
        if !ok {
            missing.push(runtime.to_string());
        }
    }
    RuntimeBootstrapStatus {
        ready: missing.is_empty(),
        has_nvidia_gpu: hw.has_nvidia_gpu,
        gpu_name: hw.gpu_name.clone(),
        missing_runtimes: missing,
    }
}

pub fn check_bootstrap_status(
    app_data_dir: Option<&Path>,
    dev_sidecar_root: Option<&Path>,
) -> RuntimeBootstrapStatus {
    let hw = detect_hardware_accelerator();
    check_bootstrap_status_with_hw(&hw, app_data_dir, dev_sidecar_root)
}

pub fn bootstrap_runtimes_blocking<F>(
    app_data_dir: &Path,
    models_dir: &Path,
    dev_sidecar_root: Option<&Path>,
    sidecar_mgr: &SidecarManager,
    mut emit: F,
) -> Result<RuntimeBootstrapStatus, AiError>
where
    F: FnMut(ModelInstallProgressEvent) + Send,
{
    let _ = std::fs::create_dir_all(models_dir);
    let hw = detect_hardware_accelerator();
    let initial = check_bootstrap_status_with_hw(&hw, Some(app_data_dir), dev_sidecar_root);
    if initial.ready {
        return Ok(initial);
    }

    let cancelled = Arc::new(AtomicBool::new(false));
    let current_pid = Arc::new(Mutex::new(None));

    {
        let mut guard = active_install_slot()
            .lock()
            .map_err(|_| AiError::new("INTERNAL", "install lock poisoned"))?;
        if guard.is_some() {
            return Err(AiError::new(
                "INSTALL_BUSY",
                "Một tiến trình thiết lập khác đang chạy. Vui lòng đợi hoàn tất.",
            ));
        }
        *guard = Some(ActiveInstallJob {
            model_id: BOOTSTRAP_JOB_ID.to_string(),
            cancelled: cancelled.clone(),
            current_pid: current_pid.clone(),
        });
    }

    let run_res = (|| -> Result<RuntimeBootstrapStatus, AiError> {
        let targets: Vec<(&'static str, &'static str)> = required_bootstrap_targets(hw.has_nvidia_gpu)
            .into_iter()
            .filter(|(engine, runtime)| {
                !models::is_engine_runtime_installed(
                    engine,
                    runtime,
                    Some(app_data_dir),
                    dev_sidecar_root,
                )
            })
            .collect();

        let total_targets = targets.len().max(1);
        for (t_idx, (engine, runtime)) in targets.iter().enumerate() {
            let s = 2.0 + 95.0 * (t_idx as f64 / total_targets as f64);
            let e = 2.0 + 95.0 * ((t_idx + 1) as f64 / total_targets as f64);

            install_engine_runtime_only(
                BOOTSTRAP_JOB_ID,
                engine,
                runtime,
                hw.has_nvidia_gpu,
                (s, e),
                app_data_dir,
                dev_sidecar_root,
                sidecar_mgr,
                &cancelled,
                &current_pid,
                &mut emit,
            )?;
        }

        emit(ModelInstallProgressEvent {
            model_id: BOOTSTRAP_JOB_ID.to_string(),
            status: "installing".to_string(),
            stage: "verifying".to_string(),
            pct: 98.0,
            message: "Đang hoàn tất khởi tạo...".to_string(),
            downloaded_mb: None,
            total_mb: None,
            speed_mbps: None,
        });

        let final_status = check_bootstrap_status_with_hw(&hw, Some(app_data_dir), dev_sidecar_root);
        if !final_status.ready {
            return Err(AiError::new(
                "RUNTIME_INCOMPLETE",
                "Chưa hoàn tất khởi tạo môi trường. Vui lòng thử lại.",
            ));
        }
        Ok(final_status)
    })();

    if let Ok(mut guard) = active_install_slot().lock() {
        *guard = None;
    }

    match &run_res {
        Ok(_) => {
            emit(ModelInstallProgressEvent {
                model_id: BOOTSTRAP_JOB_ID.to_string(),
                status: "completed".to_string(),
                stage: "done".to_string(),
                pct: 100.0,
                message: "Đã khởi tạo môi trường hoàn tất!".to_string(),
                downloaded_mb: None,
                total_mb: None,
                speed_mbps: None,
            });
        }
        Err(err) if err.code == "CANCELLED" => {
            emit(ModelInstallProgressEvent {
                model_id: BOOTSTRAP_JOB_ID.to_string(),
                status: "cancelled".to_string(),
                stage: "done".to_string(),
                pct: 0.0,
                message: "Đã tạm dừng khởi tạo môi trường.".to_string(),
                downloaded_mb: None,
                total_mb: None,
                speed_mbps: None,
            });
        }
        Err(err) => {
            emit(ModelInstallProgressEvent {
                model_id: BOOTSTRAP_JOB_ID.to_string(),
                status: "error".to_string(),
                stage: "done".to_string(),
                pct: 0.0,
                message: err.message.clone(),
                downloaded_mb: None,
                total_mb: None,
                speed_mbps: None,
            });
        }
    }

    run_res
}

pub fn find_model_spec(model_id: &str) -> Result<&'static ModelSpec, AiError> {
    MODELS
        .iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| AiError::new("INVALID_REQUEST", format!("Mô hình không tồn tại: '{}'", model_id)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whisper_gpu_vs_cpu_manifest_selects_cuda_libs_only_on_nvidia() {
        let gpu_steps = build_uv_install_steps("faster-whisper", true).unwrap();
        assert_eq!(gpu_steps.len(), 1);
        assert!(gpu_steps[0].packages.iter().any(|p| p == "nvidia-cublas-cu12"));
        assert!(gpu_steps[0].packages.iter().any(|p| p == "nvidia-cudnn-cu12"));

        let cpu_steps = build_uv_install_steps("faster-whisper", false).unwrap();
        assert_eq!(cpu_steps.len(), 1);
        assert!(!cpu_steps[0].packages.iter().any(|p| p.starts_with("nvidia-")));
        assert!(cpu_steps[0].packages.iter().any(|p| p == "faster-whisper==1.2.1"));
    }

    #[test]
    fn chatterbox_manifest_preserves_torch_2_8_and_skips_gradio() {
        let steps = build_uv_install_steps("chatterbox", true).unwrap();
        assert_eq!(steps.len(), 3);
        assert_eq!(
            steps[0].index_url.as_deref(),
            Some("https://download.pytorch.org/whl/cu128")
        );
        assert!(steps[0].packages.contains(&"torch==2.8.0".to_string()));
        assert!(steps[1].packages.contains(&"numpy==1.26.4".to_string()));
        assert!(!steps.iter().any(|s| s.packages.iter().any(|p| p.contains("gradio"))));
        assert!(steps[2].no_deps);
        assert_eq!(steps[2].packages, vec!["chatterbox-tts==0.1.7".to_string()]);
    }

    #[test]
    fn omnivoice_and_qwen_manifests_use_no_deps_leaf_and_cpu_fallback() {
        let omni_cpu = build_uv_install_steps("omnivoice", false).unwrap();
        assert_eq!(
            omni_cpu[0].index_url.as_deref(),
            Some("https://download.pytorch.org/whl/cpu")
        );
        assert!(omni_cpu[1].packages.contains(&"tensorboardX>=2.6.0".to_string()));
        assert!(omni_cpu[2].no_deps);
        assert_eq!(omni_cpu[2].packages, vec!["omnivoice==0.2.1".to_string()]);

        let qwen_gpu = build_uv_install_steps("qwen", true).unwrap();
        assert!(qwen_gpu[1].packages.contains(&"transformers==4.57.3".to_string()));
        assert!(qwen_gpu[2].no_deps);
        assert_eq!(qwen_gpu[2].packages, vec!["qwen-tts==0.1.1".to_string()]);
    }

    #[test]
    fn scan_with_runtime_distinguishes_weights_only_from_full_install() {
        let tmp = std::env::temp_dir().join(format!("voxlab-rt-scan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let models_dir = tmp.join("models");
        let app_data = tmp.join("appdata");

        let small_dir = models_dir.join("faster-whisper-small");
        std::fs::create_dir_all(&small_dir).unwrap();
        for f in ["model.bin", "config.json", "tokenizer.json", "vocabulary.txt"] {
            std::fs::write(small_dir.join(f), b"stub").unwrap();
        }

        // Before runtime site-packages exists: weights_installed = true, runtime_installed = false -> installed = false
        let scan1 = models::scan_with_runtime(&models_dir, Some(&app_data), None);
        let s1 = scan1.iter().find(|m| m.spec.id == "faster-whisper-small").unwrap();
        assert!(s1.weights_installed);
        assert!(!s1.runtime_installed);
        assert!(!s1.installed);
        assert!(!s1.requires_cuda);

        // Create marker package in <appData>/runtimes/core/Lib/site-packages/faster_whisper
        let fw_pkg = app_data
            .join("runtimes")
            .join("core")
            .join("Lib")
            .join("site-packages")
            .join("faster_whisper");
        std::fs::create_dir_all(&fw_pkg).unwrap();

        let scan2 = models::scan_with_runtime(&models_dir, Some(&app_data), None);
        let s2 = scan2.iter().find(|m| m.spec.id == "faster-whisper-small").unwrap();
        assert!(s2.weights_installed);
        assert!(s2.runtime_installed);
        assert!(s2.installed);

        let omni = scan2.iter().find(|m| m.spec.id == "omnivoice").unwrap();
        assert!(!omni.runtime_installed, "omnivoice marker must remain independent of faster_whisper");
        assert!(omni.requires_cuda);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn bootstrap_status_tracks_gpu_and_cpu_runtime_readiness() {
        let tmp = std::env::temp_dir().join(format!("voxlab-bootstrap-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);

        let gpu_hw = HardwareAcceleratorInfo {
            has_nvidia_gpu: true,
            gpu_name: Some("NVIDIA GeForce RTX".to_string()),
            mode: "cuda".to_string(),
        };
        let cpu_hw = HardwareAcceleratorInfo {
            has_nvidia_gpu: false,
            gpu_name: None,
            mode: "cpu".to_string(),
        };

        // Fresh customer PC: both GPU and CPU require only lean `core` (`faster_whisper`) on first launch
        let st_gpu_0 = check_bootstrap_status_with_hw(&gpu_hw, Some(&tmp), None);
        assert!(!st_gpu_0.ready);
        assert_eq!(st_gpu_0.missing_runtimes, vec!["core"]);

        let st_cpu_0 = check_bootstrap_status_with_hw(&cpu_hw, Some(&tmp), None);
        assert!(!st_cpu_0.ready);
        assert_eq!(st_cpu_0.missing_runtimes, vec!["core"]);

        // Installing `faster_whisper` into `core` makes BOTH CPU and GPU PCs ready immediately
        // (heavy PyTorch Clone TTS runtimes install on-demand when the user selects a model in Settings)
        std::fs::create_dir_all(tmp.join("runtimes/core/Lib/site-packages/faster_whisper")).unwrap();
        let st_cpu_1 = check_bootstrap_status_with_hw(&cpu_hw, Some(&tmp), None);
        assert!(st_cpu_1.ready);
        assert!(st_cpu_1.missing_runtimes.is_empty());

        let st_gpu_1 = check_bootstrap_status_with_hw(&gpu_hw, Some(&tmp), None);
        assert!(st_gpu_1.ready);
        assert!(st_gpu_1.missing_runtimes.is_empty());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn hf_downloader_preamble_handles_null_allow_patterns_and_windows_paths() {
        let base_models_dir = Path::new(r"F:\Model AI Local\Thư mục 'đặc biệt'");
        let dev_py = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../sidecar/.venv/Scripts/python.exe");

        for spec in MODELS {
            let repo_id = models::decode_model_source_repo(spec.id)
                .expect("every registered model must have an obfuscated HF repo");
            let dest_dir = base_models_dir.join(spec.id);
            let allow = allow_patterns_for_model(spec.id);
            let preamble = build_hf_downloader_cfg_preamble(
                spec.id,
                &repo_id,
                &dest_dir,
                &allow,
                spec.approx_size_mb,
            );
            assert!(
                !preamble.contains("null"),
                "preamble must never emit raw JSON null into Python source"
            );

            if dev_py.is_file() {
                let verify_script = format!(
                    "{}\nassert _VOXLAB_CFG['model_id'] == {:?}\nassert _VOXLAB_CFG['dest_dir'] == {:?}\nassert (_VOXLAB_CFG['allow_patterns'] is None) == {}\n",
                    preamble,
                    spec.id,
                    dest_dir.to_string_lossy(),
                    if allow.is_none() { "True" } else { "False" }
                );
                let out = Command::new(&dev_py)
                    .args(["-c", &verify_script])
                    .output()
                    .expect("spawn python for preamble verification");
                assert!(
                    out.status.success(),
                    "Python failed to parse downloader preamble for {}: {}",
                    spec.id,
                    String::from_utf8_lossy(&out.stderr)
                );
            }
        }
    }
}
