"""Minimal local Hugging Face Whisper quality/latency probe."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any


DEFAULT_MODEL = "openai/whisper-base.en"
WHISPER_SAMPLE_RATE = 16_000


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Transcribe a mono 16 kHz audio file with an OpenAI Whisper "
            "checkpoint loaded through Hugging Face Transformers."
        )
    )
    parser.add_argument("audio", type=Path, help="Path to a local audio file.")
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"Hugging Face model id or local model directory (default: {DEFAULT_MODEL}).",
    )
    return parser.parse_args()


def load_audio(audio_path: Path) -> tuple[Any, int]:
    import soundfile

    samples, sample_rate = soundfile.read(
        audio_path,
        dtype="float32",
        always_2d=True,
    )

    if samples.shape[0] == 0:
        raise ValueError(f"Audio file is empty: {audio_path}")

    # SoundFile returns frames x channels. Averaging preserves a simple,
    # deterministic mono input without requiring ffmpeg.
    mono_samples = samples.mean(axis=1)
    return mono_samples, sample_rate


def main() -> int:
    args = parse_args()
    audio_path = args.audio.expanduser().resolve()

    if not audio_path.is_file():
        raise FileNotFoundError(f"Audio file does not exist: {audio_path}")

    samples, sample_rate = load_audio(audio_path)
    if sample_rate != WHISPER_SAMPLE_RATE:
        raise ValueError(
            f"Expected {WHISPER_SAMPLE_RATE} Hz audio, got {sample_rate} Hz. "
            "Resample the test file before running this baseline so every "
            "runtime receives the same waveform."
        )

    from transformers import pipeline

    load_started = time.perf_counter()
    transcriber = pipeline(
        task="automatic-speech-recognition",
        model=args.model,
        device=-1,
    )
    model_load_seconds = time.perf_counter() - load_started

    inference_started = time.perf_counter()
    result = transcriber(
        {
            "array": samples,
            "sampling_rate": sample_rate,
        }
    )
    inference_seconds = time.perf_counter() - inference_started

    output = {
        "runtime": "huggingface-transformers",
        "model": args.model,
        "device": "cpu",
        "audio": str(audio_path),
        "sample_rate": sample_rate,
        "duration_seconds": len(samples) / sample_rate,
        "model_load_seconds": model_load_seconds,
        "inference_seconds": inference_seconds,
        "text": result["text"],
    }
    print(json.dumps(output, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
