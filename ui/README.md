# Resonance UI

The browser sends recorded audio to the same-origin website-server route:

```text
POST /api/asr/transcriptions
Content-Type: audio/wav
```

The website server owns the ASR provider. Its current provider forwards audio to
the local Hugging Face Whisper service and returns `{ "text": "..." }`. Replace
`server/asr-provider.mjs` when Whisper moves in-process; the browser contract
does not change.

Browser voice turns automatically finalize after 60 seconds so capture memory
and inference work remain bounded.

Configuration:

- `WHISPER_ENDPOINT` defaults to
  `http://127.0.0.1:8000/v1/audio/transcriptions`.
- `WHISPER_MODEL` defaults to `openai/whisper-base.en`.
- `ASR_TIMEOUT_MS` defaults to `120000` and bounds each website-server
  transcription request.
- `HOST` and `PORT` configure the production website server.

Development:

```powershell
npm run dev -- --port 4173 --strictPort
```

Production:

```powershell
npm run build
npm start
```
