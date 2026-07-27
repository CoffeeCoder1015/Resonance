# Resonance backend

The Resonance backend serves speech transcription with the Hugging Face
pipeline API and `openai/whisper-base.en`.

## Run

```powershell
uv sync --locked
.\run-server.ps1
```

The server listens at `http://127.0.0.1:8000`.

## Transcribe

```powershell
curl.exe -X POST http://127.0.0.1:8000/v1/audio/transcriptions `
  -F "file=@C:\path\to\audio.wav"
```

The input must be 16 kHz WAV audio. The response is:

```json
{ "text": "Transcribed text." }
```
