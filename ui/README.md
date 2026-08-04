# Resonance UI

The browser sends recorded audio to the same-origin website server:

```text
POST /api/voice/process
Content-Type: audio/wav
```

The website server forwards the request to the Resonance backend. The backend
transcribes it, runs the selected downstream provider, and returns the final
result in the same response. There is no turn store or polling loop.

Long recordings are retained in one WAV upload. The backend decodes and
transcribes it in bounded 60-second chunks, so holding the microphone beyond 60
seconds does not cut off the result.

Configuration:

- `RESONANCE_BACKEND_ORIGIN` defaults to `http://127.0.0.1:8000`.
- `BACKEND_TIMEOUT_MS` defaults to `120000`.
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
