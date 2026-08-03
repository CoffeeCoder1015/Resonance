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
starting the backend. OpenCode is the default agent provider; passthrough is the
default transcription provider.

The backend calls `opencode run --format json` or `agy -p`. It does not pass a
model flag, so each CLI keeps its own default model. The local model providers
run directly through the Vulkan build of `llama-cpp-python`:

- Gemma runs `unsloth/gemma-4-E2B-it-qat-GGUF` UD-Q4_K_XL.
- Liquid runs `LiquidAI/LFM2.5-1.2B-Instruct-GGUF` Q4_K_M.

Each provider downloads its GGUF into the Hugging Face cache and loads it on
first use. Liquid keeps its model loaded for subsequent responses. Gemma resets
an idle timer after each response and releases its loaded model after 10 minutes
without Gemma activity; the next Gemma response loads it again. Gemma uses the
selected mode directly: agent turns receive an ordinary user message, while
transcription turns JSON-encode the raw ASR text inside an explicitly marked,
untrusted data block.

Each text provider implements the same `respond` interface. Turn
orchestration does not know how a provider constructs commands or parses text.

Agent mode can select OpenCode or Antigravity. Transcription mode can select
Gemma, Liquid, or Passthrough. The mode on each API call chooses which saved
provider setting is used; it is not global application state.

## Voice turn

```powershell
curl.exe -X POST "http://127.0.0.1:8000/v1/voice/turns?mode=transcription" `
  -F "file=@C:\path\to\audio.wav"
```

The input must be 16 kHz WAV audio. ASR completes before the initial response;
the text stage continues in the background:

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
