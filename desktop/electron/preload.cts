import { contextBridge, ipcRenderer } from 'electron';

type RuntimeCommand =
  | 'toggle-transcription'
  | 'begin-transcription'
  | 'end-transcription'
  | 'begin-hold-to-talk'
  | 'end-hold-to-talk'
  | 'show-expanded';
type RuntimeSnapshot = {
  visualTheme: string;
};
type PillStatus = 'idle' | 'recording' | 'processing' | 'error';
type InsertTextResult =
  | { status: 'inserted' }
    | { status: 'failed'; reason: string }
    | { status: 'cancelled' };
type BeginTextInsertionResult =
  | { status: 'ready'; sessionId: string }
  | { status: 'unavailable'; reason: string };
type TranscriptionAudio = { data: ArrayBuffer; contentType: string };
type ProcessTranscriptionResult =
  | {
      status: 'inserted' | 'copied';
      transcript: string;
      text: string;
      downstream: {
        provider: string;
        status: 'completed' | 'failed';
        error?: string;
      };
      reason?: string;
    }
  | { status: 'failed'; reason: string };
type HotkeyModifier = 'ctrl' | 'alt' | 'shift' | 'meta';
type HotkeyCombo = { modifiers: HotkeyModifier[]; key?: string };
type HotkeySettings = {
  globalHoldToTalk: HotkeyCombo;
  inWindowHoldToTalk: HotkeyCombo;
};
type UpdateHotkeysResult =
  | { status: 'ok'; settings: HotkeySettings }
  | { status: 'failed'; reason: string };
type VoiceInputOwner = 'desktop' | 'pill';

const CHANNELS = {
  getSnapshot: 'runtime:get-snapshot',
  publishSnapshot: 'runtime:publish-snapshot',
  snapshot: 'runtime:snapshot',
  command: 'runtime:command',
  pillHover: 'pill:hover',
  pillStatus: 'pill:status',
  claimVoiceInput: 'voice-input:claim',
  releaseVoiceInput: 'voice-input:release',
  voiceInputRevoked: 'voice-input:revoked',
  voiceInputRevokedAck: 'voice-input:revoked-ack',
  getWindowFocus: 'desktop:get-window-focus',
  windowFocus: 'desktop:window-focus',
  beginTextInsertion: 'insertion:begin',
  cancelTextInsertion: 'insertion:cancel',
  insertTextAtCaret: 'insertion:insert-at-caret',
  processTranscription: 'transcription:process',
  getHotkeys: 'hotkeys:get',
  updateHotkeys: 'hotkeys:update'
} as const;

contextBridge.exposeInMainWorld('resonanceDesktop', {
  isElectron: true,
  getSnapshot: () => ipcRenderer.invoke(CHANNELS.getSnapshot) as Promise<RuntimeSnapshot>,
  publishSnapshot: (snapshot: RuntimeSnapshot) => {
    ipcRenderer.send(CHANNELS.publishSnapshot, snapshot);
  },
  subscribeSnapshot: (listener: (snapshot: RuntimeSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: RuntimeSnapshot) =>
      listener(snapshot);
    ipcRenderer.on(CHANNELS.snapshot, handler);
    return () => ipcRenderer.removeListener(CHANNELS.snapshot, handler);
  },
  publishPillStatus: (status: PillStatus) => {
    ipcRenderer.send(CHANNELS.pillStatus, status);
  },
  claimVoiceInput: (owner: VoiceInputOwner) =>
    ipcRenderer.invoke(CHANNELS.claimVoiceInput, owner) as Promise<boolean>,
  releaseVoiceInput: (owner: VoiceInputOwner) => {
    ipcRenderer.send(CHANNELS.releaseVoiceInput, owner);
  },
  subscribeVoiceInputRevoked: (listener: () => void | Promise<void>) => {
    const handler = async (_event: Electron.IpcRendererEvent, requestId: string) => {
      try {
        await listener();
      } finally {
        ipcRenderer.send(CHANNELS.voiceInputRevokedAck, requestId);
      }
    };
    ipcRenderer.on(CHANNELS.voiceInputRevoked, handler);
    return () => ipcRenderer.removeListener(CHANNELS.voiceInputRevoked, handler);
  },
  sendCommand: (command: RuntimeCommand) => {
    ipcRenderer.send(CHANNELS.command, command);
  },
  subscribeCommand: (listener: (command: RuntimeCommand) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, command: RuntimeCommand) =>
      listener(command);
    ipcRenderer.on(CHANNELS.command, handler);
    return () => ipcRenderer.removeListener(CHANNELS.command, handler);
  },
  subscribePillHover: (listener: (hovered: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, hovered: boolean) =>
      listener(hovered);
    ipcRenderer.on(CHANNELS.pillHover, handler);
    return () => ipcRenderer.removeListener(CHANNELS.pillHover, handler);
  },
  getWindowFocus: () =>
    ipcRenderer.invoke(CHANNELS.getWindowFocus) as Promise<boolean>,
  subscribeWindowFocus: (listener: (focused: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, focused: boolean) =>
      listener(focused);
    ipcRenderer.on(CHANNELS.windowFocus, handler);
    return () => ipcRenderer.removeListener(CHANNELS.windowFocus, handler);
  },
  beginTextInsertion: () =>
    ipcRenderer.invoke(CHANNELS.beginTextInsertion) as Promise<BeginTextInsertionResult>,
  cancelTextInsertion: (sessionId: string) => {
    ipcRenderer.send(CHANNELS.cancelTextInsertion, sessionId);
  },
  insertTextAtCaret: (sessionId: string, text: string) =>
    ipcRenderer.invoke(
      CHANNELS.insertTextAtCaret,
      sessionId,
      text
    ) as Promise<InsertTextResult>,
  processTranscription: (sessionId: string, audio: TranscriptionAudio) =>
    ipcRenderer.invoke(
      CHANNELS.processTranscription,
      sessionId,
      audio
    ) as Promise<ProcessTranscriptionResult>,
  getHotkeys: () => ipcRenderer.invoke(CHANNELS.getHotkeys) as Promise<HotkeySettings>,
  updateHotkeys: (settings: HotkeySettings) =>
    ipcRenderer.invoke(CHANNELS.updateHotkeys, settings) as Promise<UpdateHotkeysResult>
});
