import subprocess
import unittest
from unittest.mock import patch

from resonance_backend.providers import (
    _parse_opencode_error,
    _parse_opencode_response,
    run_agent,
)


class ProviderTests(unittest.TestCase):
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

    @patch("resonance_backend.providers.subprocess.run")
    def test_opencode_uses_its_default_model(self, run_mock) -> None:
        run_mock.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout='{"type":"text","part":{"text":"Agent response"}}\n',
            stderr="",
        )

        with patch("resonance_backend.providers.shutil.which", return_value="opencode"):
            self.assertEqual(run_agent("opencode", "Hello"), "Agent response")

        command = run_mock.call_args.args[0]
        self.assertEqual(command, ["opencode", "run", "--format", "json", "Hello"])
        self.assertNotIn("--model", command)

    @patch("resonance_backend.providers.subprocess.run")
    def test_antigravity_uses_plain_stdout(self, run_mock) -> None:
        run_mock.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="Agent response\n",
            stderr="",
        )

        with patch("resonance_backend.providers.shutil.which", return_value="agy"):
            self.assertEqual(run_agent("antigravity", "Hello"), "Agent response")
        self.assertEqual(run_mock.call_args.args[0], ["agy", "-p", "Hello"])

    @patch("resonance_backend.providers.subprocess.run")
    def test_nonzero_exit_is_reported(self, run_mock) -> None:
        run_mock.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout="",
            stderr="Authentication required",
        )

        with patch("resonance_backend.providers.shutil.which", return_value="opencode"):
            with self.assertRaisesRegex(RuntimeError, "Authentication required"):
                run_agent("opencode", "Hello")


if __name__ == "__main__":
    unittest.main()
