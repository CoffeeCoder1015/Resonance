from contextlib import asynccontextmanager
from threading import Event, Lock
from time import monotonic
from typing import Annotated, Callable, Literal

import soundfile
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from pydantic import BaseModel

from resonance_backend.asr_providers import (
    ASR_PROVIDERS,
    asr_runtime,
    list_asr_providers,
)
from resonance_backend.asr import ASRCancelled
from resonance_backend.modes import MODES, get_mode
from resonance_backend.provider_ids import (
    AGENT_PROVIDER_IDS,
    TRANSCRIPTION_PROVIDER_IDS,
)
from resonance_backend.response_providers import (
    RESPONSE_PROVIDERS,
    ResponseCancelled,
    close_response_providers,
    get_response_provider,
    is_response_provider_available,
    list_response_providers,
)
from resonance_backend.settings import (
    load_asr_provider,
    load_agent_provider,
    load_settings,
    load_transcription_provider,
    save_asr_provider,
    save_agent_provider,
    save_transcription_provider,
)
from resonance_backend.windows_insertion import (
    WindowsIntegrationUnavailable,
    get_foreground_target,
    paste_text_via_clipboard,
)


SAMPLE_RATE = 16_000
MAX_AUDIO_BYTES = 25 * 1024 * 1024
TRANSCRIPTION_CHUNK_SECONDS = 60
TRANSCRIPTION_CHUNK_FRAMES = SAMPLE_RATE * TRANSCRIPTION_CHUNK_SECONDS
MAX_AUDIO_CHANNELS = 2
CANCELLED_JOB_TTL_SECONDS = 10 * 60


class TranscriptionJobRegistry:
    """Tracks only live cancellation signals; it never stores pipeline results."""

    def __init__(self) -> None:
        self._jobs: dict[str, tuple[Event, float]] = {}
        self._lock = Lock()

    def begin(self, job_id: str) -> Event:
        with self._lock:
            self._purge()
            existing = self._jobs.get(job_id)
            if existing is not None:
                return existing[0]
            cancellation = Event()
            self._jobs[job_id] = (cancellation, monotonic())
            return cancellation

    def cancel(self, job_id: str) -> None:
        with self._lock:
            self._purge()
            cancellation, _ = self._jobs.get(job_id, (Event(), monotonic()))
            cancellation.set()
            self._jobs[job_id] = (cancellation, monotonic())

    def finish(self, job_id: str, cancellation: Event) -> None:
        with self._lock:
            current = self._jobs.get(job_id)
            if current is not None and current[0] is cancellation:
                del self._jobs[job_id]

    def _purge(self) -> None:
        cutoff = monotonic() - CANCELLED_JOB_TTL_SECONDS
        for job_id, (cancellation, updated_at) in tuple(self._jobs.items()):
            if cancellation.is_set() and updated_at < cutoff:
                del self._jobs[job_id]


transcription_jobs = TranscriptionJobRegistry()


@asynccontextmanager
async def lifespan(_: FastAPI):
    asr_runtime.load(load_asr_provider())
    try:
        yield
    finally:
        close_response_providers()
        asr_runtime.unload()


app = FastAPI(title="Resonance Backend", lifespan=lifespan)


class ResponseProviderSelection(BaseModel):
    provider: str


class ASRProviderSelection(BaseModel):
    provider: str


class TextPipelineRequest(BaseModel):
    text: str
    mode: Literal["agent", "transcription"]


class WindowsInsertionRequest(BaseModel):
    window_handle: str
    process_id: int
    text: str


def transcribe(
    file: UploadFile,
    cancelled: Callable[[], bool] | None = None,
) -> str:
    try:
        file.file.seek(0, 2)
        upload_size = file.file.tell()
        file.file.seek(0)
    except (AttributeError, OSError, ValueError) as error:
        raise HTTPException(
            status_code=422,
            detail="Audio recording could not be read.",
        ) from error

    if upload_size > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Audio recording is too large.",
        )

    try:
        audio_file = soundfile.SoundFile(file.file)
    except (OSError, RuntimeError, ValueError) as error:
        raise HTTPException(
            status_code=422,
            detail="Audio recording could not be decoded.",
        ) from error

    transcripts: list[str] = []
    with audio_file:
        try:
            if audio_file.frames == 0:
                raise HTTPException(status_code=400, detail="Audio recording is empty.")
            if audio_file.samplerate != SAMPLE_RATE:
                raise HTTPException(
                    status_code=422,
                    detail=f"Audio recording must use a {SAMPLE_RATE} Hz sample rate.",
                )
            if audio_file.channels > MAX_AUDIO_CHANNELS:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Audio recording must have no more than "
                        f"{MAX_AUDIO_CHANNELS} channels."
                    ),
                )
        except (OSError, RuntimeError, ValueError) as error:
            raise HTTPException(
                status_code=422,
                detail="Audio recording could not be decoded.",
            ) from error

        while True:
            _raise_if_cancelled(cancelled)
            try:
                samples = audio_file.read(
                    frames=TRANSCRIPTION_CHUNK_FRAMES,
                    dtype="float32",
                    always_2d=True,
                )
            except (OSError, RuntimeError, ValueError) as error:
                raise HTTPException(
                    status_code=422,
                    detail="Audio recording could not be decoded.",
                ) from error
            if samples.shape[0] == 0:
                break

            transcript = asr_runtime.transcribe(
                {
                    "array": samples.mean(axis=1),
                    "sampling_rate": SAMPLE_RATE,
                },
                cancelled,
            ).strip()
            _raise_if_cancelled(cancelled)
            if transcript:
                transcripts.append(transcript)

    return " ".join(transcripts)


def process_text(
    transcript: str,
    response_provider: str,
    mode_id: str,
    cancelled: Callable[[], bool] | None = None,
) -> dict[str, object]:
    _raise_if_cancelled(cancelled)
    if not transcript:
        raise HTTPException(status_code=422, detail="No speech was detected.")

    if response_provider not in RESPONSE_PROVIDERS:
        raise HTTPException(
            status_code=500,
            detail="The saved response provider is not supported.",
        )
    if mode_id not in MODES:
        raise HTTPException(
            status_code=422,
            detail="The requested pipeline mode is not supported.",
        )
    allowed_provider_ids = (
        AGENT_PROVIDER_IDS if mode_id == "agent" else TRANSCRIPTION_PROVIDER_IDS
    )
    if response_provider not in allowed_provider_ids:
        raise HTTPException(
            status_code=500,
            detail=f"The saved {mode_id} provider is not valid for this pipeline.",
        )

    try:
        mode = get_mode(mode_id)
        output_text = get_response_provider(response_provider).respond(
            message=transcript,
            instructions=mode.instructions,
            mode_id=mode_id,
            cancelled=cancelled,
        )
        _raise_if_cancelled(cancelled)
    except (ASRCancelled, ResponseCancelled) as error:
        raise HTTPException(status_code=409, detail="Transcription was cancelled.") from error
    except Exception as error:
        if mode_id != "transcription":
            raise HTTPException(
                status_code=502,
                detail=f"Response processing failed: {error}",
            ) from error
        return {
            "transcript": transcript,
            "text": transcript,
            "mode": mode_id,
            "downstream": {
                "provider": response_provider,
                "status": "failed",
                "error": str(error),
            },
        }

    return {
        "transcript": transcript,
        "text": output_text,
        "mode": mode_id,
        "downstream": {
            "provider": response_provider,
            "status": "completed",
        },
    }


@app.post("/v1/voice/process")
def process_voice(
    file: Annotated[UploadFile, File()],
    mode: Literal["agent", "transcription"],
    job_id: Annotated[str | None, Header(alias="X-Resonance-Job-Id")] = None,
) -> dict[str, object]:
    settings = load_settings()
    response_provider = settings[f"{mode}_provider"]
    if mode != "transcription" or job_id is None:
        transcript = transcribe(file)
        return process_text(transcript, response_provider, mode)
    if not job_id.strip() or len(job_id) > 128:
        raise HTTPException(status_code=422, detail="Invalid transcription job ID.")

    cancellation = transcription_jobs.begin(job_id)
    try:
        transcript = transcribe(file, cancellation.is_set)
        return process_text(
            transcript,
            response_provider,
            mode,
            cancellation.is_set,
        )
    except ASRCancelled as error:
        raise HTTPException(status_code=409, detail="Transcription was cancelled.") from error
    finally:
        transcription_jobs.finish(job_id, cancellation)


@app.post("/v1/transcriptions/{job_id}/cancel")
def cancel_transcription(job_id: str) -> dict[str, str]:
    if not job_id.strip() or len(job_id) > 128:
        raise HTTPException(status_code=422, detail="Invalid transcription job ID.")
    transcription_jobs.cancel(job_id)
    return {"status": "cancelled"}


@app.post("/v1/audio/transcriptions")
def create_audio_transcription(
    file: Annotated[UploadFile, File()],
) -> dict[str, str]:
    return {"transcript": transcribe(file)}


@app.post("/v1/text/process")
def process_text_request(request: TextPipelineRequest) -> dict[str, object]:
    settings = load_settings()
    return process_text(
        request.text.strip(),
        settings[f"{request.mode}_provider"],
        request.mode,
    )


def _raise_if_cancelled(cancelled: Callable[[], bool] | None) -> None:
    if cancelled is not None and cancelled():
        raise ASRCancelled("Transcription was cancelled.")


@app.get("/v1/windows/foreground-target")
def get_windows_foreground_target() -> dict[str, object]:
    try:
        target = get_foreground_target()
    except WindowsIntegrationUnavailable as error:
        raise HTTPException(status_code=501, detail=str(error)) from error
    return {"target": None if target is None else target.to_dict()}


@app.post("/v1/windows/insert-text")
def insert_windows_text(request: WindowsInsertionRequest) -> dict[str, object]:
    try:
        result = paste_text_via_clipboard(
            request.window_handle,
            request.process_id,
            request.text,
        )
    except WindowsIntegrationUnavailable as error:
        raise HTTPException(status_code=501, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return result.to_dict()


@app.get("/v1/agent/providers")
def get_agent_providers() -> dict[str, object]:
    return {
        "current": load_agent_provider(),
        "providers": list_response_providers(AGENT_PROVIDER_IDS),
    }


@app.put("/v1/agent/providers/current")
def set_agent_provider(
    selection: ResponseProviderSelection,
) -> dict[str, str]:
    if selection.provider not in AGENT_PROVIDER_IDS:
        raise HTTPException(status_code=422, detail="Unknown agent provider.")
    if not is_response_provider_available(selection.provider):
        raise HTTPException(
            status_code=409,
            detail=f"{selection.provider} is unavailable.",
        )

    save_agent_provider(selection.provider)
    return {"provider": selection.provider}


@app.get("/v1/transcription/providers")
def get_transcription_providers() -> dict[str, object]:
    return {
        "current": load_transcription_provider(),
        "providers": list_response_providers(TRANSCRIPTION_PROVIDER_IDS),
    }


@app.put("/v1/transcription/providers/current")
def set_transcription_provider(
    selection: ResponseProviderSelection,
) -> dict[str, str]:
    if selection.provider not in TRANSCRIPTION_PROVIDER_IDS:
        raise HTTPException(status_code=422, detail="Unknown transcription provider.")
    if not is_response_provider_available(selection.provider):
        raise HTTPException(
            status_code=409,
            detail=f"{selection.provider} is unavailable.",
        )

    save_transcription_provider(selection.provider)
    return {"provider": selection.provider}


@app.get("/v1/asr/providers")
def get_asr_providers() -> dict[str, object]:
    return {
        "current": asr_runtime.current_id,
        "providers": list_asr_providers(),
    }


@app.put("/v1/asr/providers/current")
def set_asr_provider(selection: ASRProviderSelection) -> dict[str, str]:
    if selection.provider not in ASR_PROVIDERS:
        raise HTTPException(status_code=422, detail="Unknown ASR provider.")

    previous = asr_runtime.current_id
    try:
        asr_runtime.select(selection.provider)
    except Exception as error:
        try:
            asr_runtime.select(previous)
        except Exception as restoration_error:
            raise HTTPException(
                status_code=500,
                detail=(
                    f"{selection.provider} could not be loaded and {previous} "
                    f"could not be restored: {restoration_error}"
                ),
            ) from restoration_error
        raise HTTPException(
            status_code=409,
            detail=f"{selection.provider} could not be loaded: {error}",
        ) from error

    try:
        save_asr_provider(selection.provider)
    except Exception as error:
        try:
            asr_runtime.select(previous)
        except Exception as restoration_error:
            raise HTTPException(
                status_code=500,
                detail=(
                    "The ASR setting could not be saved and the previous provider "
                    f"could not be restored: {restoration_error}"
                ),
            ) from restoration_error
        raise HTTPException(
            status_code=500,
            detail=f"The ASR setting could not be saved: {error}",
        ) from error

    return {"provider": selection.provider}
