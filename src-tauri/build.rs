use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

fn parse_env_file(path: &Path, out: &mut HashMap<String, String>) {
    println!("cargo:rerun-if-changed={}", path.display());
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return,
    };

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            let key = k.trim();
            let val = v.trim().trim_matches('"').trim_matches('\'');
            if !key.is_empty() && !val.is_empty() {
                out.entry(key.to_string()).or_insert_with(|| val.to_string());
            }
        }
    }
}

fn resolve_config_value(key: &str, file_map: &HashMap<String, String>) -> String {
    println!("cargo:rerun-if-env-changed={}", key);
    if let Ok(v) = std::env::var(key) {
        let trimmed = v.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    file_map.get(key).cloned().unwrap_or_default()
}

fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

fn encrypt_polymorphic(plain: &[u8], seed: u64) -> Vec<u8> {
    let mut state = seed;
    let mut ks_word = 0u64;
    let mut out = Vec::with_capacity(plain.len());
    for (idx, &b) in plain.iter().enumerate() {
        if idx & 7 == 0 {
            ks_word = splitmix64(&mut state);
        }
        let ks_byte = ((ks_word >> ((idx & 7) * 8)) & 0xFF) as u8;
        let mixed = b.wrapping_add(idx as u8).rotate_left(3) ^ ks_byte;
        out.push(mixed);
    }
    out
}

fn emit_obfuscated_constant(
    buf: &mut String,
    name: &str,
    plain: &[u8],
    master_entropy: &mut u64,
) {
    let seed = splitmix64(master_entropy) ^ 0xA5A5_5A5A_F0F0_0F0F;
    let key_a = splitmix64(master_entropy);
    let key_b = seed ^ key_a;
    let cipher = encrypt_polymorphic(plain, seed);

    buf.push_str(&format!(
        "pub(crate) const {name}_KEY_A: u64 = 0x{key_a:016X};\n\
         pub(crate) const {name}_KEY_B: u64 = 0x{key_b:016X};\n\
         pub(crate) static {name}_DATA: [u8; {len}] = [",
        name = name,
        key_a = key_a,
        key_b = key_b,
        len = cipher.len()
    ));
    for (i, byte) in cipher.iter().enumerate() {
        if i > 0 {
            buf.push_str(", ");
        }
        buf.push_str(&format!("0x{:02X}", byte));
    }
    buf.push_str("];\n\n");
}

fn generate_obfuscated_constants() {
    let mut file_env = HashMap::new();
    // .env.local takes precedence over .env
    parse_env_file(Path::new("../.env.local"), &mut file_env);
    parse_env_file(Path::new("../.env"), &mut file_env);

    let supabase_url = resolve_config_value("VOXLAB_SUPABASE_URL", &file_env);
    let supabase_anon_key = resolve_config_value("VOXLAB_SUPABASE_ANON_KEY", &file_env);
    let enforce_flag = resolve_config_value("VOXLAB_ENFORCE_LICENSE", &file_env);
    let ipc_pepper = resolve_config_value("VOXLAB_IPC_PEPPER", &file_env);

    // Only pass non-secret debug toggle via rustc-env (used solely in debug builds)
    if !enforce_flag.is_empty() {
        println!("cargo:rustc-env=VOXLAB_ENFORCE_LICENSE={}", enforce_flag);
    }

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x6A09_E667_F3BC_C908);
    let pid = std::process::id() as u64;
    let mut entropy = nanos
        ^ pid.rotate_left(19)
        ^ (supabase_url.len() as u64).wrapping_mul(0x517C_C1B7_2722_0A95)
        ^ (supabase_anon_key.len() as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    let _ = splitmix64(&mut entropy);

    let ipc_seed = if ipc_pepper.is_empty() {
        "VoxLab::SidecarIPC::MutualHMAC::v3.1::7a3e91c5d2084f1b".to_string()
    } else {
        format!(
            "VoxLab::SidecarIPC::MutualHMAC::v3.1::7a3e91c5d2084f1b::{}",
            ipc_pepper
        )
    };

    let mut generated = String::from("// Auto-generated polymorphic obfuscated constants. DO NOT EDIT.\n\n");

    emit_obfuscated_constant(
        &mut generated,
        "OBF_SUPABASE_URL",
        supabase_url.as_bytes(),
        &mut entropy,
    );
    emit_obfuscated_constant(
        &mut generated,
        "OBF_SUPABASE_ANON_KEY",
        supabase_anon_key.as_bytes(),
        &mut entropy,
    );
    emit_obfuscated_constant(
        &mut generated,
        "OBF_RPC_ACTIVATE_PATH",
        b"/rest/v1/rpc/activate_or_verify_voxlab_license_v3",
        &mut entropy,
    );
    emit_obfuscated_constant(
        &mut generated,
        "OBF_LEGACY_DPAPI_ENTROPY",
        b"VoxLab-License-v3",
        &mut entropy,
    );
    emit_obfuscated_constant(
        &mut generated,
        "OBF_VAULT_DOMAIN_SEED",
        b"VoxLab::DPAPI::HardwareVault::v3.1::9f4c2e81b7a04d63",
        &mut entropy,
    );
    emit_obfuscated_constant(
        &mut generated,
        "OBF_IPC_AUTH_SEED",
        ipc_seed.as_bytes(),
        &mut entropy,
    );
    emit_obfuscated_constant(
        &mut generated,
        "OBF_REG_CRYPTO_SUBKEY",
        b"SOFTWARE\\Microsoft\\Cryptography",
        &mut entropy,
    );
    emit_obfuscated_constant(
        &mut generated,
        "OBF_REG_MACHINE_GUID",
        b"MachineGuid",
        &mut entropy,
    );
    emit_obfuscated_constant(
        &mut generated,
        "OBF_CIM_SMBIOS_QUERY",
        b"(Get-CimInstance -ClassName Win32_ComputerSystemProduct -ErrorAction Stop).UUID",
        &mut entropy,
    );
    emit_obfuscated_constant(
        &mut generated,
        "OBF_RPC_APP_VERSION_PATH",
        b"/rest/v1/rpc/get_active_app_version_v3",
        &mut entropy,
    );

    let model_repos_json = r#"{
  "faster-whisper-large-v3-turbo": "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
  "faster-whisper-large-v3": "Systran/faster-whisper-large-v3",
  "faster-whisper-medium": "Systran/faster-whisper-medium",
  "faster-whisper-small": "Systran/faster-whisper-small",
  "omnivoice": "k2-fsa/OmniVoice",
  "chatterbox-turbo": "ResembleAI/chatterbox-turbo",
  "qwen3-tts-1.7b-base": "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
}"#;
    emit_obfuscated_constant(
        &mut generated,
        "OBF_AI_MODEL_REPOS_JSON",
        model_repos_json.as_bytes(),
        &mut entropy,
    );

    let runtime_specs_json = r#"{
  "torch_cu128_index": "https://download.pytorch.org/whl/cu128",
  "torch_cpu_index": "https://download.pytorch.org/whl/cpu",
  "markers": {
    "faster-whisper": "faster_whisper",
    "omnivoice": "omnivoice",
    "chatterbox": "chatterbox",
    "qwen": "qwen_tts"
  },
  "whisper_base": [
    "faster-whisper==1.2.1",
    "ctranslate2==4.8.2",
    "av>=14.0",
    "scipy>=1.13.0",
    "librosa>=0.11.0",
    "soundfile>=0.13.0",
    "numpy>=2.0.0,<2.5.0",
    "huggingface_hub>=0.30.0",
    "hf-xet>=1.0.0",
    "tqdm>=4.66.0",
    "certifi"
  ],
  "whisper_cuda_extra": [
    "nvidia-cublas-cu12",
    "nvidia-cudnn-cu12",
    "nvidia-cuda-runtime-cu12"
  ],
  "torch_packages": [
    "torch==2.8.0",
    "torchaudio==2.8.0"
  ],
  "omnivoice_deps": [
    "numpy>=2.0.0,<2.5.0",
    "soundfile>=0.13.0",
    "scipy>=1.13.0",
    "librosa>=0.11.0",
    "accelerate>=1.12.0",
    "transformers>=5.3.0,<6.0.0",
    "safetensors>=0.7.0",
    "tokenizers>=0.22.0",
    "pydub>=0.25.1",
    "webdataset>=1.0.0",
    "tensorboardX>=2.6.0",
    "av>=14.0",
    "faster-whisper==1.2.1",
    "ctranslate2==4.8.2",
    "huggingface_hub>=0.30.0",
    "hf-xet>=1.0.0",
    "tqdm>=4.66.0",
    "certifi"
  ],
  "omnivoice_leaf": "omnivoice==0.2.1",
  "chatterbox_deps": [
    "setuptools<81",
    "numpy==1.26.4",
    "soundfile>=0.13.0",
    "scipy>=1.13.0",
    "librosa==0.11.0",
    "transformers==5.2.0",
    "diffusers==0.29.0",
    "safetensors>=0.5.3",
    "tokenizers>=0.22.0",
    "s3tokenizer",
    "resemble-perth>=1.0.0",
    "conformer==0.3.2",
    "spacy-pkuseg",
    "pykakasi==2.3.0",
    "pyloudnorm",
    "omegaconf>=2.3.0",
    "einops>=0.8.0",
    "huggingface_hub>=0.30.0",
    "hf-xet>=1.0.0",
    "tqdm>=4.66.0",
    "certifi"
  ],
  "chatterbox_leaf": "chatterbox-tts==0.1.7",
  "qwen_deps": [
    "numpy>=2.0.0,<2.5.0",
    "soundfile>=0.13.0",
    "onnxruntime>=1.20.0",
    "transformers==4.57.3",
    "accelerate==1.12.0",
    "librosa>=0.11.0",
    "scipy>=1.13.0",
    "sox>=1.5.0",
    "einops>=0.8.0",
    "safetensors>=0.7.0",
    "huggingface_hub>=0.30.0",
    "hf-xet>=1.0.0",
    "tqdm>=4.66.0",
    "certifi"
  ],
  "qwen_leaf": "qwen-tts==0.1.1"
}"#;
    emit_obfuscated_constant(
        &mut generated,
        "OBF_AI_RUNTIME_SPECS_JSON",
        runtime_specs_json.as_bytes(),
        &mut entropy,
    );

    let hf_downloader_py = r#"
import fnmatch
import json
import os
import shutil
import threading
import time

os.environ.pop("HF_HUB_OFFLINE", None)
os.environ.pop("TRANSFORMERS_OFFLINE", None)
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
os.environ["HF_XET_HIGH_PERFORMANCE"] = "1"
os.environ["HF_XET_NUM_CONCURRENT_RANGE_GETS"] = "32"

repo_id = _VOXLAB_CFG["repo_id"]
dest_dir = _VOXLAB_CFG["dest_dir"]
allow_patterns = _VOXLAB_CFG.get("allow_patterns")
fallback_total_mb = float(_VOXLAB_CFG.get("fallback_total_mb", 100.0))

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
        max_workers=8,
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
    emit_obfuscated_constant(
        &mut generated,
        "OBF_HF_DOWNLOADER_PY",
        hf_downloader_py.as_bytes(),
        &mut entropy,
    );

    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR must be set by Cargo");
    let out_file = Path::new(&out_dir).join("obf_constants.rs");
    fs::write(&out_file, generated).expect("Failed to write obf_constants.rs");
}

fn main() {
    generate_obfuscated_constants();
    tauri_build::build()
}
