import json
import os
import tempfile
from pathlib import Path


DEFAULT_PROVIDER = "opencode"
CONFIG_PATH = Path(
    os.environ.get(
        "RESONANCE_CONFIG_PATH",
        Path(__file__).resolve().parents[1] / "config.json",
    )
)


def load_provider(path: Path = CONFIG_PATH) -> str:
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return DEFAULT_PROVIDER
    except (json.JSONDecodeError, OSError) as error:
        raise RuntimeError(f"Could not read provider config at {path}.") from error

    provider = config.get("provider") if isinstance(config, dict) else None
    if not isinstance(provider, str):
        raise RuntimeError(f"Provider config at {path} is invalid.")
    return provider


def save_provider(provider: str, path: Path = CONFIG_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None

    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            delete=False,
        ) as temporary_file:
            json.dump({"provider": provider}, temporary_file, indent=2)
            temporary_file.write("\n")
            temporary_path = Path(temporary_file.name)

        os.replace(temporary_path, path)
    except OSError as error:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
        raise RuntimeError(f"Could not save provider config at {path}.") from error
