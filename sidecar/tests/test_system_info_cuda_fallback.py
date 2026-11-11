import builtins
import os
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import voxlab_sidecar.__main__ as main_mod
import voxlab_sidecar.asr_engine as asr_mod


class SystemInfoCudaFallbackTests(unittest.TestCase):
    def test_system_info_detects_gpu_and_vram_without_torch_installed(self):
        real_import = builtins.__import__

        def fake_import(name, globals=None, locals=None, fromlist=(), level=0):
            if name == "torch" or name.startswith("torch."):
                raise ImportError("No module named 'torch'")
            return real_import(name, globals, locals, fromlist, level)

        fake_tts = MagicMock()
        fake_tts.status.return_value = {"loaded": False}
        fake_proc = MagicMock()
        fake_proc.returncode = 0
        fake_proc.stdout = "NVIDIA GeForce RTX 5070 Ti, 16303, 14920\n"

        with patch("builtins.__import__", side_effect=fake_import):
            with patch("subprocess.run", return_value=fake_proc):
                info = main_mod.system_info("core", None, fake_tts)

        self.assertIsNone(info["torch"])
        self.assertTrue(info["cudaAvailable"])
        self.assertEqual(info["gpu"], "NVIDIA GeForce RTX 5070 Ti")
        self.assertEqual(info["vramTotalMb"], 16303)
        self.assertEqual(info["vramFreeMb"], 14920)

    @unittest.skipUnless(os.name == "nt", "Windows DLL registration test")
    def test_register_cuda_dlls_prioritizes_torch_lib_and_preserves_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            torch_lib = os.path.join(tmp, "torch", "lib")
            cublas_bin = os.path.join(tmp, "nvidia", "cublas", "bin")
            cudnn_bin = os.path.join(tmp, "nvidia", "cudnn", "bin")
            os.makedirs(torch_lib)
            os.makedirs(cublas_bin)
            os.makedirs(cudnn_bin)

            old_flag = asr_mod._cuda_dlls_registered
            old_path = os.environ.get("PATH", "")
            try:
                asr_mod._cuda_dlls_registered = False
                os.environ["PATH"] = r"C:\Windows\System32"
                fake_spec = MagicMock()
                fake_spec.origin = os.path.join(tmp, "torch", "__init__.py")
                with patch("importlib.util.find_spec", return_value=fake_spec):
                    with patch.object(sys, "path", [tmp]):
                        with patch("os.add_dll_directory", create=True):
                            asr_mod._register_cuda_dlls()
                new_path = os.environ["PATH"]
                # torch/lib must appear BEFORE nvidia/cudnn/bin in PATH
                self.assertLess(
                    new_path.lower().index(torch_lib.lower()),
                    new_path.lower().index(cudnn_bin.lower()),
                )
            finally:
                asr_mod._cuda_dlls_registered = old_flag
                os.environ["PATH"] = old_path


if __name__ == "__main__":
    unittest.main()
