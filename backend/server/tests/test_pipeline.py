import unittest
from unittest.mock import Mock, patch

from fastapi import BackgroundTasks, HTTPException, Response

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
    def test_voice_turn_is_asr_then_response_provider(
        self,
        load_settings: Mock,
        transcribe: Mock,
    ) -> None:
        background_tasks = BackgroundTasks()
        response = Response()
        upload = Mock()

        turn = app_module.create_voice_turn(
            background_tasks,
            response,
            upload,
            "transcription",
        )

        transcribe.assert_called_once_with(upload)
        self.assertEqual(turn["transcript"], "ASR text")
        self.assertEqual(turn["status"], "responding")
        self.assertEqual(len(background_tasks.tasks), 1)
        response_stage = background_tasks.tasks[0]
        self.assertIs(response_stage.func, app_module.run_response_stage)
        self.assertEqual(
            response_stage.args[1:],
            ("ASR text", "passthrough", "transcription"),
        )

    def test_passthrough_runs_through_the_response_provider_contract(self) -> None:
        turn_id = "turn_pipeline"
        app_module.turns[turn_id] = {
            "id": turn_id,
            "status": "responding",
            "transcript": "ASR text",
            "response_provider": "passthrough",
            "mode": "transcription",
        }

        app_module.run_response_stage(
            turn_id,
            "ASR text",
            "passthrough",
            "transcription",
        )

        self.assertEqual(app_module.turns[turn_id]["status"], "completed")
        self.assertEqual(app_module.turns[turn_id]["response"], "ASR text")
        del app_module.turns[turn_id]

    def test_pipeline_mode_belongs_to_each_turn(self) -> None:
        background_tasks = BackgroundTasks()

        transcription = app_module.create_turn(
            "Dictated text",
            background_tasks,
            "passthrough",
            "transcription",
        )
        agent = app_module.create_turn(
            "Question",
            background_tasks,
            "opencode",
            "agent",
        )

        self.assertEqual(transcription["mode"], "transcription")
        self.assertEqual(agent["mode"], "agent")
        del app_module.turns[transcription["id"]]
        del app_module.turns[agent["id"]]

    def test_provider_cannot_cross_pipeline_boundary(self) -> None:
        with self.assertRaises(HTTPException) as context:
            app_module.create_turn(
                "Question",
                BackgroundTasks(),
                "gemma",
                "agent",
            )

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
    def test_text_turn_uses_the_provider_for_its_mode(
        self,
        load_settings: Mock,
    ) -> None:
        background_tasks = BackgroundTasks()
        response = Response()
        request = app_module.TextTurn(text="Typed text", mode="agent")

        turn = app_module.create_text_turn(request, background_tasks, response)

        self.assertEqual(turn["transcript"], "Typed text")
        self.assertEqual(turn["response_provider"], "antigravity")
        self.assertEqual(turn["mode"], "agent")
        self.assertEqual(len(background_tasks.tasks), 1)
        self.assertIs(background_tasks.tasks[0].func, app_module.run_response_stage)


if __name__ == "__main__":
    unittest.main()
