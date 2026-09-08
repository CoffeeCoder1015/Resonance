# Resonance desktop shell

This Electron application owns a settings window and the persistent transparent
transcription bar. The settings window opens directly to speech-recognition,
transcript-cleanup, global-shortcut, and bar-theme controls. It has no recording
or conversational runtime. Theme selection is retained by Electron main while
settings is closed and reopened; it is not persisted across app restarts.

Only the bar acquires the microphone and runs VAD. Its model is prewarmed without
microphone access. Stopping dictation ends the physical track and suspends Web
Audio while keeping the model warm. Failed startup/resume discards the recorder
so a later attempt can create a fresh one.

Electron main owns transcription jobs and text insertion. Starting another job,
hiding the bar, or quitting cancels pending work. Canceled results are not inserted
or copied to the clipboard.

## Tray lifecycle

Closing settings releases its renderer and preview resources; the bar continues
running. **Open settings** recreates the settings window. **Hide transcription
pill** destroys the bar, stops its microphone and global input hook, and cancels
pending transcription. **Show transcription pill** recreates it.

## Development

Start the Python backend for transcription and provider settings:

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
- Settings-window `/api` JSON calls use the custom protocol handler,
  which proxies to the configured loopback backend without exposing that origin
  to renderer code. This retains Fetch `AbortSignal` cancellation and avoids an
  additional large-binary IPC contract.
- There are no turn polling, SSE, WebSocket, or streaming routes.
  Backend readiness is therefore detected by the first API request.
- Microphone capture remains a renderer Web Media operation. Electron grants
  the `media` permission only to the bar at the packaged application origin
  (or its local Vite origin in development). Settings cannot acquire a microphone.
