from typing import Annotated

import soundfile
import torch
from fastapi import FastAPI, File, HTTPException, UploadFile
from transformers import pipeline


MODEL = "openai/whisper-base.en"
SAMPLE_RATE = 16_000

transcriber = pipeline(
    task="automatic-speech-recognition",
    model=MODEL,
    device=-1,
)

app = FastAPI(title="Resonance Backend")


@app.post("/v1/audio/transcriptions")
def transcribe(file: Annotated[UploadFile, File()]) -> dict[str, str]:
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

    return {"text": text.strip()}
