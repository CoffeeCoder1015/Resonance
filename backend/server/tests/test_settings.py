import tempfile
import unittest
from pathlib import Path

from resonance_backend.settings import (
    DEFAULT_AGENT_PROVIDER,
    DEFAULT_ASR_PROVIDER,
    DEFAULT_TRANSCRIPTION_PROVIDER,
    load_agent_provider,
    load_asr_provider,
    load_transcription_provider,
    save_agent_provider,
    save_asr_provider,
    save_transcription_provider,
)


class SettingsTests(unittest.TestCase):
    def test_missing_config_uses_default_providers(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"

            self.assertEqual(
                load_agent_provider(path),
                DEFAULT_AGENT_PROVIDER,
            )
            self.assertEqual(
                load_transcription_provider(path),
                DEFAULT_TRANSCRIPTION_PROVIDER,
            )
            self.assertEqual(load_asr_provider(path), DEFAULT_ASR_PROVIDER)

    def test_pipeline_providers_are_saved_independently(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"

            save_agent_provider("antigravity", path)
            save_transcription_provider("lfm-transcription", path)

            self.assertEqual(load_agent_provider(path), "antigravity")
            self.assertEqual(
                load_transcription_provider(path),
                "lfm-transcription",
            )
            self.assertTrue(path.is_file())

    def test_providers_share_one_config(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"

            save_agent_provider("antigravity", path)
            save_transcription_provider("passthrough", path)
            save_asr_provider("alternate", path)
            self.assertEqual(load_agent_provider(path), "antigravity")
            self.assertEqual(load_transcription_provider(path), "passthrough")
            self.assertEqual(load_asr_provider(path), "alternate")

    def test_cross_pipeline_provider_config_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(
                (
                    '{"agent_provider": "passthrough", '
                    '"transcription_provider": "opencode", '
                    '"asr_provider": "whisper"}'
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(RuntimeError, "config.json is invalid"):
                load_agent_provider(path)


if __name__ == "__main__":
    unittest.main()
