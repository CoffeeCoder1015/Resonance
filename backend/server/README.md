# Resonance backend

The Resonance backend has one processing path:

```text
ASR provider -> text -> Response provider -> text
```

Every voice turn uses both provider contracts. Passthrough is a Response provider
that returns its input unchanged when the second stage is not needed.

## Run

```powershell
uv sync --locked
.\run-server.ps1
```

The server listens at `http://127.0.0.1:8000`.

On Windows, this same process owns the desktop integration routes used to
capture the foreground target and paste completed text at its caret. The path
uses pywin32/OLE clipboard APIs plus `SendInput`, preserves clipboard-based
insertion compatibility, and avoids launching a helper process for every turn.

Authenticate the provider CLIs under the same operating-system user before
starting the backend. OpenCode is the default agent provider; LFM 2.5
Transcription is the default transcription provider.

The backend calls `opencode run --format json` or `agy -p`. It does not pass a
model flag, so each CLI keeps its own default model. The LFM transcription
provider loads `backend/model/LFM2.5-1.2B-Base.Q4_K_M.gguf` through
`llama-cpp-python` with a 32k context. It passes the raw transcript directly to
the completion API without instructions, chat messages, or prompt wrappers.
Generation uses the context remaining after the input transcript rather than a
fixed output-token cap. All other inference settings retain their defaults.

Each text provider implements the same `respond` interface. Turn
orchestration does not know how a provider constructs commands or parses text.

Agent mode can select OpenCode or Antigravity. Transcription mode can select
LFM 2.5 Transcription or Passthrough. The mode on each API call chooses which
saved provider setting is used; it is not global application state.

## Voice turn

```powershell
curl.exe -X POST "http://127.0.0.1:8000/v1/voice/turns?mode=transcription" `
  -F "file=@C:\path\to\audio.wav"
```

The input must be 16 kHz WAV audio. Long inputs are decoded and transcribed in
bounded 60-second chunks, then joined before the response stage. ASR completes
before the initial response; the text stage continues in the background:

```json
{
  "id": "turn_...",
  "status": "responding",
  "transcript": "Transcribed text.",
  "response_provider": "opencode",
  "mode": "transcription"
}
```

Poll `GET /v1/turns/{id}` until the status is `completed` or `failed`. A
completed turn contains the second stage's text in `response`.
Turn state is process-local in this first version, so in-flight turns do not
survive a backend restart.

Agent provider settings use `GET /v1/agent/providers` and
`PUT /v1/agent/providers/current`. Transcription provider settings use
`GET /v1/transcription/providers` and
`PUT /v1/transcription/providers/current`. Pipeline mode is not saved
application state: each voice or text turn must request either `agent` or
`transcription`.
