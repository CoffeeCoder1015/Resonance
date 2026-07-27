# Resonance UI

The browser sends recorded audio to the same-origin website server:

```text
POST /api/voice/turns
Content-Type: audio/wav
```

The website server forwards the turn to the Resonance backend. The backend
transcribes it, starts the selected agent CLI, and returns a turn ID. The browser
polls `GET /api/turns/{id}` for the completed response.

Browser voice turns automatically finalize after 60 seconds so capture memory
and inference work remain bounded.

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
