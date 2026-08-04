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
            "agent_provider": "opencode",
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

    def test_agent_failure_is_an_http_failure(self) -> None:
        provider = Mock()
        provider.respond.side_effect = RuntimeError("agent unavailable")
        with patch.object(app_module, "get_response_provider", return_value=provider):
            with self.assertRaises(HTTPException) as context:
                app_module.process_text("Question", "opencode", "agent")

        self.assertEqual(context.exception.status_code, 502)
        self.assertIn("agent unavailable", context.exception.detail)

    @patch.object(
        app_module,
        "load_settings",
        return_value={
            "agent_provider": "opencode",
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

    def test_provider_cannot_cross_pipeline_boundary(self) -> None:
        with self.assertRaises(HTTPException) as context:
            app_module.process_text("Question", "passthrough", "agent")

        self.assertEqual(context.exception.status_code, 500)

    @patch.object(
        app_module,
        "load_settings",
        return_value={
            "agent_provider": "antigravity",
            "transcription_provider": "passthrough",
            "asr_provider": "whisper",
        },
    )
    @patch.object(app_module, "get_response_provider")
    def test_text_request_uses_the_provider_for_its_mode(
        self,
        get_provider: Mock,
        load_settings: Mock,
    ) -> None:
        get_provider.return_value.respond.return_value = "Agent response"
        request = app_module.TextPipelineRequest(text="Typed text", mode="agent")

        result = app_module.process_text_request(request)

        self.assertEqual(result["text"], "Agent response")
        get_provider.assert_called_once_with("antigravity")


if __name__ == "__main__":
    unittest.main()
