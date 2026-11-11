//! Self-contained AI runtime & model weights installer for commercial Windows builds.
//!
//! Enables clean Windows PCs (with zero Python, pip, Git, or CUDA Toolkit pre-installed)
//! to install GPU-accelerated (CUDA 12.8) or CPU AI runtimes into `<appData>/runtimes/<rt>`
//! via bundled `uv.exe` and download HuggingFace model weights into `<modelsDir>/<modelId>`
//! with real-time progress and instant cancellation.

use crate::ai::models::{self, ModelSpec, ModelStatus, MODELS};
use crate::ai::sidecar::{AiError, SidecarManager};
use serde::Serialize;
use std::io::{BufRead, BufReader};
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

pub fn build_uv_install_steps(engine: &str, has_nvidia_gpu: bool) -> Result<Vec<UvInstallStep>, AiError> {
    let torch_index = if has_nvidia_gpu {
        "https://download.pytorch.org/whl/cu128"
    } else {
        "https://download.pytorch.org/whl/cpu"
    };
    let torch_label = if has_nvidia_gpu {
        "Đang tải nhân PyTorch 2.8 GPU (NVIDIA CUDA 12.8)..."
    } else {
        "Đang tải nhân PyTorch 2.8 (CPU)..."
    };

    match engine {
        "faster-whisper" => {
            let mut pkgs = vec![
                "faster-whisper==1.2.1".to_string(),
                "ctranslate2==4.8.2".to_string(),
                "av>=14.0".to_string(),
                "scipy>=1.13.0".to_string(),
                "librosa>=0.11.0".to_string(),
                "soundfile>=0.13.0".to_string(),
                "numpy>=2.0.0,<2.5.0".to_string(),
                "huggingface_hub>=0.30.0".to_string(),
                "hf-xet>=1.0.0".to_string(),
                "tqdm>=4.66.0".to_string(),
                "certifi".to_string(),
            ];
            let label = if has_nvidia_gpu {
                pkgs.push("nvidia-cublas-cu12".to_string());
                pkgs.push("nvidia-cudnn-cu12".to_string());
                "Đang cài đặt thư viện nhận diện giọng nói Whisper (GPU CUDA)..."
            } else {
                "Đang cài đặt thư viện nhận diện giọng nói Whisper (CPU)..."
            };
            Ok(vec![UvInstallStep {
                label: label.to_string(),
                index_url: None,
                no_deps: false,
                packages: pkgs,
            }])
        }
        "omnivoice" => Ok(vec![
            UvInstallStep {
                label: torch_label.to_string(),
                index_url: Some(torch_index.to_string()),
                no_deps: false,
                packages: vec!["torch==2.8.0".into(), "torchaudio==2.8.0".into()],
            },
            UvInstallStep {
                label: "Đang cài đặt thư viện xử lý âm thanh & ngôn ngữ OmniVoice...".to_string(),
                index_url: None,
                no_deps: false,
                packages: vec![
                    "numpy>=2.0.0,<2.5.0".into(),
                    "soundfile>=0.13.0".into(),
                    "scipy>=1.13.0".into(),
                    "librosa>=0.11.0".into(),
                    "accelerate>=1.12.0".into(),
                    "transformers>=5.3.0,<6.0.0".into(),
                    "safetensors>=0.7.0".into(),
                    "tokenizers>=0.22.0".into(),
                    "pydub>=0.25.1".into(),
                    "webdataset>=1.0.0".into(),
                    "tensorboardX>=2.6.0".into(),
                    "av>=14.0".into(),
                    "faster-whisper==1.2.1".into(),
                    "ctranslate2==4.8.2".into(),
                    "huggingface_hub>=0.30.0".into(),
                    "hf-xet>=1.0.0".into(),
                    "tqdm>=4.66.0".into(),
                    "certifi".into(),
                ],
            },
            UvInstallStep {
                label: "Đang kích hoạt engine OmniVoice...".to_string(),
                index_url: None,
                no_deps: true,
                packages: vec!["omnivoice==0.2.1".into()],
            },
        ]),
        "chatterbox" => Ok(vec![
            UvInstallStep {
                label: torch_label.to_string(),
                index_url: Some(torch_index.to_string()),
                no_deps: false,
                packages: vec!["torch==2.8.0".into(), "torchaudio==2.8.0".into()],
            },
            UvInstallStep {
                label: "Đang cài đặt thư viện tổng hợp giọng nói Chatterbox Turbo...".to_string(),
                index_url: None,
                no_deps: false,
                packages: vec![
                    "numpy==1.26.4".into(),
                    "soundfile>=0.13.0".into(),
                    "scipy>=1.13.0".into(),
                    "librosa==0.11.0".into(),
                    "transformers==5.2.0".into(),
                    "diffusers==0.29.0".into(),
                    "safetensors>=0.5.3".into(),
                    "tokenizers>=0.22.0".into(),
                    "s3tokenizer".into(),
                    "resemble-perth>=1.0.0".into(),
                    "conformer==0.3.2".into(),
                    "spacy-pkuseg".into(),
                    "pykakasi==2.3.0".into(),
                    "pyloudnorm".into(),
                    "omegaconf>=2.3.0".into(),
                    "einops>=0.8.0".into(),
                    "huggingface_hub>=0.30.0".into(),
                    "hf-xet>=1.0.0".into(),
                    "tqdm>=4.66.0".into(),
                    "certifi".into(),
                ],
            },
            UvInstallStep {
                label: "Đang kích hoạt engine Chatterbox Turbo...".to_string(),
                index_url: None,
                no_deps: true,
                packages: vec!["chatterbox-tts==0.1.7".into()],
            },
        ]),
        "qwen" => Ok(vec![
            UvInstallStep {
                label: torch_label.to_string(),
                index_url: Some(torch_index.to_string()),
                no_deps: false,
                packages: vec!["torch==2.8.0".into(), "torchaudio==2.8.0".into()],
            },
            UvInstallStep {
                label: "Đang cài đặt thư viện tổng hợp giọng nói Qwen3-TTS...".to_string(),
                index_url: None,
                no_deps: false,
                packages: vec![
                    "numpy>=2.0.0,<2.5.0".into(),
                    "soundfile>=0.13.0".into(),
                    "onnxruntime>=1.20.0".into(),
                    "transformers==4.57.3".into(),
                    "accelerate==1.12.0".into(),
                    "librosa>=0.11.0".into(),
                    "scipy>=1.13.0".into(),
                    "sox>=1.5.0".into(),
                    "einops>=0.8.0".into(),
                    "safetensors>=0.7.0".into(),
                    "huggingface_hub>=0.30.0".into(),
                    "hf-xet>=1.0.0".into(),
                    "tqdm>=4.66.0".into(),
                    "certifi".into(),
                ],
            },
            UvInstallStep {
                label: "Đang kích hoạt engine Qwen3-TTS...".to_string(),
                index_url: None,
                no_deps: true,
                packages: vec!["qwen-tts==0.1.1".into()],
            },
        ]),
        other => Err(AiError::new(
            "INVALID_REQUEST",
            format!("Engine không được hỗ trợ cài đặt tự động: {}", other),
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
        "Không tìm thấy trình cài đặt môi trường AI nội bộ (uv.exe). Vui lòng cài lại bộ cài VoxLab.",
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

const HF_DOWNLOADER_SCRIPT: &str = r#"
import fnmatch
import json
import os
import shutil
import sys
import threading
import time

os.environ.pop("HF_HUB_OFFLINE", None)
os.environ.pop("TRANSFORMERS_OFFLINE", None)
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

model_id = sys.argv[1]
repo_id = sys.argv[2]
dest_dir = sys.argv[3]
allow_json = sys.argv[4]
fallback_total_mb = float(sys.argv[5])
allow_patterns = json.loads(allow_json) if allow_json != "null" else None

os.makedirs(dest_dir, exist_ok=True)

from huggingface_hub import HfApi, snapshot_download

expected_bytes = 0
try:
    info = HfApi().repo_info(repo_id=repo_id, repo_type="model", files_metadata=True)
    for sib in (info.siblings or []):
        rname = getattr(sib, "rfilename", "") or ""
        if not rname or rname.startswith(".git"):
            continue
        if allow_patterns is not None:
            if not any(fnmatch.fnmatch(rname, pat) for pat in allow_patterns):
                continue
        sz = getattr(sib, "size", None)
        if isinstance(sz, int) and sz > 0:
            expected_bytes += sz
except Exception:
    expected_bytes = 0

if expected_bytes <= 0:
    expected_bytes = int(max(1.0, fallback_total_mb) * 1048576)

def measure_dest_bytes(root: str) -> int:
    total = 0
    for r, _dirs, files in os.walk(root):
        in_cache = ".cache" in r
        for f in files:
            if in_cache and not f.endswith(".incomplete"):
                continue
            fp = os.path.join(r, f)
            try:
                total += os.path.getsize(fp)
            except OSError:
                pass
    return total

stop_evt = threading.Event()
start_ts = time.monotonic()
initial_bytes = measure_dest_bytes(dest_dir)

def monitor_loop() -> None:
    last_bytes = initial_bytes
    last_ts = start_ts
    smoothed_speed = 0.0
    while not stop_evt.wait(0.45):
        cur_bytes = measure_dest_bytes(dest_dir)
        now = time.monotonic()
        dt = max(0.05, now - last_ts)
        delta_mb = max(0.0, (cur_bytes - last_bytes) / 1048576.0)
        inst_speed = delta_mb / dt
        smoothed_speed = inst_speed if smoothed_speed <= 0.01 else (0.65 * smoothed_speed + 0.35 * inst_speed)
        last_bytes = cur_bytes
        last_ts = now
        dl_mb = cur_bytes / 1048576.0
        tot_mb = expected_bytes / 1048576.0
        pct = min(99.0, max(0.0, (cur_bytes / float(expected_bytes)) * 100.0))
        payload = {
            "downloadedMb": round(dl_mb, 1),
            "totalMb": round(tot_mb, 1),
            "pct": round(pct, 1),
            "speedMbps": round(max(0.0, smoothed_speed), 2),
        }
        print("VOXLAB_DL_PROGRESS:" + json.dumps(payload), flush=True)

mon = threading.Thread(target=monitor_loop, daemon=True)
mon.start()
try:
    snapshot_download(
        repo_id=repo_id,
        local_dir=dest_dir,
        allow_patterns=allow_patterns,
        max_workers=4,
    )
finally:
    stop_evt.set()
    mon.join(timeout=1.0)

vocab_json = os.path.join(dest_dir, "vocabulary.json")
vocab_txt = os.path.join(dest_dir, "vocabulary.txt")
if os.path.isfile(vocab_json) and not os.path.isfile(vocab_txt):
    try:
        with open(vocab_json, "r", encoding="utf-8") as vf:
            tokens = json.load(vf)
        if isinstance(tokens, list):
            with open(vocab_txt, "w", encoding="utf-8") as tf:
                for tok in tokens:
                    tf.write(f"{tok}\n")
    except Exception:
        pass

shutil.rmtree(os.path.join(dest_dir, ".cache"), ignore_errors=True)
final_mb = round(measure_dest_bytes(dest_dir) / 1048576.0, 1)
print("VOXLAB_DL_PROGRESS:" + json.dumps({
    "downloadedMb": final_mb,
    "totalMb": final_mb,
    "pct": 100.0,
    "speedMbps": 0.0,
}), flush=True)
"#;

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
                    "Không tìm thấy Python runtime để tải trọng số mô hình.",
                )
            })?;

        let dest_dir = models_dir.join(spec.id);
        let allow_json = match allow_patterns_for_model(spec.id) {
            Some(pats) => serde_json::to_string(&pats).unwrap_or_else(|_| "null".into()),
            None => "null".to_string(),
        };

        emit(ModelInstallProgressEvent {
            model_id: spec.id.to_string(),
            status: "installing".to_string(),
            stage: "weights".to_string(),
            pct: weights_pct_span.0,
            message: format!(
                "Đang kết nối HuggingFace để tải {} (~{} MB)...",
                spec.display_name, spec.approx_size_mb
            ),
            downloaded_mb: Some(0.0),
            total_mb: Some(spec.approx_size_mb as f64),
            speed_mbps: None,
        });

        let mut dl_cmd = Command::new(&py_exe);
        configure_hidden_command(&mut dl_cmd);
        dl_cmd
            .args([
                "-u",
                "-c",
                HF_DOWNLOADER_SCRIPT,
                spec.id,
                spec.source_repo,
                &dest_dir.to_string_lossy(),
                &allow_json,
                &spec.approx_size_mb.to_string(),
            ])
            .env_remove("HF_HUB_OFFLINE")
            .env_remove("TRANSFORMERS_OFFLINE")
            .env("PYTHONUTF8", "1")
            .env("PYTHONIOENCODING", "utf-8");

        let dl_child = dl_cmd.spawn().map_err(|e| {
            AiError::new(
                "DOWNLOAD_SPAWN_FAILED",
                format!("Không thể khởi chạy trình tải mô hình: {}", e),
            )
        })?;

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
            "Môi trường Python AI chưa sẵn sàng sau khi cài đặt.",
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
    let target_rt_dir = runtimes_root.join(runtime);
    std::fs::create_dir_all(&uv_python_dir)
        .map_err(|e| AiError::new("IO_ERROR", e.to_string()))?;
    std::fs::create_dir_all(&uv_cache_dir)
        .map_err(|e| AiError::new("IO_ERROR", e.to_string()))?;

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
            message: format!(
                "Đang khởi tạo môi trường Python 3.11 độc lập ({})...",
                runtime
            ),
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
            .env("UV_HTTP_TIMEOUT", "180")
            .env("PYTHONUTF8", "1");

        let venv_child = venv_cmd.spawn().map_err(|e| {
            AiError::new(
                "INSTALL_FAILED",
                format!("Không thể khởi chạy uv venv: {}", e),
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

        let mut pip_cmd = Command::new(&uv_bin);
        configure_hidden_command(&mut pip_cmd);
        pip_cmd
            .arg("pip")
            .arg("install")
            .arg("--python")
            .arg(&rt_python);
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
            .env("UV_HTTP_TIMEOUT", "300")
            .env("PYTHONUTF8", "1");

        let pip_child = pip_cmd.spawn().map_err(|e| {
            AiError::new(
                "INSTALL_FAILED",
                format!("Không thể khởi chạy uv pip install: {}", e),
            )
        })?;

        let mut line_counter = 0usize;
        let model_id_str = job_model_id.to_string();
        let base_label = step.label.clone();
        run_monitored_child(pip_child, cancelled, current_pid, |line| {
            line_counter += 1;
            let progress_ratio = (1.0 - (-0.06 * line_counter as f64).exp()).clamp(0.05, 0.94);
            let cur_pct = step_base + (step_ceil - step_base) * progress_ratio;
            let detail = if line.starts_with("Prepared ")
                || line.starts_with("Installed ")
                || line.starts_with("Audited ")
                || line.starts_with("Resolved ")
                || line.starts_with("Downloading ")
            {
                format!("{} ({})", base_label, line)
            } else {
                base_label.clone()
            };
            emit(ModelInstallProgressEvent {
                model_id: model_id_str.clone(),
                status: "installing".to_string(),
                stage: "runtime".to_string(),
                pct: (cur_pct * 10.0).round() / 10.0,
                message: detail,
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
            format!(
                "Đã chạy trình cài đặt nhưng không tìm thấy gói '{}' trong runtime '{}'.",
                models::engine_marker_package(engine),
                runtime
            ),
        ));
    }

    // Ensure sidecar reloads new site-packages on next AI request
    sidecar_mgr.shutdown(runtime);
    Ok(())
}

/// Returns `(engine, runtime)` bootstrap targets required on first launch so all hardware-supported
/// AI engines have their Python/CUDA/CPU libraries configured before the user enters the studio.
pub fn required_bootstrap_targets(has_nvidia_gpu: bool) -> Vec<(&'static str, &'static str)> {
    if has_nvidia_gpu {
        // Note: "omnivoice" in "core" installs BOTH `faster-whisper` + `ctranslate2` AND
        // `torch==2.8.0+cu128` + `omnivoice`, covering all 4 Whisper ASR models + OmniVoice.
        vec![
            ("omnivoice", "core"),
            ("chatterbox", "chatterbox"),
            ("qwen", "qwen"),
        ]
    } else {
        vec![("faster-whisper", "core")]
    }
}

pub fn check_bootstrap_status_with_hw(
    hw: &HardwareAcceleratorInfo,
    app_data_dir: Option<&Path>,
    dev_sidecar_root: Option<&Path>,
) -> RuntimeBootstrapStatus {
    let mut missing = Vec::new();
    for (engine, runtime) in required_bootstrap_targets(hw.has_nvidia_gpu) {
        let mut ok =
            models::is_engine_runtime_installed(engine, runtime, app_data_dir, dev_sidecar_root);
        if ok && engine == "omnivoice" && runtime == "core" {
            // Also guarantee faster-whisper is present inside `core`
            ok = models::is_engine_runtime_installed(
                "faster-whisper",
                "core",
                app_data_dir,
                dev_sidecar_root,
            );
        }
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
        if let Some(existing) = guard.as_ref() {
            return Err(AiError::new(
                "INSTALL_BUSY",
                format!(
                    "Tiến trình cài đặt '{}' đang chạy. Vui lòng đợi hoàn tất.",
                    existing.model_id
                ),
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
                let mut ok = models::is_engine_runtime_installed(
                    engine,
                    runtime,
                    Some(app_data_dir),
                    dev_sidecar_root,
                );
                if ok && *engine == "omnivoice" && *runtime == "core" {
                    ok = models::is_engine_runtime_installed(
                        "faster-whisper",
                        "core",
                        Some(app_data_dir),
                        dev_sidecar_root,
                    );
                }
                !ok
            })
            .collect();

        let total_targets = targets.len().max(1);
        for (t_idx, (engine, runtime)) in targets.iter().enumerate() {
            // Core downloads PyTorch (~60% of total time on fresh GPU install); subsequent runtimes hardlink from uv-cache quickly
            let (span_start, span_end) = if total_targets == 3 {
                match t_idx {
                    0 => (2.0, 62.0),
                    1 => (62.0, 80.0),
                    _ => (80.0, 96.0),
                }
            } else {
                let s = 2.0 + 94.0 * (t_idx as f64 / total_targets as f64);
                let e = 2.0 + 94.0 * ((t_idx + 1) as f64 / total_targets as f64);
                (s, e)
            };

            install_engine_runtime_only(
                BOOTSTRAP_JOB_ID,
                engine,
                runtime,
                hw.has_nvidia_gpu,
                (span_start, span_end),
                app_data_dir,
                dev_sidecar_root,
                sidecar_mgr,
                &cancelled,
                &current_pid,
                &mut emit,
            )?;
        }

        // Prune compressed wheel archives from uv-cache to reclaim disk space while preserving NTFS hardlinks
        if let Ok(uv_bin) = resolve_uv_binary(dev_sidecar_root) {
            let uv_cache_dir = app_data_dir.join("scratch").join("uv-cache");
            if uv_cache_dir.is_dir() {
                emit(ModelInstallProgressEvent {
                    model_id: BOOTSTRAP_JOB_ID.to_string(),
                    status: "installing".to_string(),
                    stage: "verifying".to_string(),
                    pct: 98.0,
                    message: "Đang tối ưu bộ nhớ đệm và hoàn tất cấu hình...".to_string(),
                    downloaded_mb: None,
                    total_mb: None,
                    speed_mbps: None,
                });
                let mut prune_cmd = Command::new(uv_bin);
                configure_hidden_command(&mut prune_cmd);
                let _ = prune_cmd
                    .args(["cache", "prune", "--ci"])
                    .env("UV_CACHE_DIR", &uv_cache_dir)
                    .status();
            }
        }

        let final_status = check_bootstrap_status_with_hw(&hw, Some(app_data_dir), dev_sidecar_root);
        if !final_status.ready {
            return Err(AiError::new(
                "RUNTIME_INCOMPLETE",
                format!(
                    "Chưa hoàn tất cấu hình các thư viện: {}",
                    final_status.missing_runtimes.join(", ")
                ),
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
                message: "Đã cấu hình hoàn tất toàn bộ thư viện AI!".to_string(),
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
                message: "Đã tạm dừng thiết lập thư viện AI.".to_string(),
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

        // Fresh customer PC: not ready
        let st_gpu_0 = check_bootstrap_status_with_hw(&gpu_hw, Some(&tmp), None);
        assert!(!st_gpu_0.ready);
        assert_eq!(st_gpu_0.missing_runtimes, vec!["core", "chatterbox", "qwen"]);

        let st_cpu_0 = check_bootstrap_status_with_hw(&cpu_hw, Some(&tmp), None);
        assert!(!st_cpu_0.ready);
        assert_eq!(st_cpu_0.missing_runtimes, vec!["core"]);

        // Install only faster_whisper -> CPU PC becomes ready, GPU PC still needs omnivoice + chatterbox + qwen
        std::fs::create_dir_all(tmp.join("runtimes/core/Lib/site-packages/faster_whisper")).unwrap();
        let st_cpu_1 = check_bootstrap_status_with_hw(&cpu_hw, Some(&tmp), None);
        assert!(st_cpu_1.ready);
        assert!(st_cpu_1.missing_runtimes.is_empty());

        let st_gpu_1 = check_bootstrap_status_with_hw(&gpu_hw, Some(&tmp), None);
        assert!(!st_gpu_1.ready);
        assert_eq!(st_gpu_1.missing_runtimes, vec!["core", "chatterbox", "qwen"]);

        // Install omnivoice, chatterbox, qwen markers -> GPU PC becomes 100% ready
        std::fs::create_dir_all(tmp.join("runtimes/core/Lib/site-packages/omnivoice")).unwrap();
        std::fs::create_dir_all(tmp.join("runtimes/chatterbox/Lib/site-packages/chatterbox")).unwrap();
        std::fs::create_dir_all(tmp.join("runtimes/qwen/Lib/site-packages/qwen_tts")).unwrap();

        let st_gpu_2 = check_bootstrap_status_with_hw(&gpu_hw, Some(&tmp), None);
        assert!(st_gpu_2.ready);
        assert!(st_gpu_2.missing_runtimes.is_empty());

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
