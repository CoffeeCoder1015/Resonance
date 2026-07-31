from contextlib import asynccontextmanager
from typing import Annotated
from uuid import uuid4

import soundfile
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Response, UploadFile
from pydantic import BaseModel

from resonance_backend.asr_providers import (
    ASR_PROVIDERS,
    asr_runtime,
    list_asr_providers,
)
from resonance_backend.modes import MODES, get_mode, list_modes
from resonance_backend.response_providers import (
    RESPONSE_PROVIDERS,
    get_response_provider,
    is_response_provider_available,
    list_response_providers,
)
from resonance_backend.settings import (
    load_asr_provider,
    load_mode,
    load_response_provider,
    load_settings,
    save_asr_provider,
    save_mode,
    save_response_provider,
)


SAMPLE_RATE = 16_000


@asynccontextmanager
async def lifespan(_: FastAPI):
    asr_runtime.load(load_asr_provider())
    try:
        yield
    finally:
        asr_runtime.unload()


app = FastAPI(title="Resonance Backend", lifespan=lifespan)
turns: dict[str, dict[str, str]] = {}


class ResponseProviderSelection(BaseModel):
    response_provider: str


class ASRProviderSelection(BaseModel):
    provider: str


class ModeSelection(BaseModel):
    mode: str


class TextTurn(BaseModel):
    text: str


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
            status_code=500,
            detail="The saved mode is not supported.",
        )

    turn_id = f"turn_{uuid4().hex}"
    turn = {
        "id": turn_id,
        "status": "responding",
        "transcript": transcript,
        "response_provider": response_provider,
        "mode": mode_id,
    }
    turns[turn_id] = turn
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
        )
    except Exception as error:
        turns[turn_id] = {
            **turns[turn_id],
            "status": "failed",
            "error": str(error),
        }
        return

    turns[turn_id] = {
        **turns[turn_id],
        "status": "completed",
        "response": output_text,
    }


@app.post("/v1/voice/turns", status_code=202)
def create_voice_turn(
    background_tasks: BackgroundTasks,
    response: Response,
    file: Annotated[UploadFile, File()],
) -> dict[str, str]:
    settings = load_settings()
    response_provider = settings["response_provider"]
    mode_id = settings["mode"]
    transcript = transcribe(file)
    turn = create_turn(
        transcript,
        background_tasks,
        response_provider,
        mode_id,
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
        settings["response_provider"],
        settings["mode"],
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


@app.get("/v1/response/providers")
def get_response_providers() -> dict[str, object]:
    return {
        "current": load_response_provider(),
        "providers": list_response_providers(),
    }


@app.put("/v1/response/providers/current")
def set_response_provider(
    selection: ResponseProviderSelection,
) -> dict[str, str]:
    if selection.response_provider not in RESPONSE_PROVIDERS:
        raise HTTPException(status_code=422, detail="Unknown response provider.")
    if not is_response_provider_available(selection.response_provider):
        raise HTTPException(
            status_code=409,
            detail=f"{selection.response_provider} is unavailable.",
        )

    save_response_provider(selection.response_provider)
    return {"response_provider": selection.response_provider}


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


@app.get("/v1/modes")
def get_modes() -> dict[str, object]:
    return {
        "current": load_mode(),
        "modes": list_modes(),
    }


@app.put("/v1/modes/current")
def set_mode(selection: ModeSelection) -> dict[str, str]:
    if selection.mode not in MODES:
        raise HTTPException(status_code=422, detail="Unknown mode.")

    save_mode(selection.mode)
    return {"mode": selection.mode}
