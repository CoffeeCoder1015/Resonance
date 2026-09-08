import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException

from resonance_backend import app as app_module


class PipelineTests(unittest.TestCase):
    @patch.object(app_module, "transcribe", return_value="ASR text")
    @patch.object(
        app_module,
        "load_settings",
        return_value={
            "transcription_provider": "passthrough",
            "asr_provider": "whisper",
        },
    )
    def test_voice_request_runs_asr_and_downstream_inline(
        self,
        load_settings: Mock,
        transcribe: Mock,
    ) -> None:
        upload = Mock()

        result = app_module.process_voice(upload, "transcription")

        transcribe.assert_called_once_with(upload)
        self.assertEqual(result["transcript"], "ASR text")
        self.assertEqual(result["text"], "ASR text")
        self.assertEqual(
            result["downstream"],
            {"provider": "passthrough", "status": "completed"},
        )

    def test_transcription_preserves_raw_asr_when_refinement_fails(self) -> None:
        provider = Mock()
        provider.respond.side_effect = RuntimeError("model crashed")
        with patch.object(app_module, "get_response_provider", return_value=provider):
            result = app_module.process_text(
                "Raw transcript",
                "lfm-transcription",
                "transcription",
            )

        self.assertEqual(result["text"], "Raw transcript")
        self.assertEqual(
            result["downstream"],
            {
                "provider": "lfm-transcription",
                "status": "failed",
                "error": "model crashed",
            },
        )

    @patch.object(
        app_module,
        "load_settings",
        return_value={
            "transcription_provider": "passthrough",
            "asr_provider": "whisper",
        },
    )
    @patch.object(app_module, "transcribe", return_value="Stale transcript")
    def test_cancellation_can_arrive_before_the_voice_request_starts(
        self,
        transcribe: Mock,
        load_settings: Mock,
    ) -> None:
        job_id = "cancel-before-start"
        app_module.cancel_transcription(job_id)

        with self.assertRaises(HTTPException) as context:
            app_module.process_voice(Mock(), "transcription", job_id)

        self.assertEqual(context.exception.status_code, 409)
        self.assertNotIn(job_id, app_module.transcription_jobs._jobs)

if __name__ == "__main__":
    unittest.main()
