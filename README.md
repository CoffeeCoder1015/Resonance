# Resonance

Resonance turns spoken thoughts into text you can use. It pairs a small,
always-available desktop transcription control with a calm, focused interface,
so writing can start with speaking instead of a blank text field.

## Repository layout

| Directory | Purpose |
| --- | --- |
| `website/` | The public React/Vite product page deployed through GitHub Pages. |
| `ui/` | The desktop settings and transcription-pill renderer. |
| `desktop/` | The Electron desktop shell. |
| `backend/server/` | The local HTTP service used by the desktop application. |

## Prerequisites

- Node.js 22.12 or later and npm 10 or later
- Python 3.12 or later and [uv](https://docs.astral.sh/uv/)
- Windows for the desktop application and its system-integration features

## Run the desktop app in development

Start these processes in separate PowerShell terminals from the repository
root. Install each component's dependencies once with `npm ci` (and, for the
backend, `uv sync --locked`) before first use.

```powershell
cd backend/server
uv sync --locked
.\run-server.ps1
```

```powershell
cd ui
npm ci
npm run dev -- --port 4173 --strictPort
```

```powershell
cd ui
npm run dev:pill -- --port 4174 --strictPort
```

```powershell
cd desktop
npm ci
$env:RESONANCE_MAIN_DEV_URL='http://127.0.0.1:4173'
$env:RESONANCE_PILL_DEV_URL='http://127.0.0.1:4174/pill.html'
npm run dev
```

The backend listens on `http://127.0.0.1:8000`. The Electron app uses the
first renderer for settings and the second for the compact transcription pill.

## Build the Windows desktop package

Build both renderer bundles before packaging Electron:

```powershell
cd ui
npm ci
npm run build
npm run build:pill

cd ../desktop
npm ci
npm run dist:win
```

The Windows installer is written to `desktop/release/`.

## Contributing

Keep generated bundles, dependency directories, caches, local configuration,
and machine-specific assets out of commits. The repository's ignore rules
already cover these; commit the source and lockfiles needed to reproduce a
build instead.
