import multiprocessing
import time
from pathlib import Path
from threading import Lock, Timer
from typing import Any, Callable, Protocol

from llama_cpp import Llama

from resonance_backend.provider_ids import TRANSCRIPTION_PROVIDER_IDS

LFM_TRANSCRIPTION_MODEL_PATH = (
    Path(__file__).resolve().parents[2]
    / "model"
    / "LFM2.5-1.2B-Base.Q4_K_M.gguf"
)
LFM_TRANSCRIPTION_CONTEXT_TOKENS = 32_768
LFM_TRANSCRIPTION_IDLE_TIMEOUT_SECONDS = 5 * 60


def _run_lfm_worker(connection: Any, model_path: str) -> None:
    """Own llama.cpp in a disposable process so native failures stay isolated."""
    try:
        model = Llama(
            model_path=model_path,
            n_ctx=LFM_TRANSCRIPTION_CONTEXT_TOKENS,
            n_gpu_layers=-1,
            verbose=False,
        )
        connection.send(("ready", None))
        while True:
            command, payload = connection.recv()
            if command == "stop":
                return
            if command != "generate":
                raise RuntimeError(f"Unknown LFM worker command: {command}")
            connection.send(("result", model(payload, max_tokens=None)))
    except BaseException as error:
        try:
            connection.send(("error", f"{type(error).__name__}: {error}"))
        except (BrokenPipeError, EOFError, OSError):
            pass
    finally:
        connection.close()


class ResponseProvider(Protocol):
    id: str
    label: str

    def is_available(self) -> bool: ...

    def respond(
        self,
        message: str,
        instructions: str,
        timeout_seconds: int = 120,
        mode_id: str = "transcription",
        cancelled: Callable[[], bool] | None = None,
    ) -> str: ...


class ResponseCancelled(Exception):
    """Raised when the caller cancels an in-flight provider response."""


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
        mode_id: str = "transcription",
        cancelled: Callable[[], bool] | None = None,
    ) -> str:
        _raise_if_cancelled(cancelled)
        return message


class LFMTranscriptionResponseProvider:
    id = "lfm-transcription"
    label = "LFM 2.5 Transcription"

    def __init__(
        self,
        model_path: Path = LFM_TRANSCRIPTION_MODEL_PATH,
        *,
        process_context: Any | None = None,
        idle_timeout_seconds: float = LFM_TRANSCRIPTION_IDLE_TIMEOUT_SECONDS,
        timer_factory: Any = Timer,
    ) -> None:
        self._model_path = model_path
        self._process_context = process_context or multiprocessing.get_context("spawn")
        self._idle_timeout_seconds = idle_timeout_seconds
        self._timer_factory = timer_factory
        self._process: Any | None = None
        self._connection: Any | None = None
        self._idle_timer: Any | None = None
        self._idle_generation = 0
        self._lock = Lock()

    def is_available(self) -> bool:
        return self._model_path.is_file()

    def respond(
        self,
        message: str,
        instructions: str,
        timeout_seconds: int = 120,
        mode_id: str = "transcription",
        cancelled: Callable[[], bool] | None = None,
    ) -> str:
        deadline = time.monotonic() + timeout_seconds
        while not self._lock.acquire(timeout=min(0.1, max(0, deadline - time.monotonic()))):
            _raise_if_cancelled(cancelled)
            if time.monotonic() >= deadline:
                raise RuntimeError(f"{self.id} did not respond before its deadline.")
        try:
            _raise_if_cancelled(cancelled)
            self._cancel_idle_shutdown()
            self._ensure_worker(deadline, cancelled)
            try:
                self._connection.send(("generate", message))
                status, result = self._receive(deadline, cancelled)
            except (BrokenPipeError, EOFError, OSError) as error:
                self._discard_worker()
                raise RuntimeError(f"{self.id} worker crashed.") from error

            if status == "error":
                self._discard_worker()
                raise RuntimeError(f"{self.id} failed: {result}")
            if status != "result":
                self._discard_worker()
                raise RuntimeError(f"{self.id} worker returned an invalid response.")
            self._schedule_idle_shutdown()
        finally:
            self._lock.release()

        response = _parse_completion_response(result)
        if not response.strip():
            raise RuntimeError(f"{self.id} returned an empty response.")
        return response

    def close(self) -> None:
        with self._lock:
            self._cancel_idle_shutdown()
            connection = self._connection
            process = self._process
            self._connection = None
            self._process = None
            if connection is not None:
                try:
                    if process is not None and process.is_alive():
                        connection.send(("stop", None))
                except (BrokenPipeError, EOFError, OSError):
                    pass
                connection.close()
            if process is not None:
                process.join(timeout=2)
                if process.is_alive():
                    process.terminate()
                    process.join(timeout=2)

    def _cancel_idle_shutdown(self) -> None:
        self._idle_generation += 1
        timer = self._idle_timer
        self._idle_timer = None
        if timer is not None:
            timer.cancel()

    def _schedule_idle_shutdown(self) -> None:
        self._cancel_idle_shutdown()
        generation = self._idle_generation
        timer = self._timer_factory(
            self._idle_timeout_seconds,
            self._unload_if_still_idle,
            args=(generation,),
        )
        timer.daemon = True
        self._idle_timer = timer
        timer.start()

    def _unload_if_still_idle(self, generation: int) -> None:
        with self._lock:
            if generation != self._idle_generation:
                return
            self._idle_timer = None
            self._idle_generation += 1
            self._discard_worker()

    def _ensure_worker(
        self,
        deadline: float,
        cancelled: Callable[[], bool] | None = None,
    ) -> None:
        if (
            self._process is not None
            and self._connection is not None
            and self._process.is_alive()
        ):
            return

        self._discard_worker()
        if not self.is_available():
            raise RuntimeError(f"{self.id} model was not found at {self._model_path}.")

        parent_connection, child_connection = self._process_context.Pipe()
        process = self._process_context.Process(
            target=_run_lfm_worker,
            args=(child_connection, str(self._model_path)),
            name="resonance-lfm-transcription",
            daemon=True,
        )
        self._connection = parent_connection
        self._process = process
        process.start()
        child_connection.close()

        try:
            status, detail = self._receive(deadline, cancelled)
        except (BrokenPipeError, EOFError, OSError) as error:
            self._discard_worker()
            raise RuntimeError(f"{self.id} worker crashed during startup.") from error
        if status != "ready":
            self._discard_worker()
            if status == "error":
                raise RuntimeError(f"{self.id} failed to start: {detail}")
            raise RuntimeError(f"{self.id} worker returned an invalid startup response.")

    def _receive(
        self,
        deadline: float,
        cancelled: Callable[[], bool] | None = None,
    ) -> tuple[str, object]:
        while True:
            _raise_if_cancelled(cancelled, self._discard_worker)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                self._discard_worker()
                raise RuntimeError(f"{self.id} did not respond before its deadline.")
            if self._connection.poll(min(0.1, remaining)):
                break
        response = self._connection.recv()
        if not isinstance(response, tuple) or len(response) != 2:
            return "invalid", response
        return response

    def _discard_worker(self) -> None:
        connection = self._connection
        process = self._process
        self._connection = None
        self._process = None
        if connection is not None:
            connection.close()
        if process is not None:
            if process.is_alive():
                process.terminate()
            process.join(timeout=2)


RESPONSE_PROVIDERS: dict[str, ResponseProvider] = {
    provider.id: provider
    for provider in (
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


def close_response_providers() -> None:
    for provider in RESPONSE_PROVIDERS.values():
        close = getattr(provider, "close", None)
        if callable(close):
            close()


def _raise_if_cancelled(
    cancelled: Callable[[], bool] | None,
    cleanup: Callable[[], None] | None = None,
) -> None:
    if cancelled is not None and cancelled():
        if cleanup is not None:
            cleanup()
        raise ResponseCancelled("Response processing was cancelled.")


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
