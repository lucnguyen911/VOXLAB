"""Explicit model installer (never invoked implicitly by the sidecar).

    python sidecar/scripts/install_model.py <model-id> <models-dir>

Downloads only the files the engine actually loads into <models-dir>/<model-id>.
This is the backend for the Settings "Install model" action and for dev verification.
"""
from __future__ import annotations

import json
import os
import sys

MODELS = {
    "faster-whisper-small": {"repo": "Systran/faster-whisper-small", "allow": None},
    "omnivoice": {"repo": "k2-fsa/OmniVoice", "allow": None},
    # s3gen.safetensors (1 GB) is not used by Turbo; skip it.
    "chatterbox-turbo": {
        "repo": "ResembleAI/chatterbox-turbo",
        "allow": ["ve.safetensors", "t3_turbo_v1.safetensors", "t3_turbo_v1.yaml", "s3gen_meanflow.safetensors",
                  "vocab.json", "merges.txt", "tokenizer_config.json", "special_tokens_map.json",
                  "added_tokens.json", "conds.pt", "README.md"],
    },
    "qwen3-tts-1.7b-base": {"repo": "Qwen/Qwen3-TTS-12Hz-1.7B-Base", "allow": None},
}


def main() -> int:
    model_id, models_dir = sys.argv[1], sys.argv[2]
    spec = MODELS.get(model_id)
    if spec is None:
        print(json.dumps({"ok": False, "error": f"unknown model '{model_id}'"}))
        return 2
    os.environ.pop("HF_HUB_OFFLINE", None)
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    from huggingface_hub import snapshot_download

    dest = os.path.join(models_dir, model_id)
    os.makedirs(dest, exist_ok=True)
    path = snapshot_download(spec["repo"], local_dir=dest, allow_patterns=spec["allow"])
    total = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(path) for f in fs
                if ".cache" not in r)
    print(json.dumps({"ok": True, "modelId": model_id, "path": path, "sizeMb": round(total / 1048576, 1)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
