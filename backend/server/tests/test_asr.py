import asyncio
import unittest
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock, patch

import numpy
from fastapi import HTTPException

from resonance_backend import app as app_module
from resonance_backend.asr import (
    ASRCancelled,
    ASRProvider,
    FasterWhisperASR,
    WhisperASR,
)
from resonance_backend.asr_providers import ASRRuntime


class ASRTests(unittest.TestCase):
    def test_transcribe_rejects_an_oversized_raw_upload_before_decoding(self) -> None:
        oversized_file = Mock()
        oversized_file.tell.return_value = app_module.MAX_AUDIO_BYTES + 1
        upload = SimpleNamespace(file=oversized_file)

        with patch.object(app_module.soundfile, "SoundFile") as open_audio:
            with self.assertRaises(HTTPException) as context:
                app_module.transcribe(upload)

        self.assertEqual(context.exception.status_code, 413)
        self.assertEqual(context.exception.detail, "Audio recording is too large.")
        open_audio.assert_not_called()

    def test_transcribe_processes_long_audio_in_bounded_chunks(self) -> None:
        upload = SimpleNamespace(file=BytesIO(b"audio"))
        with (
            patch.object(app_module.soundfile, "SoundFile") as open_audio,
            patch.object(app_module.asr_runtime, "transcribe") as transcribe_chunk,
        ):
            audio_file = open_audio.return_value.__enter__.return_value
            open_audio.return_value = audio_file
            audio_file.__enter__.return_value = audio_file
            audio_file.frames = app_module.TRANSCRIPTION_CHUNK_FRAMES + 1
            audio_file.samplerate = app_module.SAMPLE_RATE
            audio_file.channels = 1
            audio_file.read.side_effect = [
                numpy.ones((2, 1), dtype="float32"),
                numpy.ones((1, 1), dtype="float32"),
                numpy.empty((0, 1), dtype="float32"),
            ]
            transcribe_chunk.side_effect = [" First chunk. ", "Second chunk."]

            transcript = app_module.transcribe(upload)

        self.assertEqual(transcript, "First chunk. Second chunk.")
        self.assertEqual(audio_file.read.call_count, 3)
        audio_file.read.assert_called_with(
            frames=app_module.TRANSCRIPTION_CHUNK_FRAMES,
            dtype="float32",
            always_2d=True,
        )
        self.assertEqual(transcribe_chunk.call_count, 2)

    def test_transcribe_rejects_excessive_channels_before_reading(self) -> None:
        upload = SimpleNamespace(file=BytesIO(b"audio"))
        with patch.object(app_module.soundfile, "SoundFile") as open_audio:
            audio_file = open_audio.return_value
            audio_file.frames = 1
            audio_file.samplerate = app_module.SAMPLE_RATE
            audio_file.channels = app_module.MAX_AUDIO_CHANNELS + 1

            with self.assertRaises(HTTPException) as context:
                app_module.transcribe(upload)

        self.assertEqual(context.exception.status_code, 422)
        self.assertEqual(
            context.exception.detail,
            "Audio recording must have no more than 2 channels.",
        )
        audio_file.read.assert_not_called()

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


    @patch("resonance_backend.asr._FasterWhisperModel")
    def test_faster_whisper_transcribes_audio(self, model_factory: Mock) -> None:
        model = model_factory.return_value

        def transcribe(
            audio: object,
            *,
            beam_size: int,
            vad_filter: bool,
        ) -> tuple[object, Mock]:
            del audio, beam_size, vad_filter
            return iter([Mock(text="  Hello"), Mock(text="world. ")]), Mock()

        model.transcribe = Mock(side_effect=transcribe)
        provider = FasterWhisperASR()
        provider.load()
        audio = {
            "array": object(),
            "sampling_rate": 16_000,
        }

        self.assertEqual(provider.transcribe(audio), "Hello world.")
        model_factory.assert_called_once_with(
            "small.en",
            device="cpu",
            compute_type="int8",
            cpu_threads=0,
        )
        model.transcribe.assert_called_once()
        self.assertIs(model.transcribe.call_args.args[0], audio["array"])
        self.assertEqual(model.transcribe.call_args.kwargs["beam_size"], 1)
        self.assertIs(model.transcribe.call_args.kwargs["vad_filter"], False)

    @patch("resonance_backend.asr._FasterWhisperModel", None)
    def test_faster_whisper_requires_installation(self) -> None:
        provider = FasterWhisperASR()

        with self.assertRaisesRegex(
            RuntimeError,
            "faster-whisper is not installed.",
        ):
            provider.load()

    @patch("resonance_backend.asr._FasterWhisperModel")
    def test_faster_whisper_can_be_unloaded_and_reloaded(
        self,
        model_factory: Mock,
    ) -> None:
        provider = FasterWhisperASR()

        provider.load()
        provider.unload()
        provider.load()

        self.assertEqual(model_factory.call_count, 2)

    @patch("resonance_backend.asr._FasterWhisperModel")
    def test_faster_whisper_preserves_empty_output(self, model_factory: Mock) -> None:
        model = model_factory.return_value
        model.transcribe.return_value = (iter([]), Mock())
        provider = FasterWhisperASR()
        provider.load()

        self.assertEqual(
            provider.transcribe(
                {
                    "array": object(),
                    "sampling_rate": 16_000,
                }
            ),
            "",
        )

    @patch("resonance_backend.asr._FasterWhisperModel")
    def test_faster_whisper_stops_between_segments_when_cancelled(
        self,
        model_factory: Mock,
    ) -> None:
        model_factory.return_value.transcribe.return_value = (
            iter([Mock(text="First"), Mock(text="Stale")]),
            Mock(),
        )
        provider = FasterWhisperASR()
        provider.load()
        checks = 0

        def cancelled() -> bool:
            nonlocal checks
            checks += 1
            return checks >= 3

        with self.assertRaisesRegex(ASRCancelled, "cancelled"):
            provider.transcribe(
                {"array": object(), "sampling_rate": 16_000},
                cancelled,
            )

if __name__ == "__main__":
    unittest.main()
