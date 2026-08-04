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
    ResponseCancelled,
    _run_lfm_worker,
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


class FakeConnection:
    def __init__(self, responses=()) -> None:
        self.responses = list(responses)
        self.sent = []
        self.closed = False

    def poll(self, timeout) -> bool:
        return bool(self.responses)

    def recv(self):
        return self.responses.pop(0)

    def send(self, value) -> None:
        self.sent.append(value)

    def close(self) -> None:
        self.closed = True


class FakeProcess:
    def __init__(self) -> None:
        self.started = False
        self.alive = False
        self.terminated = False

    def start(self) -> None:
        self.started = True
        self.alive = True

    def is_alive(self) -> bool:
        return self.alive

    def terminate(self) -> None:
        self.terminated = True
        self.alive = False

    def join(self, timeout=None) -> None:
        pass


class FakeProcessContext:
    def __init__(self, responses) -> None:
        self.parent = FakeConnection(responses)
        self.child = FakeConnection()
        self.process = FakeProcess()
        self.process_calls = []

    def Pipe(self):
        return self.parent, self.child

    def Process(self, **kwargs):
        self.process_calls.append(kwargs)
        return self.process


class FakeTimer:
    def __init__(self, interval, function, args=()) -> None:
        self.interval = interval
        self.function = function
        self.args = args
        self.cancelled = False
        self.daemon = False

    def start(self) -> None:
        pass

    def cancel(self) -> None:
        self.cancelled = True

    def fire(self) -> None:
        self.function(*self.args)


class FakeTimerFactory:
    def __init__(self) -> None:
        self.timers = []

    def __call__(self, interval, function, args=()):
        timer = FakeTimer(interval, function, args)
        self.timers.append(timer)
        return timer


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

    def test_lfm_reuses_its_worker(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model_path = Path(directory) / "model.gguf"
            model_path.touch()
            context = FakeProcessContext(
                [
                    ("ready", None),
                    ("result", {"choices": [{"text": "First."}]}),
                    ("result", {"choices": [{"text": "Second."}]}),
                ]
            )
            provider = LFMTranscriptionResponseProvider(
                model_path,
                process_context=context,
            )

            first = provider.respond(
                "um raw transcript",
                "Instructions that must not reach the model.",
            )
            second = provider.respond("second raw transcript", "Ignored again.")
            provider.close()

        self.assertEqual(first, "First.")
        self.assertEqual(second, "Second.")
        self.assertEqual(len(context.process_calls), 1)
        self.assertEqual(
            context.parent.sent[:2],
            [
                ("generate", "um raw transcript"),
                ("generate", "second raw transcript"),
            ],
        )

    @patch("resonance_backend.response_providers.Llama")
    def test_lfm_worker_uses_raw_completion(self, llama) -> None:
        connection = FakeConnection(
            [("generate", "raw transcript"), ("stop", None)]
        )
        llama.return_value.return_value = {
            "choices": [{"text": "Formatted transcript."}]
        }

        _run_lfm_worker(connection, "model.gguf")

        llama.assert_called_once_with(
            model_path="model.gguf",
            n_ctx=32_768,
            n_gpu_layers=-1,
            verbose=False,
        )
        llama.return_value.assert_called_once_with(
            "raw transcript",
            max_tokens=None,
        )
        self.assertEqual(
            connection.sent,
            [
                ("ready", None),
                (
                    "result",
                    {"choices": [{"text": "Formatted transcript."}]},
                ),
            ],
        )

    def test_lfm_is_unavailable_without_its_model(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            provider = LFMTranscriptionResponseProvider(
                Path(directory) / "missing.gguf"
            )

            self.assertFalse(provider.is_available())
            with self.assertRaisesRegex(RuntimeError, "model was not found"):
                provider.respond("raw transcript", "Ignored")

    def test_lfm_rejects_an_empty_completion(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model_path = Path(directory) / "model.gguf"
            model_path.touch()
            context = FakeProcessContext(
                [("ready", None), ("result", {"choices": [{"text": "  "}]})]
            )
            provider = LFMTranscriptionResponseProvider(
                model_path,
                process_context=context,
            )

            with self.assertRaisesRegex(RuntimeError, "empty response"):
                provider.respond("raw transcript", "Ignored")
            provider.close()

    def test_lfm_timeout_terminates_the_worker(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model_path = Path(directory) / "model.gguf"
            model_path.touch()
            context = FakeProcessContext([("ready", None)])
            provider = LFMTranscriptionResponseProvider(
                model_path,
                process_context=context,
            )

            with self.assertRaisesRegex(RuntimeError, "deadline"):
                provider.respond("raw transcript", "Ignored", timeout_seconds=1)

        self.assertTrue(context.process.terminated)
        self.assertIsNone(provider._process)

    def test_lfm_deadline_includes_waiting_for_the_provider_lock(self) -> None:
        provider = LFMTranscriptionResponseProvider(Path("unused.gguf"))
        provider._lock.acquire()
        try:
            with self.assertRaisesRegex(RuntimeError, "deadline"):
                provider.respond(
                    "raw transcript",
                    "Ignored",
                    timeout_seconds=0.01,
                )
        finally:
            provider._lock.release()

    def test_lfm_worker_unloads_after_its_idle_timeout(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model_path = Path(directory) / "model.gguf"
            model_path.touch()
            context = FakeProcessContext(
                [("ready", None), ("result", {"choices": [{"text": "Done."}]})]
            )
            timers = FakeTimerFactory()
            provider = LFMTranscriptionResponseProvider(
                model_path,
                process_context=context,
                idle_timeout_seconds=30,
                timer_factory=timers,
            )

            self.assertEqual(provider.respond("raw transcript", "Ignored"), "Done.")
            self.assertEqual(timers.timers[0].interval, 30)
            self.assertTrue(timers.timers[0].daemon)

            timers.timers[0].fire()

        self.assertTrue(context.process.terminated)
        self.assertIsNone(provider._process)

    def test_lfm_activity_invalidates_an_older_idle_timer(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model_path = Path(directory) / "model.gguf"
            model_path.touch()
            context = FakeProcessContext(
                [
                    ("ready", None),
                    ("result", {"choices": [{"text": "First."}]}),
                    ("result", {"choices": [{"text": "Second."}]}),
                ]
            )
            timers = FakeTimerFactory()
            provider = LFMTranscriptionResponseProvider(
                model_path,
                process_context=context,
                timer_factory=timers,
            )

            provider.respond("first", "Ignored")
            provider.respond("second", "Ignored")
            timers.timers[0].fire()
            self.assertIs(provider._process, context.process)

            timers.timers[1].fire()

        self.assertTrue(context.process.terminated)

    def test_lfm_cancellation_terminates_active_generation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model_path = Path(directory) / "model.gguf"
            model_path.touch()
            context = FakeProcessContext([("ready", None)])
            provider = LFMTranscriptionResponseProvider(
                model_path,
                process_context=context,
            )
            checks = 0

            def cancelled() -> bool:
                nonlocal checks
                checks += 1
                return checks >= 3

            with self.assertRaisesRegex(ResponseCancelled, "cancelled"):
                provider.respond(
                    "raw transcript",
                    "Ignored",
                    cancelled=cancelled,
                )

        self.assertTrue(context.process.terminated)
        self.assertIsNone(provider._process)

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
