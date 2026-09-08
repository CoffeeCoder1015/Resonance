# Dictation-only desktop acceptance

This checklist is frozen before implementation, alongside the automated tests.
Use the real Electron app through native UI interaction. Do not inject React
state, mock the preload bridge, or use the browser pill harness as evidence.

1. Opening Resonance shows settings directly in the existing neobrutalist style.
   No conversation log, text composer, agent toggle, speech-output control, or
   intermediate settings-opening menu remains.
2. All six theme choices change the actual transcription bar. Closing and
   reopening settings keeps the current bar theme. Compact/expanded transitions
   render correctly without accumulating canvases or losing the theme.
3. Speech-recognition and transcript-refinement choices load and save. A failed
   backend request displays an error. Saved choices survive reopening settings.
4. Only the global hold-to-talk shortcut is shown. Rebinding, Escape to cancel
   capture, and restoring defaults work. A legacy hotkey file containing the
   removed in-window shortcut retains its valid global shortcut.
5. With a disposable editor focused, hold the global shortcut, supply speech,
   and release. The bar records, processes, and inserts text once in that editor.
   Opening/focusing settings does not start another microphone runtime.
6. Closing settings leaves the bar usable. Reopening settings works. Hiding the
   bar during recording/processing cancels pending work with no stale insertion;
   showing the bar again permits a new dictation.
7. Microphone failure/retry and unavailable backend/provider show failure rather
   than falsely successful dictation, and a later valid attempt succeeds.
8. Check settings at its minimum and normal sizes, keyboard focus, and all theme
   selection controls for clipping or inaccessible actions.

Report observations, failures, and unexecuted checks separately. Acoustic checks
require an available speech input source; native UI automation alone is not proof
that speech recognition or insertion succeeded. Restore temporary user settings
and dispose of test-only windows/processes when finished.
