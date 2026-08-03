import json
import shutil
import subprocess
from pathlib import Path
from threading import Lock
from typing import Protocol

from llama_cpp import Llama

from resonance_backend.provider_ids import (
    AGENT_PROVIDER_IDS,
    TRANSCRIPTION_PROVIDER_IDS,
)

LFM_TRANSCRIPTION_MODEL_PATH = (
    Path(__file__).resolve().parents[2]
    / "model"
    / "LFM2.5-1.2B-Base.Q4_K_M.gguf"
)
LFM_TRANSCRIPTION_CONTEXT_TOKENS = 32_768


class ResponseProvider(Protocol):
    id: str
    label: str

    def is_available(self) -> bool: ...

    def respond(
        self,
        message: str,
        instructions: str,
        timeout_seconds: int = 120,
        mode_id: str = "agent",
    ) -> str: ...


class PassthroughResponseProvider:
    id = "passthrough"
    label = "Passthrough"

    def is_available(self) -> bool:
        return True

    def respond(
        self,
        message: str,
        instructions: str,
        timeout_seconds: int = 120,
        mode_id: str = "agent",
    ) -> str:
        return message


class LFMTranscriptionResponseProvider:
    id = "lfm-transcription"
    label = "LFM 2.5 Transcription"

    def __init__(
        self,
        model_path: Path = LFM_TRANSCRIPTION_MODEL_PATH,
    ) -> None:
        self._model_path = model_path
        self._model: Llama | None = None
        self._lock = Lock()

    def is_available(self) -> bool:
        return self._model_path.is_file()

    def respond(
        self,
        message: str,
        instructions: str,
        timeout_seconds: int = 120,
        mode_id: str = "transcription",
    ) -> str:
        with self._lock:
            if self._model is None:
                if not self.is_available():
                    raise RuntimeError(
                        f"{self.id} model was not found at {self._model_path}."
                    )
                self._model = Llama(
                    model_path=str(self._model_path),
                    n_ctx=LFM_TRANSCRIPTION_CONTEXT_TOKENS,
                )

            result = self._model(
                message,
                max_tokens=None,
            )

        response = _parse_completion_response(result)
        if not response.strip():
            raise RuntimeError(f"{self.id} returned an empty response.")
        return response


class OpenCodeResponseProvider:
    id = "opencode"
    label = "OpenCode"
    command = "opencode"

    def is_available(self) -> bool:
        return shutil.which(self.command) is not None

    def respond(
        self,
        message: str,
        instructions: str,
        timeout_seconds: int = 120,
        mode_id: str = "agent",
    ) -> str:
        executable = _find_executable(self)
        result = _run_cli(
            self,
            [
                executable,
                "run",
                "--format",
                "json",
                _prompt_with_instructions(instructions, message),
            ],
            timeout_seconds,
        )

        if result.returncode != 0:
            detail = (
                _parse_opencode_error(result.stdout)
                or result.stderr.strip()
                or result.stdout.strip()
            )
            _raise_cli_error(self, result.returncode, detail)

        response = _parse_opencode_response(result.stdout)
        return _require_response(self, response)


class AntigravityResponseProvider:
    id = "antigravity"
    label = "Antigravity"
    command = "agy"

    def is_available(self) -> bool:
        return shutil.which(self.command) is not None

    def respond(
        self,
        message: str,
        instructions: str,
        timeout_seconds: int = 120,
        mode_id: str = "agent",
    ) -> str:
        executable = _find_executable(self)
        result = _run_cli(
            self,
            [executable, "-p", _prompt_with_instructions(instructions, message)],
            timeout_seconds,
        )

        if result.returncode != 0:
            detail = result.stderr.strip() or result.stdout.strip()
            _raise_cli_error(self, result.returncode, detail)

        return _require_response(self, result.stdout.strip())


RESPONSE_PROVIDERS: dict[str, ResponseProvider] = {
    provider.id: provider
    for provider in (
        OpenCodeResponseProvider(),
        AntigravityResponseProvider(),
        LFMTranscriptionResponseProvider(),
        PassthroughResponseProvider(),
    )
}

def get_response_provider(provider_id: str) -> ResponseProvider:
    try:
        return RESPONSE_PROVIDERS[provider_id]
    except KeyError as error:
        raise RuntimeError(f"Unknown response provider: {provider_id}") from error


def list_response_providers(
    provider_ids: tuple[str, ...],
) -> list[dict[str, str | bool]]:
    return [
        {
            "id": provider.id,
            "label": provider.label,
            "available": provider.is_available(),
        }
        for provider_id in provider_ids
        for provider in (RESPONSE_PROVIDERS[provider_id],)
    ]


def is_response_provider_available(provider_id: str) -> bool:
    provider = RESPONSE_PROVIDERS.get(provider_id)
    return provider is not None and provider.is_available()


def _find_executable(
    provider: OpenCodeResponseProvider | AntigravityResponseProvider,
) -> str:
    executable = shutil.which(provider.command)
    if executable is None:
        raise RuntimeError(f"{provider.id} CLI is not installed.")
    return executable


def _run_cli(
    provider: ResponseProvider,
    command: list[str],
    timeout_seconds: int,
) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            capture_output=True,
            check=False,
            encoding="utf-8",
            errors="replace",
            text=True,
            timeout=timeout_seconds,
        )
    except FileNotFoundError as error:
        raise RuntimeError(f"{provider.id} CLI could not be started.") from error
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(
            f"{provider.id} did not respond within {timeout_seconds} seconds."
        ) from error


def _raise_cli_error(
    provider: ResponseProvider,
    returncode: int,
    detail: str,
) -> None:
    if detail:
        raise RuntimeError(f"{provider.id} failed: {detail[-500:]}")
    raise RuntimeError(f"{provider.id} failed with exit code {returncode}.")


def _require_response(
    provider: ResponseProvider,
    response: str,
) -> str:
    if not response:
        raise RuntimeError(f"{provider.id} returned an empty response.")
    return response


def _prompt_with_instructions(instructions: str, message: str) -> str:
    return (
        f"[Resonance instructions]\n{instructions.strip()}\n\n"
        f"[User message]\n{message.strip()}"
    )


def _parse_completion_response(result: object) -> str:
    if not isinstance(result, dict):
        return ""

    choices = result.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""

    choice = choices[0]
    if not isinstance(choice, dict):
        return ""

    text = choice.get("text")
    return text if isinstance(text, str) else ""


def _parse_opencode_response(output: str) -> str:
    text_parts = []
    for line in output.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue

        if event.get("type") != "text":
            continue
        part = event.get("part")
        if isinstance(part, dict) and isinstance(part.get("text"), str):
            text = part["text"].strip()
            if text:
                text_parts.append(text)

    return text_parts[-1] if text_parts else ""


def _parse_opencode_error(output: str) -> str:
    for line in output.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue

        if event.get("type") != "error":
            continue
        error = event.get("error")
        if not isinstance(error, dict):
            continue
        data = error.get("data")
        if isinstance(data, dict) and isinstance(data.get("message"), str):
            return data["message"].strip()
        if isinstance(error.get("message"), str):
            return error["message"].strip()

    return ""
