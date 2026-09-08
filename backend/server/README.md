# Resonance backend

The Resonance backend has one processing path:

```text
ASR provider -> text -> Response provider -> text
```

Every voice request uses both provider contracts. Passthrough is a response provider
that returns its input unchanged when refinement is not needed.

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

LFM 2.5 Transcription is the default response provider. It loads
`backend/model/LFM2.5-1.2B-Base.Q4_K_M.gguf` through
`llama-cpp-python` with a 32k context. It passes the raw transcript directly to
the completion API without instructions, chat messages, or prompt wrappers.
Generation uses the context remaining after the input transcript rather than a
fixed output-token cap. All model layers are offloaded through llama.cpp's
Vulkan backend (`n_gpu_layers=-1`). Other inference settings retain their
defaults, and verbose llama.cpp model logging is disabled.
The llama.cpp model stays warm in a supervised child process. A native model
crash or request deadline only terminates that child; the API remains alive and
returns the raw ASR transcript using the normal degraded-success response. The
worker unloads after five minutes without a completed refinement and is lazily
started again by the next transcription request.

Each response provider implements the same `respond` interface. Pipeline
orchestration does not know how a provider constructs commands or parses text.

Transcription mode is the only supported mode. It can select LFM 2.5
Transcription or Passthrough through the saved transcription provider setting.

## Voice processing

```powershell
curl.exe -X POST "http://127.0.0.1:8000/v1/voice/process?mode=transcription" `
  -H "X-Resonance-Job-Id: example-job" `
  -F "file=@C:\path\to\audio.wav"
```

The input must be 16 kHz WAV audio. Long inputs are decoded and transcribed in
bounded 60-second chunks, then joined before the downstream stage. The request
returns once both stages have finished:

```json
{
  "transcript": "Transcribed text.",
  "text": "Refined text.",
  "mode": "transcription",
  "downstream": {
    "provider": "lfm-transcription",
    "status": "completed"
  }
}
```

There is no server-side turn store or polling API. If transcription refinement
fails, the request still succeeds with the raw ASR transcript in `text` and a
`failed` downstream status.
Desktop transcription requests carry an ephemeral job ID. Posting to
`/v1/transcriptions/{job_id}/cancel` cancels ASR consumption, provider-lock
waiting, and active LFM generation without retaining a result or conversation.

Transcription provider settings use `GET /v1/transcription/providers` and
`PUT /v1/transcription/providers/current`. ASR provider settings use
`GET /v1/asr/providers` and `PUT /v1/asr/providers/current`.
The legacy `agent_provider` configuration field is ignored; transcription and
ASR selections continue to load from the same config file.
