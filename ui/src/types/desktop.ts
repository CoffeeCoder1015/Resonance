import type { PillStatus } from '../components/transcription-pill/pillPresentation';
import type { VoicePhase, VisualTheme } from './voice';

export interface DesktopRuntimeSnapshot {
  phase: VoicePhase;
  pillStatus: PillStatus;
  elapsedSeconds: number;
  visualTheme: VisualTheme;
}

export interface DesktopAudioLevel {
  active: boolean;
  level: number;
}

export type DesktopRuntimeCommand =
  | 'toggle-transcription'
  | 'begin-transcription'
  | 'end-transcription'
  | 'begin-hold-to-talk'
  | 'end-hold-to-talk'
  | 'show-expanded';

export interface ResonanceDesktopBridge {
  isElectron: true;
  getSnapshot(): Promise<DesktopRuntimeSnapshot>;
  publishSnapshot(snapshot: DesktopRuntimeSnapshot): void;
  subscribeSnapshot(listener: (snapshot: DesktopRuntimeSnapshot) => void): () => void;
  publishAudioLevel(level: DesktopAudioLevel): void;
  subscribeAudioLevel(listener: (level: DesktopAudioLevel) => void): () => void;
  sendCommand(command: DesktopRuntimeCommand): void;
  subscribeCommand(listener: (command: DesktopRuntimeCommand) => void): () => void;
  subscribePillHover(listener: (hovered: boolean) => void): () => void;
  beginTextInsertion(): Promise<string>;
  insertTextAtCaret(
    sessionId: string,
    text: string
  ): Promise<{ status: 'inserted' | 'failed'; reason?: string }>;
}

declare global {
  interface Window {
    resonanceDesktop?: ResonanceDesktopBridge;
  }
}
