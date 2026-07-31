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

Authenticate the provider CLIs under the same operating-system user before
starting the backend. OpenCode is selected by default.

The backend calls `opencode run --format json` or `agy -p`. It does not pass a
model flag, so each CLI keeps its own default model. The Liquid provider runs
`LiquidAI/LFM2.5-1.2B-Instruct-GGUF` Q4_K_M directly through
`llama-cpp-python`. It downloads the GGUF into the Hugging Face cache on first
use and keeps the loaded model alive for subsequent responses.

Each Response provider implements the same `respond` interface. Turn
orchestration does not know how a provider constructs commands or parses text.

The selected mode supplies instructions to that interface. Voice mode asks for
plain spoken dialogue and transcription mode asks for faithful transcription
refinement. The CLI agents currently apply those instructions by including them
with each message.

## Voice turn

```powershell
curl.exe -X POST http://127.0.0.1:8000/v1/voice/turns `
  -F "file=@C:\path\to\audio.wav"
```

The input must be 16 kHz WAV audio. ASR completes before the initial response;
the text stage continues in the background:

```json
{
  "id": "turn_...",
  "status": "responding",
  "transcript": "Transcribed text.",
  "response_provider": "opencode"
}
```

Poll `GET /v1/turns/{id}` until the status is `completed` or `failed`. A
completed turn contains the second stage's text in `response`.
Turn state is process-local in this first version, so in-flight turns do not
survive a backend restart.

Response provider settings are available through `GET /v1/response/providers`
and changed through `PUT /v1/response/providers/current`. Modes are available
through `GET /v1/modes` and changed through `PUT /v1/modes/current`. Both
selections share `config.json`.
