//! Local model registry and installed-state scan for the VoxLab Models directory.
//! Models are never bundled and never downloaded implicitly (Gate E §3).

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSpec {
    pub id: &'static str,
    pub kind: &'static str,    // "asr" | "tts"
    pub engine: &'static str,  // "faster-whisper" | "omnivoice" | "chatterbox" | "qwen-tts"
    pub runtime: &'static str, // sidecar runtime that can load it
    pub display_name: &'static str,
    pub source_repo: &'static str,
    pub approx_size_mb: u32,
    pub license: &'static str,
    pub required_files: &'static [&'static str],
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    #[serde(flatten)]
    pub spec: ModelSpec,
    pub path: String,
    pub installed: bool,
    pub missing_files: Vec<String>,
    pub size_on_disk_mb: u64,
}

pub const MODELS: &[ModelSpec] = &[
    ModelSpec {
        id: "faster-whisper-small",
        kind: "asr",
        engine: "faster-whisper",
        runtime: "core",
        display_name: "Whisper small (faster-whisper)",
        source_repo: "Systran/faster-whisper-small",
        approx_size_mb: 464,
        license: "MIT",
        required_files: &["model.bin", "config.json", "tokenizer.json", "vocabulary.txt"],
    },
    ModelSpec {
        id: "omnivoice",
        kind: "tts",
        engine: "omnivoice",
        runtime: "core",
        display_name: "OmniVoice",
        source_repo: "k2-fsa/OmniVoice",
        approx_size_mb: 3116,
        license: "CC-BY-NC-4.0 (weights); Boson Higgs Audio 2 Community License (audio tokenizer); Apache-2.0 (code)",
        required_files: &["config.json", "model.safetensors", "tokenizer.json", "audio_tokenizer/model.safetensors", "audio_tokenizer/LICENSE"],
    },
    ModelSpec {
        id: "chatterbox-turbo",
        kind: "tts",
        engine: "chatterbox",
        runtime: "chatterbox",
        display_name: "Chatterbox Turbo",
        source_repo: "ResembleAI/chatterbox-turbo",
        approx_size_mb: 2849,
        license: "MIT (weights and code); output carries Resemble Perth watermark",
        required_files: &[
            "ve.safetensors", "t3_turbo_v1.safetensors", "s3gen_meanflow.safetensors", "vocab.json", "merges.txt",
            "tokenizer_config.json", "special_tokens_map.json", "added_tokens.json", "conds.pt",
        ],
    },
    ModelSpec {
        id: "qwen3-tts-1.7b-base",
        kind: "tts",
        engine: "qwen",
        runtime: "qwen",
        display_name: "Qwen3-TTS 1.7B Base",
        source_repo: "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
        approx_size_mb: 4334,
        license: "Apache-2.0 (weights and code)",
        required_files: &[
            "config.json", "generation_config.json", "model.safetensors", "vocab.json", "merges.txt",
            "tokenizer_config.json", "preprocessor_config.json", "speech_tokenizer/model.safetensors",
            "speech_tokenizer/config.json",
        ],
    },
];

fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else { return 0 };
    entries
        .flatten()
        .map(|e| match e.metadata() {
            Ok(m) if m.is_dir() => dir_size(&e.path()),
            Ok(m) => m.len(),
            Err(_) => 0,
        })
        .sum()
}

pub fn scan(models_dir: &Path) -> Vec<ModelStatus> {
    MODELS
        .iter()
        .map(|spec| {
            let dir = models_dir.join(spec.id);
            let missing: Vec<String> = spec
                .required_files
                .iter()
                .filter(|f| !dir.join(f).is_file())
                .map(|f| f.to_string())
                .collect();
            ModelStatus {
                spec: spec.clone(),
                path: dir.to_string_lossy().to_string(),
                installed: missing.is_empty(),
                size_on_disk_mb: if dir.is_dir() { dir_size(&dir) / (1024 * 1024) } else { 0 },
                missing_files: missing,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_reports_missing_and_installed() {
        let tmp = std::env::temp_dir().join(format!("voxlab-models-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let whisper = tmp.join("faster-whisper-small");
        std::fs::create_dir_all(&whisper).unwrap();
        for f in ["model.bin", "config.json", "tokenizer.json", "vocabulary.txt"] {
            std::fs::write(whisper.join(f), b"x").unwrap();
        }
        let result = scan(&tmp);
        let w = result.iter().find(|m| m.spec.id == "faster-whisper-small").unwrap();
        assert!(w.installed && w.missing_files.is_empty());
        let o = result.iter().find(|m| m.spec.id == "omnivoice").unwrap();
        assert!(!o.installed);
        assert!(o.missing_files.contains(&"model.safetensors".to_string()));
        let c = result.iter().find(|m| m.spec.id == "chatterbox-turbo").unwrap();
        assert!(!c.installed && c.spec.runtime == "chatterbox");
        let q = result.iter().find(|m| m.spec.id == "qwen3-tts-1.7b-base").unwrap();
        assert!(!q.installed && q.spec.runtime == "qwen");
        std::fs::remove_dir_all(&tmp).unwrap();
    }
}
