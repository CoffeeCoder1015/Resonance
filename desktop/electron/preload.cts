import { contextBridge, ipcRenderer } from 'electron';

type RuntimeCommand =
  | 'toggle-transcription'
  | 'begin-transcription'
  | 'end-transcription'
  | 'begin-hold-to-talk'
  | 'end-hold-to-talk'
  | 'show-expanded';
type RuntimeSnapshot = {
  phase: string;
  pillStatus: 'idle' | 'recording' | 'processing' | 'success' | 'error';
  elapsedSeconds: number;
  visualTheme: string;
};
type AudioLevel = {
  active: boolean;
  level: number;
};
type InsertTextResult =
  | { status: 'inserted' }
  | { status: 'failed'; reason: string };

const CHANNELS = {
  getSnapshot: 'runtime:get-snapshot',
  publishSnapshot: 'runtime:publish-snapshot',
  snapshot: 'runtime:snapshot',
  audioLevel: 'runtime:audio-level',
  command: 'runtime:command',
  pillHover: 'pill:hover',
  beginTextInsertion: 'insertion:begin',
  insertTextAtCaret: 'insertion:insert-at-caret'
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
  publishAudioLevel: (level: AudioLevel) => {
    ipcRenderer.send(CHANNELS.audioLevel, level);
  },
  subscribeAudioLevel: (listener: (level: AudioLevel) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, level: AudioLevel) =>
      listener(level);
    ipcRenderer.on(CHANNELS.audioLevel, handler);
    return () => ipcRenderer.removeListener(CHANNELS.audioLevel, handler);
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
  beginTextInsertion: () =>
    ipcRenderer.invoke(CHANNELS.beginTextInsertion) as Promise<string>,
  insertTextAtCaret: (sessionId: string, text: string) =>
    ipcRenderer.invoke(
      CHANNELS.insertTextAtCaret,
      sessionId,
      text
    ) as Promise<InsertTextResult>
});
