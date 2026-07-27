import tempfile
import unittest
from pathlib import Path

from resonance_backend.settings import DEFAULT_PROVIDER, load_provider, save_provider


class SettingsTests(unittest.TestCase):
    def test_missing_config_uses_default_provider(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"

            self.assertEqual(load_provider(path), DEFAULT_PROVIDER)

    def test_provider_is_saved_to_disk(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"

            save_provider("antigravity", path)

            self.assertEqual(load_provider(path), "antigravity")
            self.assertTrue(path.is_file())


if __name__ == "__main__":
    unittest.main()
