import gc
from threading import Lock
from typing import Any, Protocol, TypedDict

import torch
from transformers import pipeline


class AudioInput(TypedDict):
    array: object
    sampling_rate: int


class ASRProvider(Protocol):
    id: str
    label: str

    def load(self) -> None: ...

    def unload(self) -> None: ...

    def transcribe(self, audio: AudioInput) -> str: ...


class WhisperASR:
    id = "whisper"
    label = "Whisper"

    def __init__(self, model: str, device: int = -1) -> None:
        self._model = model
        self._device = device
        self._pipeline: Any | None = None
        self._lock = Lock()

    def load(self) -> None:
        with self._lock:
            if self._pipeline is None:
                self._pipeline = pipeline(
                    task="automatic-speech-recognition",
                    model=self._model,
                    device=self._device,
                )

    def unload(self) -> None:
        with self._lock:
            self._pipeline = None
        _release_model_memory()

    def transcribe(self, audio: AudioInput) -> str:
        with self._lock:
            if self._pipeline is None:
                raise RuntimeError("Whisper ASR is not loaded.")
            with torch.inference_mode():
                result = self._pipeline(audio, return_timestamps=True)

        text = result.get("text") if isinstance(result, dict) else None
        if not isinstance(text, str):
            raise RuntimeError("ASR pipeline returned an invalid result.")

        return text.strip()


def _release_model_memory() -> None:
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
