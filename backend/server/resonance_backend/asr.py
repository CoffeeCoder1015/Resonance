import gc
from threading import Lock
from typing import Any, Callable, Protocol, TypedDict

import torch
from transformers import pipeline


try:
    from faster_whisper import WhisperModel as _FasterWhisperModel
except ImportError:
    _FasterWhisperModel = None


class AudioInput(TypedDict):
    array: object
    sampling_rate: int


class ASRCancelled(Exception):
    """Raised when an active transcription no longer owns its request."""


class ASRProvider(Protocol):
    id: str
    label: str

    def load(self) -> None: ...

    def unload(self) -> None: ...

    def transcribe(
        self,
        audio: AudioInput,
        cancelled: Callable[[], bool] | None = None,
    ) -> str: ...


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

    def transcribe(
        self,
        audio: AudioInput,
        cancelled: Callable[[], bool] | None = None,
    ) -> str:
        with self._lock:
            _raise_if_cancelled(cancelled)
            if self._pipeline is None:
                raise RuntimeError("Whisper ASR is not loaded.")
            with torch.inference_mode():
                result = self._pipeline(audio, return_timestamps=True)
            _raise_if_cancelled(cancelled)

        text = result.get("text") if isinstance(result, dict) else None
        if not isinstance(text, str):
            raise RuntimeError("ASR pipeline returned an invalid result.")

        return text.strip()


class FasterWhisperASR:
    id = "faster-whisper"
    label = "Faster Whisper"

    def __init__(
        self,
        model: str = "small.en",
        device: str = "cpu",
        compute_type: str = "int8",
        cpu_threads: int = 0,
        beam_size: int = 1,
    ) -> None:
        self._model = model
        self._device = device
        self._compute_type = compute_type
        self._cpu_threads = cpu_threads
        self._beam_size = beam_size
        self._whisper_model: Any | None = None
        self._lock = Lock()

    def load(self) -> None:
        with self._lock:
            if self._whisper_model is None:
                if _FasterWhisperModel is None:
                    raise RuntimeError("faster-whisper is not installed.")
                self._whisper_model = _FasterWhisperModel(
                    self._model,
                    device=self._device,
                    compute_type=self._compute_type,
                    cpu_threads=self._cpu_threads,
                )

    def unload(self) -> None:
        with self._lock:
            self._whisper_model = None
        _release_model_memory()

    def transcribe(
        self,
        audio: AudioInput,
        cancelled: Callable[[], bool] | None = None,
    ) -> str:
        with self._lock:
            _raise_if_cancelled(cancelled)
            if self._whisper_model is None:
                raise RuntimeError("Faster Whisper ASR is not loaded.")
            segments, _ = self._whisper_model.transcribe(
                audio["array"],
                beam_size=self._beam_size,
                vad_filter=False,
            )
            text_parts = []
            for segment in segments:
                _raise_if_cancelled(cancelled)
                text_parts.append(segment.text.strip())
            text = " ".join(text_parts).strip()

        return text


def _release_model_memory() -> None:
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def _raise_if_cancelled(cancelled: Callable[[], bool] | None) -> None:
    if cancelled is not None and cancelled():
        raise ASRCancelled("Transcription was cancelled.")
