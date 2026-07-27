from typing import Annotated
from uuid import uuid4

import soundfile
import torch
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Response, UploadFile
from pydantic import BaseModel
from transformers import pipeline

from resonance_backend.providers import (
    PROVIDERS,
    is_provider_available,
    list_providers,
    run_agent,
)
from resonance_backend.settings import load_provider, save_provider


MODEL = "openai/whisper-base.en"
SAMPLE_RATE = 16_000

transcriber = pipeline(
    task="automatic-speech-recognition",
    model=MODEL,
    device=-1,
)

app = FastAPI(title="Resonance Backend")
turns: dict[str, dict[str, str]] = {}


class ProviderSelection(BaseModel):
    provider: str


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

    with torch.inference_mode():
        result = transcriber(
            {
                "array": samples.mean(axis=1),
                "sampling_rate": sample_rate,
            }
        )

    text = result.get("text") if isinstance(result, dict) else None
    if not isinstance(text, str):
        raise RuntimeError("ASR pipeline returned an invalid result.")

    return text.strip()


def create_turn(transcript: str, background_tasks: BackgroundTasks) -> dict[str, str]:
    if not transcript:
        raise HTTPException(status_code=422, detail="No speech was detected.")

    provider = load_provider()
    if provider not in PROVIDERS:
        raise HTTPException(
            status_code=500,
            detail="The saved provider is not supported.",
        )

    turn_id = f"turn_{uuid4().hex}"
    turn = {
        "id": turn_id,
        "status": "responding",
        "transcript": transcript,
        "provider": provider,
    }
    turns[turn_id] = turn
    background_tasks.add_task(generate_response, turn_id, transcript, provider)
    return turn


def generate_response(turn_id: str, transcript: str, provider: str) -> None:
    try:
        agent_response = run_agent(provider, transcript)
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
        "response": agent_response,
    }


@app.post("/v1/voice/turns", status_code=202)
def create_voice_turn(
    background_tasks: BackgroundTasks,
    response: Response,
    file: Annotated[UploadFile, File()],
) -> dict[str, str]:
    turn = create_turn(transcribe(file), background_tasks)
    response.headers["Location"] = f"/v1/turns/{turn['id']}"
    response.headers["Retry-After"] = "1"
    return turn


@app.post("/v1/text/turns", status_code=202)
def create_text_turn(
    request: TextTurn,
    background_tasks: BackgroundTasks,
    response: Response,
) -> dict[str, str]:
    turn = create_turn(request.text.strip(), background_tasks)
    response.headers["Location"] = f"/v1/turns/{turn['id']}"
    response.headers["Retry-After"] = "1"
    return turn


@app.get("/v1/turns/{turn_id}")
def get_turn(turn_id: str) -> dict[str, str]:
    turn = turns.get(turn_id)
    if turn is None:
        raise HTTPException(status_code=404, detail="Turn not found.")
    return turn


@app.get("/v1/providers")
def get_providers() -> dict[str, object]:
    return {
        "current": load_provider(),
        "providers": list_providers(),
    }


@app.put("/v1/providers/current")
def set_provider(selection: ProviderSelection) -> dict[str, str]:
    if selection.provider not in PROVIDERS:
        raise HTTPException(status_code=422, detail="Unknown provider.")
    if not is_provider_available(selection.provider):
        raise HTTPException(
            status_code=409,
            detail=f"{selection.provider} CLI is not installed.",
        )

    save_provider(selection.provider)
    return {"provider": selection.provider}
