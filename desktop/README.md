# Resonance desktop shell

This package is the single Electron application for Resonance. It owns two
windows:

- the existing expanded UI;
- the persistent transparent transcription pill.

The expanded renderer and transcription pill each own an independent voice
runtime. Each renderer acquires its own microphone stream, runs its own VAD,
and drives its own avatar. Electron main owns the pill's completed audio request
and insertion lifecycle so processing continues if the pill renderer is
recreated. It does not relay microphone visualization data between renderers.

Each pill transcription is assigned an ephemeral job ID in Electron main.
Starting another transcription, revoking voice input, closing the pill, or
quitting cancels the previous backend job. A canceled job is never inserted and
is never copied to the clipboard.

## Tray lifecycle

Closing the expanded window destroys only the desktop renderer and releases its
microphone, VAD, and WebGL resources. The transcription pill remains independent
and continues running until **Hide transcription pill** destroys its renderer
and stops its microphone, VAD, WebGL, and global input hook. Opening Resonance
again recreates only the expanded renderer; **Show transcription pill** creates
the pill renderer independently when it was previously hidden.

## Development

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

On Windows, foreground-target capture and clipboard insertion also run inside
that long-lived Python backend through pywin32 and `SendInput`. There is no
per-insertion PowerShell command, C# compilation, CLI process, or native helper
executable. The backend revalidates the captured target immediately before
Ctrl+V and restores the previous OLE clipboard object unless another clipboard
write occurred in the meantime.

## Transport ownership

- Renderer HTML, JavaScript, CSS, and `/vad` ONNX/WASM/worklet files are packaged
  resources served by `resonance://app`. VAD stays in the renderer and does not
  send model bytes through IPC.
- Lifecycle snapshots, pill actions, window visibility, click-through state,
  and the pill's final audio upload use the narrow preload IPC bridge.
- Expanded-window `/api` JSON and audio-upload calls use the custom protocol handler,
  which proxies to the configured loopback backend without exposing that origin
  to renderer code. This retains Fetch `AbortSignal` cancellation and avoids an
  additional large-binary IPC contract.
- There are no turn polling, SSE, WebSocket, or streaming routes.
  Backend readiness is therefore detected by the first API request.
- Microphone capture remains a renderer Web Media operation. Electron grants
  only the `media` permission to the packaged application origin (and local Vite
  origins in development).
