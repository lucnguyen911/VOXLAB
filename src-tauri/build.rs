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

    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR must be set by Cargo");
    let out_file = Path::new(&out_dir).join("obf_constants.rs");
    fs::write(&out_file, generated).expect("Failed to write obf_constants.rs");
}

fn main() {
    generate_obfuscated_constants();
    tauri_build::build()
}
