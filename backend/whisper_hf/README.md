# Hugging Face Whisper experiment

This folder is an isolated local-quality and latency probe for the original
OpenAI Whisper checkpoint loaded through Hugging Face Transformers.

It provides the official Transformers development server plus a direct
command-line probe. It does not provide microphone capture, Electron
integration, UI wiring, cloud inference, or a production backend. The sibling
`../whispercpp/` implementation remains independent and unchanged.

## Runtime

- Python 3.10 or newer.
- `torch==2.13.0`
- `transformers==5.14.1`
- `soundfile==0.14.0`
- Default model: `openai/whisper-base.en`
- Device: CPU

The dependencies are pinned to the versions checked on 2026-07-26. Model
weights are not stored in this repository. Transformers downloads the selected
checkpoint into the normal Hugging Face user cache on first use.

## Set up

From this directory:

```powershell
uv sync
```

This creates a local `.venv` and installs the exact dependency set captured in
`uv.lock`. Model weights are still downloaded separately on first use.

## Start the local endpoint

```powershell
.\run-server.ps1
```

The script uses uv to start the official Transformers server with
`openai/whisper-base.en`. It listens on the server's loopback default:

```text
http://localhost:8000/v1/audio/transcriptions
```

The first run installs any missing Python dependencies and downloads the model
into the normal Hugging Face user cache. Send audio using the OpenAI-style
multipart contract:

```powershell
curl.exe -X POST http://localhost:8000/v1/audio/transcriptions `
  -F "file=@C:\path\to\audio.wav" `
  -F "model=openai/whisper-base.en"
```

The response has the shape:

```json
{ "text": "Transcribed text from the audio file." }
```

## Prepare a comparable recording

The initial probe deliberately requires a 16 kHz input so the Hugging Face and
Whisper.cpp tests can receive the same waveform. Mono or multichannel audio is
accepted; multichannel input is averaged to mono.

Use a short spoken recording encoded at 16 kHz. WAV is the clearest baseline.
No ffmpeg dependency is introduced by this experiment.

## Transcribe

```powershell
uv run python .\transcribe.py C:\path\to\test-16khz.wav
```

To try another compatible checkpoint:

```powershell
uv run python .\transcribe.py C:\path\to\test-16khz.wav `
  --model openai/whisper-tiny.en
```

The command prints JSON containing the transcript, audio duration, model-load
time, and inference time:

```json
{
  "runtime": "huggingface-transformers",
  "model": "openai/whisper-base.en",
  "device": "cpu",
  "duration_seconds": 10.0,
  "model_load_seconds": 0.0,
  "inference_seconds": 0.0,
  "text": "Example transcript."
}
```

First-run load time includes downloading the model and is not a valid warm
latency measurement. Run the command again after the checkpoint is cached, and
compare the transcript and inference time against the same audio in
Whisper.cpp. This probe measures the Transformers/PyTorch runtime; it does not
predict Whisper.cpp deployment performance.
