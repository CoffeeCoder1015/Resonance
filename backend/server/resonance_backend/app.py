from contextlib import asynccontextmanager
from collections.abc import Iterator, MutableMapping
from dataclasses import dataclass
from threading import RLock
from time import monotonic
from typing import Annotated, Callable, Literal
from uuid import uuid4

import soundfile
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Response, UploadFile
from pydantic import BaseModel

from resonance_backend.asr_providers import (
    ASR_PROVIDERS,
    asr_runtime,
    list_asr_providers,
)
from resonance_backend.modes import MODES, get_mode
from resonance_backend.provider_ids import (
    AGENT_PROVIDER_IDS,
    TRANSCRIPTION_PROVIDER_IDS,
)
from resonance_backend.response_providers import (
    RESPONSE_PROVIDERS,
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


SAMPLE_RATE = 16_000
MAX_AUDIO_BYTES = 25 * 1024 * 1024
TRANSCRIPTION_CHUNK_SECONDS = 60
TRANSCRIPTION_CHUNK_FRAMES = SAMPLE_RATE * TRANSCRIPTION_CHUNK_SECONDS
MAX_AUDIO_CHANNELS = 2
MAX_RETAINED_TURNS = 100
COMPLETED_TURN_TTL_SECONDS = 15 * 60


class TurnCapacityError(Exception):
    """Raised when every retained turn is still running."""


@dataclass
class _TurnRecord:
    turn: dict[str, str]
    created_at: float
    terminal_at: float | None = None


class TurnStore(MutableMapping[str, dict[str, str]]):
    """A bounded, lock-protected turn store for concurrent request workers."""

    _TERMINAL_STATUSES = frozenset({"completed", "failed"})

    def __init__(
        self,
        *,
        max_turns: int = MAX_RETAINED_TURNS,
        completed_ttl_seconds: float = COMPLETED_TURN_TTL_SECONDS,
        clock: Callable[[], float] = monotonic,
    ) -> None:
        self._max_turns = max_turns
        self._completed_ttl_seconds = completed_ttl_seconds
        self._clock = clock
        self._records: dict[str, _TurnRecord] = {}
        self._lock = RLock()

    def _purge_expired_locked(self, now: float) -> None:
        expired_ids = [
            turn_id
            for turn_id, record in self._records.items()
            if record.terminal_at is not None
            and now - record.terminal_at >= self._completed_ttl_seconds
        ]
        for turn_id in expired_ids:
            del self._records[turn_id]

    def _evict_terminal_turns_locked(self, now: float) -> None:
        self._purge_expired_locked(now)
        while len(self._records) >= self._max_turns:
            terminal_turns = [
                (record.terminal_at or record.created_at, turn_id)
                for turn_id, record in self._records.items()
                if record.terminal_at is not None
            ]
            if not terminal_turns:
                raise TurnCapacityError()
            _, oldest_turn_id = min(terminal_turns)
            del self._records[oldest_turn_id]

    def create(self, turn: dict[str, str]) -> dict[str, str]:
        turn_id = turn["id"]
        now = self._clock()
        with self._lock:
            self._evict_terminal_turns_locked(now)
            if turn_id in self._records:
                raise ValueError(f"Turn already exists: {turn_id}")
            self._records[turn_id] = _TurnRecord(dict(turn), now)
            return dict(turn)

    def set_terminal(self, turn_id: str, **fields: str) -> bool:
        now = self._clock()
        with self._lock:
            self._purge_expired_locked(now)
            record = self._records.get(turn_id)
            if record is None:
                return False
            record.turn = {**record.turn, **fields}
            record.terminal_at = now
            return True

    def __getitem__(self, turn_id: str) -> dict[str, str]:
        now = self._clock()
        with self._lock:
            self._purge_expired_locked(now)
            record = self._records[turn_id]
            return dict(record.turn)

    def __setitem__(self, turn_id: str, turn: dict[str, str]) -> None:
        now = self._clock()
        with self._lock:
            if turn_id not in self._records:
                self._evict_terminal_turns_locked(now)
            terminal_at = (
                now if turn.get("status") in self._TERMINAL_STATUSES else None
            )
            self._records[turn_id] = _TurnRecord(dict(turn), now, terminal_at)

    def __delitem__(self, turn_id: str) -> None:
        with self._lock:
            del self._records[turn_id]

    def __iter__(self) -> Iterator[str]:
        now = self._clock()
        with self._lock:
            self._purge_expired_locked(now)
            return iter(tuple(self._records))

    def __len__(self) -> int:
        now = self._clock()
        with self._lock:
            self._purge_expired_locked(now)
            return len(self._records)

    def clear(self) -> None:
        with self._lock:
            self._records.clear()


@asynccontextmanager
async def lifespan(_: FastAPI):
    asr_runtime.load(load_asr_provider())
    try:
        yield
    finally:
        asr_runtime.unload()


app = FastAPI(title="Resonance Backend", lifespan=lifespan)
turns = TurnStore()


class ResponseProviderSelection(BaseModel):
    provider: str


class ASRProviderSelection(BaseModel):
    provider: str


class TextTurn(BaseModel):
    text: str
    mode: Literal["agent", "transcription"]


def transcribe(file: UploadFile) -> str:
    try:
        samples, sample_rate = soundfile.read(
            file.file,
            dtype="float32",
            always_2d=True,
        )
    except (OSError, RuntimeError, ValueError) as error:
        raise HTTPException(
            status_code=422,
            detail="Audio recording could not be decoded.",
        ) from error

    if samples.shape[0] == 0:
        raise HTTPException(status_code=400, detail="Audio recording is empty.")
    if sample_rate != SAMPLE_RATE:
        raise HTTPException(
            status_code=422,
            detail=f"Audio recording must use a {SAMPLE_RATE} Hz sample rate.",
        )

    return asr_runtime.transcribe(
        {
            "array": samples.mean(axis=1),
            "sampling_rate": sample_rate,
        }
    )


def create_turn(
    transcript: str,
    background_tasks: BackgroundTasks,
    response_provider: str,
    mode_id: str,
) -> dict[str, str]:
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

    turn_id = f"turn_{uuid4().hex}"
    turn = {
        "id": turn_id,
        "status": "responding",
        "transcript": transcript,
        "response_provider": response_provider,
        "mode": mode_id,
    }
    try:
        turns.create(turn)
    except TurnCapacityError as error:
        raise HTTPException(
            status_code=503,
            detail="Turn capacity is exhausted; wait for an active response to finish.",
        ) from error
    background_tasks.add_task(
        run_response_stage,
        turn_id,
        transcript,
        response_provider,
        mode_id,
    )
    return turn


def run_response_stage(
    turn_id: str,
    transcript: str,
    response_provider: str,
    mode_id: str,
) -> None:
    try:
        mode = get_mode(mode_id)
        output_text = get_response_provider(response_provider).respond(
            message=transcript,
            instructions=mode.instructions,
            mode_id=mode_id,
        )
    except Exception as error:
        turns.set_terminal(turn_id, status="failed", error=str(error))
        return

    turns.set_terminal(turn_id, status="completed", response=output_text)


@app.post("/v1/voice/turns", status_code=202)
def create_voice_turn(
    background_tasks: BackgroundTasks,
    response: Response,
    file: Annotated[UploadFile, File()],
    mode: Literal["agent", "transcription"],
) -> dict[str, str]:
    settings = load_settings()
    response_provider = settings[f"{mode}_provider"]
    transcript = transcribe(file)
    turn = create_turn(
        transcript,
        background_tasks,
        response_provider,
        mode,
    )
    response.headers["Location"] = f"/v1/turns/{turn['id']}"
    response.headers["Retry-After"] = "1"
    return turn


@app.post("/v1/text/turns", status_code=202)
def create_text_turn(
    request: TextTurn,
    background_tasks: BackgroundTasks,
    response: Response,
) -> dict[str, str]:
    settings = load_settings()
    turn = create_turn(
        request.text.strip(),
        background_tasks,
        settings[f"{request.mode}_provider"],
        request.mode,
    )
    response.headers["Location"] = f"/v1/turns/{turn['id']}"
    response.headers["Retry-After"] = "1"
    return turn


@app.get("/v1/turns/{turn_id}")
def get_turn(turn_id: str) -> dict[str, str]:
    turn = turns.get(turn_id)
    if turn is None:
        raise HTTPException(status_code=404, detail="Turn not found.")
    return turn


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
