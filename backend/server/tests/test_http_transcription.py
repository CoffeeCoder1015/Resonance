from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from threading import Event, Lock
from time import monotonic, sleep
from unittest import TestCase
from unittest.mock import Mock, patch

import numpy
import soundfile
from fastapi.testclient import TestClient

from resonance_backend import app as app_module
from resonance_backend.asr import ASRCancelled


def wav_upload(frame_count: int = 160) -> bytes:
    samples = numpy.zeros((frame_count, 1), dtype="float32")
    buffer = BytesIO()
    soundfile.write(
        buffer,
        samples,
        app_module.SAMPLE_RATE,
        format="WAV",
        subtype="PCM_16",
    )
    return buffer.getvalue()


class HttpTranscriptionTests(TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app_module.app, raise_server_exceptions=False)
        self.settings = {
            "transcription_provider": "passthrough",
            "asr_provider": "whisper",
        }

    def post_voice(self, job_id: str, audio: bytes | None = None):
        return self.client.post(
            "/v1/voice/process",
            params={"mode": "transcription"},
            headers={"X-Resonance-Job-Id": job_id},
            files={
                "file": (
                    "speech.wav",
                    wav_upload() if audio is None else audio,
                    "audio/wav",
                )
            },
        )

    def test_voice_process_decodes_real_wav_and_executes_asr_stub(self) -> None:
        execution = {}

        def execute_model(audio, cancelled=None) -> str:
            del cancelled
            execution["audio"] = audio
            return "  recognized words  "

        with (
            patch.object(app_module, "load_settings", return_value=self.settings),
            patch.object(
                app_module.asr_runtime,
                "transcribe",
                side_effect=execute_model,
            ),
        ):
            response = self.post_voice("wav-job")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "transcript": "recognized words",
                "text": "recognized words",
                "mode": "transcription",
                "downstream": {
                    "provider": "passthrough",
                    "status": "completed",
                },
            },
        )
        self.assertEqual(execution["audio"]["sampling_rate"], app_module.SAMPLE_RATE)
        self.assertIsInstance(execution["audio"]["array"], numpy.ndarray)
        self.assertEqual(execution["audio"]["array"].dtype, numpy.float32)
        self.assertEqual(execution["audio"]["array"].shape, (160,))

    def test_voice_process_falls_back_to_raw_asr_when_refinement_fails(self) -> None:
        provider = Mock()
        provider.respond.side_effect = RuntimeError("refinement model unavailable")

        with (
            patch.object(app_module, "load_settings", return_value={
                **self.settings,
                "transcription_provider": "lfm-transcription",
            }),
            patch.object(app_module.asr_runtime, "transcribe", return_value="raw ASR"),
            patch.object(app_module, "get_response_provider", return_value=provider),
        ):
            response = self.post_voice("fallback-job")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "transcript": "raw ASR",
            "text": "raw ASR",
            "mode": "transcription",
            "downstream": {
                "provider": "lfm-transcription",
                "status": "failed",
                "error": "refinement model unavailable",
            },
        })

    def test_cancelled_job_returns_conflict_and_next_job_succeeds(self) -> None:
        first_started = Event()
        calls_lock = Lock()
        calls = 0

        def execute_model(audio, cancelled=None) -> str:
            del audio
            nonlocal calls
            with calls_lock:
                calls += 1
                call_number = calls
            if call_number == 1:
                first_started.set()
                deadline = monotonic() + 5
                while monotonic() < deadline:
                    if cancelled is not None and cancelled():
                        raise ASRCancelled("cancelled by test")
                    sleep(0.005)
                raise AssertionError("cancellation was not delivered")
            return "independent transcript"

        with (
            patch.object(app_module, "load_settings", return_value=self.settings),
            patch.object(
                app_module.asr_runtime,
                "transcribe",
                side_effect=execute_model,
            ),
        ):
            with ThreadPoolExecutor(max_workers=1) as executor:
                pending = executor.submit(self.post_voice, "cancelled-job")
                self.assertTrue(first_started.wait(timeout=2))

                cancel = self.client.post(
                    "/v1/transcriptions/cancelled-job/cancel"
                )
                self.assertEqual(cancel.status_code, 200)
                self.assertEqual(cancel.json(), {"status": "cancelled"})

                cancelled = pending.result(timeout=5)
                self.assertEqual(cancelled.status_code, 409)

            independent = self.post_voice("independent-job")

        self.assertEqual(independent.status_code, 200)
        self.assertEqual(independent.json()["transcript"], "independent transcript")
        self.assertEqual(calls, 2)

    def test_agent_provider_routes_are_removed(self) -> None:
        self.assertEqual(self.client.get("/v1/agent/providers").status_code, 404)
        self.assertEqual(
            self.client.put(
                "/v1/agent/providers/current",
                json={"provider": "opencode"},
            ).status_code,
            404,
        )

    def test_agent_voice_mode_is_rejected(self) -> None:
        response = self.client.post(
            "/v1/voice/process",
            params={"mode": "agent"},
            files={"file": ("speech.wav", wav_upload(), "audio/wav")},
        )

        self.assertEqual(response.status_code, 422)

    def test_text_process_route_is_removed(self) -> None:
        response = self.client.post(
            "/v1/text/process",
            json={"text": "typed text", "mode": "transcription"},
        )

        self.assertEqual(response.status_code, 404)
