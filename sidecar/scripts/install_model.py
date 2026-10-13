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
    "faster-whisper-large-v3-turbo": {
        "repo": "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
        "allow": ["model.bin", "config.json", "tokenizer.json", "vocabulary.*", "preprocessor_config.json"],
    },
    "faster-whisper-large-v3": {
        "repo": "Systran/faster-whisper-large-v3",
        "allow": ["model.bin", "config.json", "tokenizer.json", "vocabulary.*", "preprocessor_config.json"],
    },
    "faster-whisper-medium": {
        "repo": "Systran/faster-whisper-medium",
        "allow": ["model.bin", "config.json", "tokenizer.json", "vocabulary.*"],
    },
    "faster-whisper-small": {
        "repo": "Systran/faster-whisper-small",
        "allow": ["model.bin", "config.json", "tokenizer.json", "vocabulary.*"],
    },
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
    os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
    import time
    from tqdm import tqdm
    from huggingface_hub import snapshot_download

    class ProgressPrinter(tqdm):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._last_print = time.time()

        def update(self, n=1):
            super().update(n)
            now = time.time()
            if now - self._last_print >= 5:
                self._last_print = now
                if self.total:
                    mb = self.n / (1024 * 1024)
                    total_mb = self.total / (1024 * 1024)
                    pct = (self.n / self.total * 100)
                    print(f"[{self.desc or 'Downloading'}] {mb:.1f} / {total_mb:.1f} MB ({pct:.1f}%)", flush=True)

    dest = os.path.join(models_dir, model_id)
    os.makedirs(dest, exist_ok=True)
    print(f"Starting download for {model_id} from {spec['repo']} into {dest}...", flush=True)
    path = snapshot_download(
        spec["repo"],
        local_dir=dest,
        allow_patterns=spec["allow"],
        tqdm_class=ProgressPrinter,
        max_workers=4,
    )

    # Ensure vocabulary.txt is generated if vocabulary.json exists (CTranslate2 large-v3 & turbo)
    vocab_json = os.path.join(dest, "vocabulary.json")
    vocab_txt = os.path.join(dest, "vocabulary.txt")
    if os.path.isfile(vocab_json) and not os.path.isfile(vocab_txt):
        try:
            with open(vocab_json, "r", encoding="utf-8") as f:
                tokens = json.load(f)
            if isinstance(tokens, list):
                with open(vocab_txt, "w", encoding="utf-8") as f:
                    for t in tokens:
                        f.write(f"{t}\n")
        except Exception as e:
            print(f"Warning: could not convert vocabulary.json to vocabulary.txt: {e}", file=sys.stderr)

    total = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(path) for f in fs
                if ".cache" not in r)
    print(json.dumps({"ok": True, "modelId": model_id, "path": path, "sizeMb": round(total / 1048576, 1)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
