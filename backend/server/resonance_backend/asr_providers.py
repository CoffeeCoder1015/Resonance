from threading import Lock

from resonance_backend.asr import ASRProvider, AudioInput, WhisperASR


ASR_PROVIDERS: dict[str, ASRProvider] = {
    provider.id: provider
    for provider in (WhisperASR(model="openai/whisper-base.en"),)
}


def list_asr_providers() -> list[dict[str, str]]:
    return [
        {
            "id": provider.id,
            "label": provider.label,
        }
        for provider in ASR_PROVIDERS.values()
    ]


class ASRRuntime:
    def __init__(self, providers: dict[str, ASRProvider]) -> None:
        self._providers = providers
        self._current: ASRProvider | None = None
        self._lock = Lock()

    @property
    def current_id(self) -> str:
        with self._lock:
            if self._current is None:
                raise RuntimeError("No ASR provider is loaded.")
            return self._current.id

    def load(self, provider_id: str) -> None:
        with self._lock:
            provider = self._get_provider(provider_id)
            if self._current is provider:
                provider.load()
                return
            if self._current is not None:
                raise RuntimeError("An ASR provider is already loaded.")

            provider.load()
            self._current = provider

    def unload(self) -> None:
        with self._lock:
            if self._current is None:
                return
            self._current.unload()
            self._current = None

    def select(self, provider_id: str) -> None:
        with self._lock:
            selected = self._get_provider(provider_id)
            previous = self._current
            if selected is previous:
                return

            if previous is not None:
                previous.unload()
                self._current = None

            try:
                selected.load()
            except Exception:
                if previous is not None:
                    try:
                        previous.load()
                    except Exception as restoration_error:
                        raise RuntimeError(
                            f"{selected.id} failed to load and {previous.id} "
                            "could not be restored."
                        ) from restoration_error
                    self._current = previous
                raise

            self._current = selected

    def transcribe(self, audio: AudioInput) -> str:
        with self._lock:
            if self._current is None:
                raise RuntimeError("No ASR provider is loaded.")
            return self._current.transcribe(audio)

    def _get_provider(self, provider_id: str) -> ASRProvider:
        try:
            return self._providers[provider_id]
        except KeyError as error:
            raise RuntimeError(f"Unknown ASR provider: {provider_id}") from error


asr_runtime = ASRRuntime(ASR_PROVIDERS)
