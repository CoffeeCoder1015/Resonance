# Voice Transcription Tools Research

Research snapshot: July 26, 2026.

This report compares current voice dictation, recorded-file transcription, and
meeting-transcription products. "Whispr Flow" is referred to by its official
name, **Wispr Flow**.

## Market overview

These products fall into three overlapping categories:

1. **System-wide dictation:** Wispr Flow, Willow, Aqua Voice, Superwhisper, and
   VoiceInk.
2. **Recorded-file transcription:** MacWhisper, Superwhisper, VoiceInk, and
   Otter.
3. **Meeting transcription and notetaking:** Otter, Granola, MacWhisper, and
   Superwhisper.

The strongest emerging pattern is a pipeline broader than speech-to-text:

```text
Capture speech
  -> transcribe
  -> clean and structure
  -> adapt to app, context, and style
  -> insert or transform text
  -> preserve history and recovery options
```

## Transcription feature collection

### Wispr Flow

**Product orientation:** Polished, system-wide dictation.

Features:

- Push-to-talk and hands-free capture.
- Automatic punctuation, capitalization, lists, and paragraphs.
- Filler-word cleanup.
- Natural mid-speech corrections, referred to as Backtrack.
- Context-aware casing, spacing, terminology, formatting, and tone.
- Personal and team dictionaries.
- Voice-triggered reusable snippets.
- Selected-text voice commands and inline content generation.
- More than 100 supported dictation languages.
- Developer terminology and syntax handling.
- Code-symbol recognition and file tagging in supported IDEs.
- Transcript history, retry, copy-last, and paste-last recovery.
- Requires an internet connection for transcription.

Sources:

- [Wispr Flow features](https://wisprflow.ai/features)
- [Smart Formatting and Backtrack](https://docs.wisprflow.ai/articles/5373093536-how-do-i-use-smart-formatting-and-backtrack)
- [Context Awareness](https://docs.wisprflow.ai/articles/4678293671-feature-context-awareness)
- [Multiple-language support](https://docs.wisprflow.ai/articles/3191899797-use-flow-with-multiple-languages)
- [Variable Recognition](https://docs.wisprflow.ai/articles/8554805225-variable-recognition)
- [Retry failed transcriptions](https://docs.wisprflow.ai/articles/2503460374-retry-failed-transcriptions)

### Willow

**Product orientation:** Personalized dictation and intent-to-writing.

Features:

- System-wide dictation on Mac, Windows, and iOS.
- Push-to-talk and hands-free recording.
- Automatic punctuation and spacing.
- Automatic paragraph, quotation, numbered-list, and bulleted-list formatting.
- Context-sensitive email formatting.
- Natural spoken correction, such as "no wait, actually..."
- Per-app writing-style matching.
- Personal and team dictionaries.
- Voice-triggered text shortcuts.
- Automatic language detection and support for more than 100 languages.
- Whisper and background-noise handling.
- Transcript history.
- Offline dictation.
- Scribe mode for turning rough intent into finished writing.
- Scribe can use visible context to compose a response.
- Selected-text rewriting, translation, and restructuring.

Sources:

- [Willow product features](https://willowvoice.com/)
- [Voice Commands and Automatic Formatting](https://help.willowvoice.com/en/articles/13183983-voice-commands-and-automatic-formatting-guide)
- [Personalization and Style Matching](https://help.willowvoice.com/en/articles/12864746-personalization-and-style-matching)
- [Personal Dictionary and Shortcuts](https://help.willowvoice.com/en/articles/13183918-using-personal-dictionary-and-shortcuts)
- [Introduction to Scribe](https://help.willowvoice.com/en/articles/15043797-introduction-to-scribe-in-willow)

### Superwhisper

**Product orientation:** Configurable, power-user dictation.

Features:

- Local and cloud speech-recognition models.
- Transcription-only, email, message, meeting, Super, and custom modes.
- More than 100 languages and translation to English.
- Context from the active application, selected text, and clipboard.
- Custom processing instructions and input/output examples.
- Vocabulary hints for recognition.
- Deterministic post-transcription replacements.
- External audio and video file transcription.
- Meeting summaries, decisions, and action items.
- Optional speaker separation.
- Searchable transcription history.
- Side-by-side access to original voice transcription and AI-processed text.
- Inspection of the full AI prompt and captured context.
- Reprocessing previous recordings using a different active mode.
- Toggle recording, push-to-talk, mouse activation, and mode-switch shortcuts.
- Bring-your-own API keys and model providers.

Sources:

- [Superwhisper introduction](https://superwhisper.com/docs/get-started/introduction)
- [Super Mode](https://superwhisper.com/docs/modes/super)
- [Custom Mode](https://superwhisper.com/docs/modes/custom)
- [Meeting Mode](https://superwhisper.com/docs/modes/meeting)
- [Vocabulary](https://superwhisper.com/docs/get-started/interface-vocabulary)
- [History](https://superwhisper.com/docs/get-started/interface-history)
- [File transcription](https://superwhisper.com/docs/get-started/transcribe-files)

### Aqua Voice

**Product orientation:** Fast cloud dictation with an emphasis on developer and
technical language.

Features:

- System-wide dictation on Mac and Windows, plus an iOS voice keyboard.
- Real-time, progressively refined transcription.
- Automatic grammar, punctuation, and paragraph formatting.
- Filler-word removal.
- Deep Context reads visible screen text to disambiguate terminology and adapt
  formatting.
- Recognition of technical and developer vocabulary.
- Custom dictionary.
- Standing writing-style rules and custom instructions.
- Language auto-detection and roughly 49 marketed languages.
- Selected-text Edit Mode for correcting, translating, or reformatting text in
  place.
- Voice-triggered "send it" submission.
- Code-file tagging in Cursor and Windsurf.
- Private local history.
- Audio playback and transcript reprocessing from history.
- Recovery of the unedited base transcript.
- Requires an internet connection.

Sources:

- [Aqua Voice features](https://aquavoice.com/)
- [Aqua Voice FAQ](https://aquavoice.com/info/faq)
- [Language support](https://aquavoice.com/guide/languages)
- [Aqua Voice changelog](https://aquavoice.com/changelog)

### VoiceInk

**Product orientation:** Local-first and highly programmable dictation.

Features:

- Local and optional cloud transcription models.
- Offline transcription with local models.
- Streaming partial transcript display when supported by the selected model.
- Intelligent paragraph breaks.
- Per-app, website, spoken-trigger, and keyboard-shortcut modes.
- AI cleanup, rewriting, email drafting, and question answering.
- Context from selected text, clipboard text, and locally OCR-extracted screen
  text.
- Several output modes:
  - Paste into the active app.
  - Show an assistant response inside the recorder.
  - Auto-send after pasting.
  - Pass the final text to a custom local command.
- Personal dictionary and deterministic word replacements.
- Searchable history with original and enhanced text.
- Saved audio playback, metadata, prompts, and model timing.
- Retry with different models or mode settings.
- Queued audio and video file transcription.
- Toggle, push-to-talk, and hybrid recording shortcuts.

Sources:

- [VoiceInk introduction](https://tryvoiceink.com/docs/introduction)
- [VoiceInk Modes](https://tryvoiceink.com/docs/modes)
- [Mode Triggers](https://tryvoiceink.com/docs/mode-triggers)
- [Mode Settings](https://tryvoiceink.com/docs/mode-settings)
- [Context Awareness](https://tryvoiceink.com/docs/context-awareness)
- [Transcription History](https://tryvoiceink.com/docs/transcription-history)
- [Transcribe Audio Files](https://tryvoiceink.com/docs/transcribe-audio-files)

### MacWhisper

**Product orientation:** Recorded-file, meeting, and system-audio transcription.

Features:

- Drag-and-drop audio and video transcription.
- Local and offline speech-recognition models.
- Microphone recording and transcription.
- Meeting capture for Zoom, Teams, Webex, Skype, Discord, and other apps.
- Application and system-audio capture.
- Real-time dictation.
- Speaker recognition and labeling.
- Filler-word removal.
- Translation.
- YouTube and podcast transcription.
- Batch file transcription.
- Subtitle export.
- Document and structured-text export.
- Optional external AI providers using user-supplied API keys.

Source:

- [MacWhisper features](https://www.macwhisper.com/)

### Otter.ai

**Product orientation:** Collaborative meeting transcription.

Features:

- Live transcription for virtual and in-person meetings.
- Real-time full-screen captions.
- Imported audio and video transcription.
- Speaker recognition that can be trained to recognize specific people.
- Custom names, jargon, and vocabulary.
- Transcript highlights, comments, photos, and assigned tasks.
- Sharing through people and team channels.
- Conversation folders.
- Calendar, contacts, Zoom, and cloud-storage integrations.
- Automated summaries and meeting-assistant workflows.

Source:

- [Otter Quick Start Guide](https://help.otter.ai/hc/en-us/articles/360049722894-Otter-Quick-Start-Guide)

### Granola

**Product orientation:** Bot-free meeting transcription and notes.

Features:

- Captures microphone and system audio without joining as a meeting bot.
- Live meeting transcript panel.
- Speaker tags for supported Google Meet and Zoom configurations.
- Speaker recognition for in-person meetings on iPhone.
- Falls back to "Me" and "Them" based on microphone versus system audio.
- Internal-jargon vocabulary.
- Copy entire transcripts or individual chunks.
- Delete individual transcript chunks.
- AI-generated notes layered over live transcription.
- Does not record or retain meeting audio.
- Does not import prerecorded audio files.
- Meeting capture requires the desktop or iPhone application; its web interface
  only displays and edits existing notes.

Source:

- [How Granola transcription works](https://docs.granola.ai/help-center/taking-notes/transcription)

## Feature taxonomy for a product backlog

### Expected baseline

- System-wide insertion at the active cursor.
- Push-to-talk recording.
- Toggle or hands-free recording.
- Automatic punctuation, capitalization, and spacing.
- Paragraph and list inference.
- Filler-word and false-start removal.
- Natural self-correction while speaking.
- Custom names, acronyms, and technical vocabulary.
- Multiple languages with manual selection and auto-detection.
- Transcript history.
- Copy-last, paste-last, and retry or reprocess actions.
- Visible listening, processing, success, and error states.

### Strong differentiators

- App-aware formatting and tone.
- Nearby-text or screen context for names and terminology.
- Selected-text rewriting by voice.
- Voice-triggered reusable snippets.
- Per-app modes and custom transformation prompts.
- Deterministic replacements alongside probabilistic vocabulary hints.
- Offline and local transcription.
- Developer syntax, identifier, and filename awareness.
- A raw-transcript versus AI-polished-result comparison.
- Spoken submission commands such as "press enter" or "send it."
- Inspectable prompt and context data for troubleshooting.

### Adjacent expansion features

- Audio and video file import.
- Microphone plus system-audio meeting capture.
- Speaker diarization and speaker naming.
- Timestamps and audio-synchronized transcript navigation.
- Summaries, decisions, and action items.
- Subtitle, Markdown, document, and structured-data export.
- Bot-free and meeting-bot capture options.

## Wispr Flow UI behavior inventory

### 1. Two-level desktop interface

Wispr separates frequent interaction from configuration:

- **Flow Bar:** a persistent floating dictation control used for everyday
  recording.
- **Flow Hub:** a full window containing history, statistics, dictionary,
  snippets, style, Scratchpad, and settings.

Right-clicking the Flow Bar exposes quick controls such as:

- Hide for one hour.
- Settings.
- Microphone selection.
- Language selection.
- Transcript history.
- Paste last transcript.

This keeps ordinary dictation one gesture away while moving configuration and
history out of the capture surface.

Source:

- [Navigating the Wispr Flow app](https://docs.wisprflow.ai/articles/5096240724-navigating-the-wispr-flow-app-desktop-ios-and-android)

### 2. Desktop recording state machine

```text
Idle
  |-- hold shortcut ----------------> Push-to-talk listening
  |-- double-tap/shortcut ----------> Hands-free listening
  `-- click Flow Bar ---------------> Hands-free listening

Listening
  |-- animated white bars + ping
  |-- release key / checkmark ------> Processing
  |-- X / Escape -------------------> Cancelled
  `-- session limit ----------------> Automatic submission

Processing
  |-- successful insertion ---------> Idle
  |-- insertion failure ------------> Clipboard fallback
  `-- transcription failure --------> Retry/recovery notification
```

Important interaction details:

- Push-to-talk ends when the activation key is released.
- Double-tapping push-to-talk locks the session into hands-free mode.
- A separate hands-free shortcut is also available.
- Clicking the idle Flow Bar begins hands-free recording.
- Hands-free recording exposes explicit checkmark and cancel buttons.
- Clicking the bar ends a push-to-talk session.
- Clicking the bar itself does not end an active hands-free recording; the user
  must use the checkmark, shortcut, or cancel control.
- Desktop sessions warn at 19 minutes and automatically submit at 20 minutes.
- A forced ending produces a notification with a **Recover text** action.

Sources:

- [Use Flow hands-free](https://docs.wisprflow.ai/articles/6391241694-use-flow-hands-free)
- [Longer dictation sessions](https://docs.wisprflow.ai/articles/4841123325-Longer-dictation-sessions-%E2%80%94-now-up-to-20-minutes)

### 3. Movable and adaptive Flow Bar

- Clicking and dragging the bar reveals three pill-shaped drop zones: bottom,
  left, and right.
- The target drop zone highlights on hover.
- Releasing the bar over a target snaps it into place.
- Pressing Escape cancels a drag and restores the current position.
- Side docking changes the bar to a vertical layout.
- The waveform, progress indicator, pickers, tooltips, and extension pills
  reflow to fit the vertical orientation.
- Menus and tooltips open toward the center of the screen so they remain fully
  visible.
- The chosen position persists across app relaunches and computer restarts.
- Top-edge docking is not supported.

Source:

- [Move and Dock the Flow Bar](https://docs.wisprflow.ai/articles/1790396454-move-and-dock-the-flow-bar-on-desktop)

### 4. Command and transformation feedback

Command Mode uses a separate voice interaction:

- With highlighted text, the result replaces the selection.
- Without selected text, an answer or generated result is inserted at the
  cursor.
- Pressing Escape cancels the command.
- The first activation shows a larger beta notification with a Disable action.
- Later activations use a smaller, less intrusive indicator.
- Voice-requested settings changes produce a notification with an **Apply**
  action and are not committed automatically.
- Dismissing the settings notification cancels the requested change.
- If direct insertion fails, the generated result is placed on the clipboard
  and a notification explains the fallback.
- The replacement can be reverted with the application's normal Undo shortcut.

Source:

- [How to use Command Mode](https://docs.wisprflow.ai/articles/4816967992-how-to-use-command-mode)

### 5. Recovery-oriented behavior

Wispr treats the transcript as recoverable even when transcription or insertion
fails:

- Paste-last and copy-last have global keyboard shortcuts.
- When no text field is focused, a notification offers a **Copy** action.
- After Copy is clicked, its label changes to "Copied!" and the notification
  dismisses.
- Failed audio is preserved locally for retry.
- Retry is accessible from notifications, history, and mobile dictation
  surfaces.
- While retry is processing, starting another desktop dictation shows
  "Transcript currently processing."
- A failed paste leaves the result on the clipboard.
- History exposes an **Undo AI edit** action for recovering the unformatted
  transcript.
- Cancelled and time-limited sessions can expose Undo or Recover actions.

Sources:

- [Retry failed transcriptions](https://docs.wisprflow.ai/articles/2503460374-retry-failed-transcriptions)
- [Supported keyboard shortcuts](https://docs.wisprflow.ai/articles/2612050838-supported-unsupported-keyboard-hotkey-shortcuts)
- [Smart Formatting and Backtrack](https://docs.wisprflow.ai/articles/5373093536-how-do-i-use-smart-formatting-and-backtrack)

### 6. Context and language controls in the capture surface

- The Flow Bar includes a language widget.
- The language menu shows the user's selected languages.
- Languages can be enabled or disabled for the current session.
- "Enable all" and "Add more" actions provide shortcuts to broader language
  configuration.
- Language changes apply to the next dictation without restarting the app.
- A language is detected at the beginning of each session, not per word.
- The active application and nearby text can influence recognition, casing,
  punctuation, and writing style.
- Writing style is selected automatically from four application categories:
  Email, Work messaging, Personal messaging, and Other.

Sources:

- [Multiple-language support](https://docs.wisprflow.ai/articles/3191899797-use-flow-with-multiple-languages)
- [Context Awareness](https://docs.wisprflow.ai/articles/4678293671-feature-context-awareness)

### 7. Android Flow Bubble behavior

The Android surface is strongly context-sensitive:

- The bubble appears when the software keyboard opens.
- It normally hides when the software keyboard closes.
- Tapping begins hands-free recording.
- Long-pressing provides hold-to-dictate behavior.
- During recording, the waveform is visual-only; it is not itself an
  interactive stop target.
- Stopping requires the checkmark.
- After stopping, the checkmark becomes a spinner and only Cancel remains
  available while transcription processes.
- If insertion fails, a Copy button appears beside the bubble.
- The text remains available on the clipboard after a failed paste.
- Dragging the bubble to the bottom of the screen snoozes it for ten minutes.
- Shaking the phone restores a snoozed bubble early.
- It can shrink when idle, shrink to a dot, or shrink automatically in search
  fields.
- Size and opacity are configurable and update visually.
- A pulsing loader means Flow is attempting to reconnect to Android's
  accessibility service.
- A warning triangle means automatic reconnection stalled or permission was
  revoked; tapping it opens the repair flow.
- Failed-paste and failed-transcription states have different tap behavior.
- It hides in password, numeric, and phone fields.
- It disables itself inside supported banking and financial applications.
- It reappears automatically after the user returns to a normal application and
  focuses a standard text field.

Sources:

- [Troubleshooting the Flow Bar and Flow Bubble](https://docs.wisprflow.ai/articles/5002934560-why-is-the-wispr-bar-is-not-appearing-or-disappearing)
- [Use Flow hands-free](https://docs.wisprflow.ai/articles/6391241694-use-flow-hands-free)
- [Banking App Detection](https://docs.wisprflow.ai/articles/4909908692-banking-app-detection-support-in-wispr-flow)

### 8. Mobile platform distinction

Wispr intentionally uses a different capture surface on each platform:

- **Desktop:** floating Flow Bar and global hotkeys.
- **iOS:** custom Flow Keyboard, plus app, Action Button, widget, Shortcut, and
  Siri entry points.
- **Android:** floating Flow Bubble whose visibility follows the software
  keyboard and input-field context.

On iOS:

- The keyboard microphone begins recording.
- Stop completes and inserts the transcription.
- The style pill beside the microphone opens a style menu.
- The active style has a checkmark.
- Some activation paths briefly hand control to the main Flow app because of
  iOS microphone restrictions.

This platform-specific approach is more complex, but it avoids forcing a
desktop interaction model onto mobile devices.

Sources:

- [Navigating the Wispr Flow app](https://docs.wisprflow.ai/articles/5096240724-navigating-the-wispr-flow-app-desktop-ios-and-android)
- [Set up Flow Shortcuts for iPhone](https://docs.wisprflow.ai/articles/1986921789-how-to-set-up-flow-shortcuts-for-iphone)

## Product takeaways

Wispr Flow and Willow optimize for **automatic polish with minimal
configuration**. Superwhisper and VoiceInk expose more of the transcription
pipeline through modes, prompts, context sources, and model choice. Aqua
emphasizes speed, developer terminology, and screen context. MacWhisper, Otter,
and Granola demonstrate the separate requirements of recorded files and
multi-speaker meetings.

A compelling combined feature set would use:

- Wispr Flow's lightweight capture, state feedback, and recovery UI.
- Willow's natural self-correction and intent-based writing.
- Superwhisper and VoiceInk's inspectable, configurable modes.
- Aqua Voice's technical-context handling.
- MacWhisper's file, speaker, and export capabilities.
- Granola's bot-free meeting capture.

