import tempfile
import unittest
from pathlib import Path

from resonance_backend.settings import (
    DEFAULT_ASR_PROVIDER,
    DEFAULT_TRANSCRIPTION_PROVIDER,
    load_asr_provider,
    load_settings,
    load_transcription_provider,
    save_asr_provider,
    save_transcription_provider,
)


class SettingsTests(unittest.TestCase):
    def test_missing_config_uses_transcription_and_asr_defaults(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"

            self.assertEqual(
                load_settings(path),
                {
                    "transcription_provider": DEFAULT_TRANSCRIPTION_PROVIDER,
                    "asr_provider": DEFAULT_ASR_PROVIDER,
                },
            )

    def test_transcription_and_asr_providers_are_saved_independently(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"

            save_transcription_provider("lfm-transcription", path)
            save_asr_provider("faster-whisper", path)

            self.assertEqual(
                load_transcription_provider(path),
                "lfm-transcription",
            )
            self.assertEqual(load_asr_provider(path), "faster-whisper")
            self.assertTrue(path.is_file())

    def test_legacy_agent_provider_is_ignored(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"

            path.write_text(
                (
                    '{"agent_provider": "removed-agent", '
                    '"transcription_provider": "passthrough", '
                    '"asr_provider": "whisper"}'
                ),
                encoding="utf-8",
            )

            self.assertEqual(
                load_settings(path),
                {
                    "transcription_provider": "passthrough",
                    "asr_provider": "whisper",
                },
            )


if __name__ == "__main__":
    unittest.main()
