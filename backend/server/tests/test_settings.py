import tempfile
import unittest
from pathlib import Path

from resonance_backend.settings import (
    DEFAULT_ASR_PROVIDER,
    DEFAULT_RESPONSE_PROVIDER,
    load_asr_provider,
    load_response_provider,
    save_asr_provider,
    save_response_provider,
)


class SettingsTests(unittest.TestCase):
    def test_missing_config_uses_default_providers(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"

            self.assertEqual(
                load_response_provider(path),
                DEFAULT_RESPONSE_PROVIDER,
            )
            self.assertEqual(load_asr_provider(path), DEFAULT_ASR_PROVIDER)

    def test_response_provider_is_saved_to_disk(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"

            save_response_provider("antigravity", path)

            self.assertEqual(load_response_provider(path), "antigravity")
            self.assertTrue(path.is_file())

    def test_providers_share_one_config(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"

            save_response_provider("antigravity", path)
            save_asr_provider("alternate", path)
            self.assertEqual(load_response_provider(path), "antigravity")
            self.assertEqual(load_asr_provider(path), "alternate")


if __name__ == "__main__":
    unittest.main()
