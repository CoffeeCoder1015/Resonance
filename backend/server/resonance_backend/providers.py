import json
import shutil
import subprocess


PROVIDERS = {
    "opencode": {
        "label": "OpenCode",
        "command": "opencode",
    },
    "antigravity": {
        "label": "Antigravity",
        "command": "agy",
    },
}


def list_providers() -> list[dict[str, str | bool]]:
    return [
        {
            "id": provider_id,
            "label": provider["label"],
            "available": shutil.which(provider["command"]) is not None,
        }
        for provider_id, provider in PROVIDERS.items()
    ]


def is_provider_available(provider_id: str) -> bool:
    provider = PROVIDERS.get(provider_id)
    return provider is not None and shutil.which(provider["command"]) is not None


def run_agent(provider_id: str, prompt: str, timeout_seconds: int = 120) -> str:
    provider = PROVIDERS.get(provider_id)
    if provider is None:
        raise RuntimeError(f"Unknown provider: {provider_id}")

    executable = shutil.which(provider["command"])
    if executable is None:
        raise RuntimeError(f"{provider_id} CLI is not installed.")

    if provider_id == "opencode":
        command = [executable, "run", "--format", "json", prompt]
    else:
        command = [executable, "-p", prompt]

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            check=False,
            encoding="utf-8",
            errors="replace",
            text=True,
            timeout=timeout_seconds,
        )
    except FileNotFoundError as error:
        raise RuntimeError(f"{provider_id} CLI could not be started.") from error
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(
            f"{provider_id} did not respond within {timeout_seconds} seconds."
        ) from error

    if result.returncode != 0:
        detail = (
            _parse_opencode_error(result.stdout)
            if provider_id == "opencode"
            else ""
        )
        detail = detail or result.stderr.strip() or result.stdout.strip()
        if detail:
            raise RuntimeError(f"{provider_id} failed: {detail[-500:]}")
        raise RuntimeError(f"{provider_id} failed with exit code {result.returncode}.")

    if provider_id == "opencode":
        response = _parse_opencode_response(result.stdout)
    else:
        response = result.stdout.strip()

    if not response:
        raise RuntimeError(f"{provider_id} returned an empty response.")
    return response


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
