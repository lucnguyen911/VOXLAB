import sys
import tempfile
import unittest
from pathlib import Path
import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from voxlab_sidecar.audio_ops import prepare_clone_reference


def _write_speech_like_wav(path: Path, duration_sec: float, sr: int = 24000) -> Path:
    t = np.linspace(0, duration_sec, int(duration_sec * sr), endpoint=False, dtype=np.float32)
    envelope = 0.25 + 0.10 * np.sin(2 * np.pi * 3.0 * t)
    samples = envelope * (
        0.6 * np.sin(2 * np.pi * 180.0 * t)
        + 0.3 * np.sin(2 * np.pi * 360.0 * t)
        + 0.1 * np.sin(2 * np.pi * 540.0 * t)
    )
    sf.write(str(path), samples.astype(np.float32), sr, subtype="PCM_16")
    return path


class TestCloneReferenceRules(unittest.TestCase):
    def test_preserves_6s_8s_10s_15s_trimmed_samples_and_ref_text(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            for dur in (6.0, 8.0, 10.0, 15.0):
                src = _write_speech_like_wav(tmp_dir / f"sample_{int(dur)}s.wav", dur)
                for engine, max_dur in (("omnivoice", 15.5), ("qwen_tts_1_7b", 15.5), ("chatterbox_turbo", 20.5)):
                    prep_wav, prep_txt = prepare_clone_reference(
                        str(src),
                        ref_text="Exact user reference transcript.",
                        language="en",
                        max_duration=max_dur,
                        skip_transcribe=True,
                        engine=engine,
                    )
                    self.assertEqual(
                        Path(prep_wav).resolve(),
                        src.resolve(),
                        f"{engine} should NOT slice a user-trimmed {dur}s sample (max_duration={max_dur})",
                    )
                    self.assertEqual(prep_txt, "Exact user reference transcript.")

    def test_auto_slices_untrimmed_long_file_to_engine_sweet_spot(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            src_26s = _write_speech_like_wav(tmp_dir / "untrimmed_26s.wav", 26.0)

            omni_wav, _ = prepare_clone_reference(
                str(src_26s),
                ref_text="Full 26s transcript",
                max_duration=15.5,
                skip_transcribe=True,
                engine="omnivoice",
            )
            self.assertNotEqual(Path(omni_wav).resolve(), src_26s.resolve())
            omni_dur = float(sf.info(omni_wav).duration)
            self.assertGreaterEqual(omni_dur, 6.0)
            self.assertLessEqual(omni_dur, 10.1)

            chatter_wav, _ = prepare_clone_reference(
                str(src_26s),
                ref_text="Full 26s transcript",
                max_duration=20.5,
                skip_transcribe=True,
                engine="chatterbox_turbo",
            )
            self.assertNotEqual(Path(chatter_wav).resolve(), src_26s.resolve())
            chatter_dur = float(sf.info(chatter_wav).duration)
            self.assertGreaterEqual(chatter_dur, 8.0)
            self.assertLessEqual(chatter_dur, 13.6)


if __name__ == "__main__":
    unittest.main()
