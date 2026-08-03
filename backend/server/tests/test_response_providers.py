import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from resonance_backend.response_providers import (
    RESPONSE_PROVIDERS,
    AntigravityResponseProvider,
    LFMTranscriptionResponseProvider,
    OpenCodeResponseProvider,
    PassthroughResponseProvider,
    _parse_opencode_error,
    _parse_opencode_response,
    get_response_provider,
    list_response_providers,
)
from resonance_backend.provider_ids import (
    AGENT_PROVIDER_IDS,
    TRANSCRIPTION_PROVIDER_IDS,
)


INSTRUCTIONS = "Return plain text."
PROMPT = (
    "[Resonance instructions]\nReturn plain text.\n\n"
    "[User message]\nHello"
)


class ResponseProviderTests(unittest.TestCase):
    def test_parses_the_last_opencode_text_event(self) -> None:
        output = "\n".join(
            [
                '{"type":"step_start","part":{}}',
                '{"type":"text","part":{"text":"Working..."}}',
                '{"type":"text","part":{"text":"Final response"}}',
            ]
        )

        self.assertEqual(_parse_opencode_response(output), "Final response")

    def test_parses_an_opencode_error_event(self) -> None:
        output = (
            '{"type":"error","error":{"name":"APIError",'
            '"data":{"message":"Subscription required"}}}'
        )

        self.assertEqual(_parse_opencode_error(output), "Subscription required")

    @patch("resonance_backend.response_providers.subprocess.run")
    def test_opencode_uses_its_default_model(self, run_mock) -> None:
        run_mock.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout='{"type":"text","part":{"text":"Response text"}}\n',
            stderr="",
        )

        with patch(
            "resonance_backend.response_providers.shutil.which",
            return_value="opencode",
        ):
            self.assertEqual(
                OpenCodeResponseProvider().respond("Hello", INSTRUCTIONS),
                "Response text",
            )

        command = run_mock.call_args.args[0]
        self.assertEqual(
            command,
            ["opencode", "run", "--format", "json", PROMPT],
        )
        self.assertNotIn("--model", command)

    @patch("resonance_backend.response_providers.subprocess.run")
    def test_antigravity_uses_plain_stdout(self, run_mock) -> None:
        run_mock.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="Response text\n",
            stderr="",
        )

        with patch(
            "resonance_backend.response_providers.shutil.which",
            return_value="agy",
        ):
            self.assertEqual(
                AntigravityResponseProvider().respond("Hello", INSTRUCTIONS),
                "Response text",
            )
        self.assertEqual(run_mock.call_args.args[0], ["agy", "-p", PROMPT])

    @patch("resonance_backend.response_providers.subprocess.run")
    def test_nonzero_exit_is_reported(self, run_mock) -> None:
        run_mock.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout="",
            stderr="Authentication required",
        )

        with patch(
            "resonance_backend.response_providers.shutil.which",
            return_value="opencode",
        ):
            with self.assertRaisesRegex(RuntimeError, "Authentication required"):
                OpenCodeResponseProvider().respond("Hello", INSTRUCTIONS)

    @patch("resonance_backend.response_providers.Llama")
    def test_lfm_uses_raw_completion_and_reuses_the_model(self, llama) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model_path = Path(directory) / "model.gguf"
            model_path.touch()
            model = llama.return_value
            model.return_value = {
                "choices": [{"text": "  Formatted transcript.\n"}]
            }
            provider = LFMTranscriptionResponseProvider(model_path)

            first = provider.respond(
                "um raw transcript",
                "Instructions that must not reach the model.",
            )
            second = provider.respond("second raw transcript", "Ignored again.")

        self.assertEqual(first, "  Formatted transcript.\n")
        self.assertEqual(second, "  Formatted transcript.\n")
        llama.assert_called_once_with(
            model_path=str(model_path),
            n_ctx=32_768,
        )
        self.assertEqual(
            model.call_args_list[0].args,
            ("um raw transcript",),
        )
        self.assertEqual(
            model.call_args_list[0].kwargs,
            {"max_tokens": None},
        )
        self.assertEqual(
            model.call_args_list[1].args,
            ("second raw transcript",),
        )
        self.assertEqual(
            model.call_args_list[1].kwargs,
            {"max_tokens": None},
        )

    def test_lfm_is_unavailable_without_its_model(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            provider = LFMTranscriptionResponseProvider(
                Path(directory) / "missing.gguf"
            )

            self.assertFalse(provider.is_available())
            with self.assertRaisesRegex(RuntimeError, "model was not found"):
                provider.respond("raw transcript", "Ignored")

    @patch("resonance_backend.response_providers.Llama")
    def test_lfm_rejects_an_empty_completion(self, llama) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model_path = Path(directory) / "model.gguf"
            model_path.touch()
            llama.return_value.return_value = {"choices": [{"text": "  "}]}
            provider = LFMTranscriptionResponseProvider(model_path)

            with self.assertRaisesRegex(RuntimeError, "empty response"):
                provider.respond("raw transcript", "Ignored")

    def test_response_providers_are_selected_by_id(self) -> None:
        self.assertIsInstance(
            get_response_provider("opencode"),
            OpenCodeResponseProvider,
        )
        self.assertIsInstance(
            get_response_provider("antigravity"),
            AntigravityResponseProvider,
        )
        self.assertIsInstance(
            get_response_provider("lfm-transcription"),
            LFMTranscriptionResponseProvider,
        )
        self.assertIsInstance(
            get_response_provider("passthrough"),
            PassthroughResponseProvider,
        )

    def test_passthrough_is_selectable_and_returns_input_unchanged(self) -> None:
        message = "First line.\n\n- Second line"

        self.assertEqual(
            PassthroughResponseProvider().respond(
                message,
                "Ignored instructions.",
            ),
            message,
        )
        self.assertIn("passthrough", RESPONSE_PROVIDERS)

    def test_pipeline_provider_lists_are_disjoint(self) -> None:
        agent_ids = {
            provider["id"] for provider in list_response_providers(AGENT_PROVIDER_IDS)
        }
        transcription_ids = {
            provider["id"]
            for provider in list_response_providers(TRANSCRIPTION_PROVIDER_IDS)
        }

        self.assertEqual(agent_ids, {"opencode", "antigravity"})
        self.assertEqual(
            transcription_ids,
            {"lfm-transcription", "passthrough"},
        )
        self.assertTrue(agent_ids.isdisjoint(transcription_ids))


if __name__ == "__main__":
    unittest.main()
