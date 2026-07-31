import json
import os
import tempfile
from pathlib import Path
from threading import Lock


DEFAULT_RESPONSE_PROVIDER = "opencode"
DEFAULT_ASR_PROVIDER = "whisper"
DEFAULT_MODE = "voice"
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
            "response_provider": DEFAULT_RESPONSE_PROVIDER,
            "asr_provider": DEFAULT_ASR_PROVIDER,
            "mode": DEFAULT_MODE,
        }
    except (json.JSONDecodeError, OSError) as error:
        raise RuntimeError(f"Could not read config at {path}.") from error

    if not isinstance(config, dict):
        raise RuntimeError(f"Config at {path} is invalid.")

    response_provider = config.get(
        "response_provider",
        config.get("provider", DEFAULT_RESPONSE_PROVIDER),
    )
    asr_provider = config.get("asr_provider", DEFAULT_ASR_PROVIDER)
    mode = config.get("mode", DEFAULT_MODE)
    if (
        not isinstance(response_provider, str)
        or not isinstance(asr_provider, str)
        or not isinstance(mode, str)
    ):
        raise RuntimeError(f"Config at {path} is invalid.")

    return {
        "response_provider": response_provider,
        "asr_provider": asr_provider,
        "mode": mode,
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


def load_response_provider(path: Path = CONFIG_PATH) -> str:
    return load_settings(path)["response_provider"]


def save_response_provider(provider: str, path: Path = CONFIG_PATH) -> None:
    with CONFIG_LOCK:
        config = load_settings(path)
        config["response_provider"] = provider
        _save_config(config, path)


def load_asr_provider(path: Path = CONFIG_PATH) -> str:
    return load_settings(path)["asr_provider"]


def save_asr_provider(provider: str, path: Path = CONFIG_PATH) -> None:
    with CONFIG_LOCK:
        config = load_settings(path)
        config["asr_provider"] = provider
        _save_config(config, path)


def load_mode(path: Path = CONFIG_PATH) -> str:
    return load_settings(path)["mode"]


def save_mode(mode: str, path: Path = CONFIG_PATH) -> None:
    with CONFIG_LOCK:
        config = load_settings(path)
        config["mode"] = mode
        _save_config(config, path)
