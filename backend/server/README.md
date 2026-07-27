# Resonance backend

The Resonance backend transcribes speech with the Hugging Face pipeline, then
dispatches each transcript to the selected local agent CLI.

## Run

```powershell
uv sync --locked
.\run-server.ps1
```

The server listens at `http://127.0.0.1:8000`.

Authenticate the provider CLIs under the same operating-system user before
starting the backend. OpenCode is selected by default.

The backend calls `opencode run --format json` or `agy -p`. It does not pass a
model flag, so each CLI keeps its own default model.

## Voice turn

```powershell
curl.exe -X POST http://127.0.0.1:8000/v1/voice/turns `
  -F "file=@C:\path\to\audio.wav"
```

The input must be 16 kHz WAV audio. Transcription completes before the initial
response; agent generation continues in the background:

```json
{
  "id": "turn_...",
  "status": "responding",
  "transcript": "Transcribed text.",
  "provider": "opencode"
}
```

Poll `GET /v1/turns/{id}` until the status is `completed` or `failed`.
Turn state is process-local in this first version, so in-flight turns do not
survive a backend restart.

Provider settings are available through `GET /v1/providers` and changed through
`PUT /v1/providers/current`. The selection is saved in `config.json`.
