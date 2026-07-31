import json
import shutil
import subprocess
from threading import Lock
from typing import Protocol

from huggingface_hub import hf_hub_download
from llama_cpp import Llama


LIQUID_REPO_ID = "LiquidAI/LFM2.5-1.2B-Instruct-GGUF"
LIQUID_FILENAME = "LFM2.5-1.2B-Instruct-Q4_K_M.gguf"


class ResponseProvider(Protocol):
    id: str
    label: str

    def is_available(self) -> bool: ...

    def respond(
        self,
        message: str,
        instructions: str,
        timeout_seconds: int = 120,
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
    ) -> str:
        return message


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


class LiquidResponseProvider:
    id = "liquid"
    label = "Liquid"

    def __init__(self) -> None:
        self._model: Llama | None = None
        self._lock = Lock()

    def is_available(self) -> bool:
        return True

    def respond(
        self,
        message: str,
        instructions: str,
        timeout_seconds: int = 120,
    ) -> str:
        with self._lock:
            if self._model is None:
                model_path = hf_hub_download(
                    repo_id=LIQUID_REPO_ID,
                    filename=LIQUID_FILENAME,
                )
                self._model = Llama(
                    model_path=model_path,
                    n_ctx=4_096,
                    n_gpu_layers=-1,
                    verbose=False,
                )

            result = self._model.create_chat_completion(
                messages=[
                    {
                        "role": "system",
                        "content": instructions.strip(),
                    },
                    {
                        "role": "user",
                        "content": _liquid_input_prompt(message),
                    },
                ],
                temperature=0.1,
                top_k=50,
                repeat_penalty=1.05,
                max_tokens=512,
                seed=42,
            )

        return _require_response(self, _parse_liquid_response(result))


RESPONSE_PROVIDERS: dict[str, ResponseProvider] = {
    provider.id: provider
    for provider in (
        OpenCodeResponseProvider(),
        AntigravityResponseProvider(),
        LiquidResponseProvider(),
        PassthroughResponseProvider(),
    )
}


def get_response_provider(provider_id: str) -> ResponseProvider:
    try:
        return RESPONSE_PROVIDERS[provider_id]
    except KeyError as error:
        raise RuntimeError(f"Unknown response provider: {provider_id}") from error


def list_response_providers() -> list[dict[str, str | bool]]:
    return [
        {
            "id": provider.id,
            "label": provider.label,
            "available": provider.is_available(),
        }
        for provider in RESPONSE_PROVIDERS.values()
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


def _liquid_input_prompt(message: str) -> str:
    return f"Input text:\n{message.strip()}\n\nOutput text:"


def _parse_liquid_response(result: object) -> str:
    if not isinstance(result, dict):
        return ""

    choices = result.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""

    choice = choices[0]
    if not isinstance(choice, dict):
        return ""

    response = choice.get("message")
    if not isinstance(response, dict):
        return ""

    content = response.get("content")
    return content.strip() if isinstance(content, str) else ""


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
