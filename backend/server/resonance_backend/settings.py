import json
import os
import tempfile
from pathlib import Path
from threading import Lock

from resonance_backend.provider_ids import (
    AGENT_PROVIDER_IDS,
    TRANSCRIPTION_PROVIDER_IDS,
)

DEFAULT_AGENT_PROVIDER = "opencode"
DEFAULT_TRANSCRIPTION_PROVIDER = "lfm-transcription"
DEFAULT_ASR_PROVIDER = "whisper"
CONFIG_PATH = Path(
    os.environ.get(
        "RESONANCE_CONFIG_PATH",
        Path(__file__).resolve().parents[1] / "config.json",
    )
)
CONFIG_LOCK = Lock()


def load_settings(path: Path = CONFIG_PATH) -> dict[str, str]:
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {
            "agent_provider": DEFAULT_AGENT_PROVIDER,
            "transcription_provider": DEFAULT_TRANSCRIPTION_PROVIDER,
            "asr_provider": DEFAULT_ASR_PROVIDER,
        }
    except (json.JSONDecodeError, OSError) as error:
        raise RuntimeError(f"Could not read config at {path}.") from error

    if not isinstance(config, dict):
        raise RuntimeError(f"Config at {path} is invalid.")

    legacy_provider = config.get("response_provider", config.get("provider"))
    agent_provider = config.get(
        "agent_provider",
        legacy_provider if legacy_provider in AGENT_PROVIDER_IDS else DEFAULT_AGENT_PROVIDER,
    )
    transcription_provider = config.get(
        "transcription_provider",
        (
            legacy_provider
            if legacy_provider in TRANSCRIPTION_PROVIDER_IDS
            else DEFAULT_TRANSCRIPTION_PROVIDER
        ),
    )
    asr_provider = config.get("asr_provider", DEFAULT_ASR_PROVIDER)
    if (
        not isinstance(agent_provider, str)
        or not isinstance(transcription_provider, str)
        or not isinstance(asr_provider, str)
        or agent_provider not in AGENT_PROVIDER_IDS
        or transcription_provider not in TRANSCRIPTION_PROVIDER_IDS
    ):
        raise RuntimeError(f"Config at {path} is invalid.")

    return {
        "agent_provider": agent_provider,
        "transcription_provider": transcription_provider,
        "asr_provider": asr_provider,
    }


def _save_config(config: dict[str, str], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None

    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            delete=False,
        ) as temporary_file:
            json.dump(config, temporary_file, indent=2)
            temporary_file.write("\n")
            temporary_path = Path(temporary_file.name)

        os.replace(temporary_path, path)
    except OSError as error:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
        raise RuntimeError(f"Could not save config at {path}.") from error


def load_agent_provider(path: Path = CONFIG_PATH) -> str:
    return load_settings(path)["agent_provider"]


def save_agent_provider(provider: str, path: Path = CONFIG_PATH) -> None:
    with CONFIG_LOCK:
        config = load_settings(path)
        config["agent_provider"] = provider
        _save_config(config, path)


def load_transcription_provider(path: Path = CONFIG_PATH) -> str:
    return load_settings(path)["transcription_provider"]


def save_transcription_provider(provider: str, path: Path = CONFIG_PATH) -> None:
    with CONFIG_LOCK:
        config = load_settings(path)
        config["transcription_provider"] = provider
        _save_config(config, path)


def load_asr_provider(path: Path = CONFIG_PATH) -> str:
    return load_settings(path)["asr_provider"]


def save_asr_provider(provider: str, path: Path = CONFIG_PATH) -> None:
    with CONFIG_LOCK:
        config = load_settings(path)
        config["asr_provider"] = provider
        _save_config(config, path)
