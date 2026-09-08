# Dictation-only refactor results

## Implemented

- The desktop window opens directly to neobrutalist transcription settings:
  speech recognition, transcript cleanup, global hold-to-talk, and six bar themes.
- Removed the conversation log, text composer, agent toggle, speech output,
  conversation runtime, and associated styles and types.
- Removed backend agent routes, text-entry endpoint, agent providers and config
  accessors. Transcription, ASR, refinement fallback, cancellation, and Windows
  insertion remain. Old agent config fields are ignored.
- Removed the in-window shortcut and microphone ownership handshake. Only the
  transcription bar can request microphone permission. Legacy global shortcuts
  still load. Hiding the bar cancels pending transcription.
- Settings reads the current bar theme when reopened instead of resetting it.
  Theme selection remains session-scoped, as documented in the desktop README.
- This refactor leaves the archived website unchanged.

## Automated verification

| Command / directory | Result |
| --- | --- |
| `uv run --locked pytest -q` in `backend/server` | 50 passed |
| `npm run check` in `ui` | 20 passed, TypeScript and both builds passed |
| TypeScript build followed by `node --test out/*.test.js` in `desktop` | 7 passed |
| `git diff --check` | Passed |

Tests were prepared before implementation of their corresponding components.
The new removal expectations failed on the original implementation. Obsolete
agent-only cases were removed during that test-preparation phase. Hash comparison
of all 13 test files and the native acceptance checklist confirms no changes
after freezing. The microphone-recovery regression tests remain unchanged.

Coverage includes real WAV decoding through HTTP with model execution stubbed,
raw-transcript fallback, cancellation followed by an independent job, rejected
agent requests, removed routes, config compatibility, binary audio transport,
and propagation of errors and cancellation.

Non-failing warnings: the installed FastAPI/Starlette test client deprecates its
httpx transport; the bar build retains Vite's large-bundle advisory.

## Independent native verification

A Luna xhigh agent operated the real Electron app through native Windows input,
accessibility trees, and screenshots. No React state, preload bridge, or simulated
browser harness was injected to claim frontend acceptance.

Verified:

- Direct settings with no conversation controls or intermediate menu.
- All six theme selections and previews; Voxel also observed on the actual bar.
- Closing and reopening settings retained Voxel; Ceramic Clay restored afterward.
- Provider selection changes; original Passthrough and Faster Whisper restored.
- Shortcut Change/Escape retained Ctrl+Win; Ctrl+Shift+F9 saved; Defaults restored
  Ctrl+Win. Initial launch read a legacy file containing the removed in-window key.
- Stopping the backend and reopening settings displayed a visible unavailable
  error. After restarting the backend and reopening settings, the error cleared
  and the original provider selections loaded successfully.
- Normal-window layout inspected from a native screenshot.

Not verified:

- Real spoken audio through recognition and insertion into an external editor.
- Recording/processing cancellation by hiding and showing the bar in the native UI
  (automated cancellation tests pass).
- Native microphone failure and recovery (automated pipeline recovery tests pass).
- Minimum-size layout: two native resize attempts did not resize the window.

The initial test launch inherited a closed stdout pipe and raised EPIPE. Relaunch
with persistent stdout/stderr files resolved it without a production-code change.
No production repair cycle required changing frozen tests.

## Work ownership

The root agent implemented the settings UI and Electron changes and ran integration
checks. Luna xhigh prepared the backend tests, implemented backend removal, and
independently verified the root-authored frontend. Additional subagent creation
was blocked by the task's thread limit; backend and root work overlapped without
shared file ownership.
