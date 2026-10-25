use std::fs;
use std::path::Path;

fn load_build_env_file(path: &Path) {
    println!("cargo:rerun-if-changed={}", path.display());
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return,
    };

    const ALLOWED_KEYS: &[&str] = &[
        "VOXLAB_SUPABASE_URL",
        "VOXLAB_SUPABASE_ANON_KEY",
        "VOXLAB_ENFORCE_LICENSE",
    ];

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            let key = k.trim();
            if !ALLOWED_KEYS.contains(&key) {
                continue;
            }
            if std::env::var_os(key).is_some() {
                continue;
            }
            let val = v.trim().trim_matches('"').trim_matches('\'');
            if !val.is_empty() {
                println!("cargo:rustc-env={}={}", key, val);
            }
        }
    }
}

fn main() {
    load_build_env_file(Path::new("../.env.local"));
    load_build_env_file(Path::new("../.env"));
    tauri_build::build()
}
