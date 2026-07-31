# Resonance desktop shell

This package is the single Electron application for Resonance. It owns two
windows:

- the existing expanded UI;
- the persistent transparent transcription pill.

The expanded renderer remains the single voice-runtime owner for this first
slice. It publishes low-frequency lifecycle snapshots through the Electron main
process. The pill sends intent commands back through main; it does not create a
second microphone or transcription lifecycle.

## Development

The Windows desktop build compiles `native/windows-paste.c` into the clipboard
insertion helper. Install MinGW-w64 GCC and make `gcc.exe` available on `PATH`,
or set `RESONANCE_CC` to a compatible compiler executable.

Start the existing Python backend when voice/model features are needed:

```powershell
..\backend\server\run-server.ps1
```

Then use three terminals:

```powershell
cd ..\ui
npm run dev -- --port 4173 --strictPort
```

```powershell
cd ..\ui
npm run dev:pill -- --port 4174 --strictPort
```

```powershell
$env:RESONANCE_MAIN_DEV_URL='http://127.0.0.1:4173'
$env:RESONANCE_PILL_DEV_URL='http://127.0.0.1:4174/pill.html'
npm run dev
```

## Packaged loading

Run both renderer builds before packaging:

```powershell
cd ..\ui
npm run build
npm run build:pill
cd ..\desktop
npm run dist:win
```

Packaged windows load renderer files and `/vad` artifacts from the secure
`resonance://app` protocol. They do not run Vite or the UI website server.
`/api` requests on that protocol are proxied by Electron to
`RESONANCE_BACKEND_ORIGIN` (default `http://127.0.0.1:8000`).

The Python/model backend is still an external local service in this slice.
Bundling it or supervising it as an Electron child process requires a separate
decision about the Python environment and model artifact installation. Electron
discovers it at the configured origin and reports an unavailable-backend error
if it is not ready.

## Transport ownership

- Renderer HTML, JavaScript, CSS, and `/vad` ONNX/WASM/worklet files are packaged
  resources served by `resonance://app`. VAD stays in the renderer and does not
  send model bytes through IPC.
- Lifecycle snapshots, pill actions, window visibility, and click-through state
  use the narrow preload IPC bridge.
- The finite `/api` JSON and audio-upload calls use the custom protocol handler,
  which proxies to the configured loopback backend without exposing that origin
  to renderer code. This retains Fetch `AbortSignal` cancellation and avoids an
  additional large-binary IPC contract.
- There are currently no health, readiness, SSE, WebSocket, or streaming routes.
  Backend readiness is therefore detected by the first API request.
- Microphone capture remains a renderer Web Media operation. Electron grants
  only the `media` permission to the packaged application origin (and local Vite
  origins in development).
