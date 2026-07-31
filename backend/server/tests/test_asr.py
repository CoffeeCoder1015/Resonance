import asyncio
import unittest
from unittest.mock import Mock, patch

from resonance_backend import app as app_module
from resonance_backend.asr import ASRProvider, WhisperASR
from resonance_backend.asr_providers import ASRRuntime


class ASRTests(unittest.TestCase):
    @patch("resonance_backend.asr.pipeline")
    def test_whisper_transcribes_audio(self, pipeline_factory: Mock) -> None:
        transcriber = pipeline_factory.return_value
        transcriber.return_value = {"text": "  Hello world.  "}

        provider = WhisperASR(model="openai/whisper-base.en")
        provider.load()
        audio = {
            "array": object(),
            "sampling_rate": 16_000,
        }

        self.assertEqual(
            provider.transcribe(audio),
            "Hello world.",
        )
        provider.load()
        pipeline_factory.assert_called_once_with(
            task="automatic-speech-recognition",
            model="openai/whisper-base.en",
            device=-1,
        )
        transcriber.assert_called_once_with(audio, return_timestamps=True)

    @patch("resonance_backend.asr.pipeline")
    def test_whisper_rejects_invalid_output(self, pipeline_factory: Mock) -> None:
        pipeline_factory.return_value.return_value = {"text": None}
        provider = WhisperASR(model="openai/whisper-base.en")
        provider.load()

        with self.assertRaisesRegex(
            RuntimeError,
            "ASR pipeline returned an invalid result.",
        ):
            provider.transcribe(
                {
                    "array": object(),
                    "sampling_rate": 16_000,
                }
            )

    @patch("resonance_backend.asr.pipeline")
    def test_whisper_can_be_unloaded_and_reloaded(
        self,
        pipeline_factory: Mock,
    ) -> None:
        provider = WhisperASR(model="openai/whisper-base.en")

        provider.load()
        provider.unload()
        provider.load()

        self.assertEqual(pipeline_factory.call_count, 2)

    @patch.object(app_module, "asr_runtime")
    @patch.object(app_module, "load_asr_provider", return_value="whisper")
    def test_backend_owns_selected_asr_lifecycle(
        self,
        load_selection: Mock,
        runtime: Mock,
    ) -> None:
        async def run_lifespan() -> None:
            async with app_module.lifespan(app_module.app):
                runtime.load.assert_called_once_with("whisper")
                runtime.unload.assert_not_called()

        asyncio.run(run_lifespan())
        runtime.unload.assert_called_once_with()

    def test_runtime_switches_loaded_provider(self) -> None:
        whisper = Mock(spec=ASRProvider, id="whisper", label="Whisper")
        alternate = Mock(spec=ASRProvider, id="alternate", label="Alternate")
        runtime = ASRRuntime(
            {
                "whisper": whisper,
                "alternate": alternate,
            }
        )

        runtime.load("whisper")
        runtime.select("alternate")
        audio = {"array": object(), "sampling_rate": 16_000}
        runtime.transcribe(audio)

        whisper.load.assert_called_once_with()
        whisper.unload.assert_called_once_with()
        alternate.load.assert_called_once_with()
        alternate.transcribe.assert_called_once_with(audio)
        self.assertEqual(runtime.current_id, "alternate")

    def test_runtime_restores_provider_when_switch_fails(self) -> None:
        whisper = Mock(spec=ASRProvider, id="whisper", label="Whisper")
        alternate = Mock(spec=ASRProvider, id="alternate", label="Alternate")
        alternate.load.side_effect = RuntimeError("load failed")
        runtime = ASRRuntime(
            {
                "whisper": whisper,
                "alternate": alternate,
            }
        )

        runtime.load("whisper")
        with self.assertRaisesRegex(RuntimeError, "load failed"):
            runtime.select("alternate")

        self.assertEqual(whisper.load.call_count, 2)
        self.assertEqual(runtime.current_id, "whisper")


if __name__ == "__main__":
    unittest.main()
