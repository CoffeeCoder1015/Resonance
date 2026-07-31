import subprocess
import unittest
from unittest.mock import patch

from resonance_backend.response_providers import (
    RESPONSE_PROVIDERS,
    AntigravityResponseProvider,
    LiquidResponseProvider,
    OpenCodeResponseProvider,
    PassthroughResponseProvider,
    _parse_liquid_response,
    _parse_opencode_error,
    _parse_opencode_response,
    get_response_provider,
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

    @patch("resonance_backend.response_providers.hf_hub_download")
    @patch("resonance_backend.response_providers.Llama")
    def test_liquid_loads_once_and_uses_the_response_contract(
        self,
        llama,
        download,
    ) -> None:
        download.return_value = "model.gguf"
        model = llama.return_value
        model.create_chat_completion.return_value = {
            "choices": [
                {
                    "message": {
                        "content": " Refined response. ",
                    }
                }
            ]
        }
        provider = LiquidResponseProvider()

        self.assertEqual(
            provider.respond("Hello", INSTRUCTIONS),
            "Refined response.",
        )
        self.assertEqual(
            provider.respond("Again", INSTRUCTIONS),
            "Refined response.",
        )

        download.assert_called_once_with(
            repo_id="LiquidAI/LFM2.5-1.2B-Instruct-GGUF",
            filename="LFM2.5-1.2B-Instruct-Q4_K_M.gguf",
        )
        llama.assert_called_once_with(
            model_path="model.gguf",
            n_ctx=4_096,
            n_gpu_layers=-1,
            verbose=False,
        )
        self.assertEqual(model.create_chat_completion.call_count, 2)
        first_call = model.create_chat_completion.call_args_list[0]
        self.assertEqual(
            first_call.kwargs["messages"],
            [
                {
                    "role": "system",
                    "content": INSTRUCTIONS,
                },
                {
                    "role": "user",
                    "content": "Input text:\nHello\n\nOutput text:",
                },
            ],
        )
        self.assertEqual(first_call.kwargs["temperature"], 0.1)
        self.assertEqual(first_call.kwargs["top_k"], 50)
        self.assertEqual(first_call.kwargs["repeat_penalty"], 1.05)
        self.assertEqual(first_call.kwargs["max_tokens"], 512)
        self.assertEqual(first_call.kwargs["seed"], 42)

    def test_liquid_response_requires_message_content(self) -> None:
        self.assertEqual(_parse_liquid_response({"choices": []}), "")
        self.assertEqual(
            _parse_liquid_response(
                {
                    "choices": [
                        {
                            "message": {
                                "content": " Liquid response. ",
                            }
                        }
                    ]
                }
            ),
            "Liquid response.",
        )

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
            get_response_provider("liquid"),
            LiquidResponseProvider,
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


if __name__ == "__main__":
    unittest.main()
