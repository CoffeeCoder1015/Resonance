import type { PillStatus } from '../components/transcription-pill/pillPresentation';
import type { VisualTheme } from './voice';

export interface DesktopRuntimeSnapshot {
  visualTheme: VisualTheme;
}

export type DesktopRuntimeCommand =
  | 'toggle-transcription'
  | 'begin-transcription'
  | 'end-transcription'
  | 'begin-hold-to-talk'
  | 'end-hold-to-talk'
  | 'show-expanded';

export type BeginTextInsertionResult =
  | { status: 'ready'; sessionId: string }
  | { status: 'unavailable'; reason: string };

export interface ResonanceDesktopBridge {
  isElectron: true;
  getSnapshot(): Promise<DesktopRuntimeSnapshot>;
  publishSnapshot(snapshot: DesktopRuntimeSnapshot): void;
  subscribeSnapshot(listener: (snapshot: DesktopRuntimeSnapshot) => void): () => void;
  publishPillStatus(status: PillStatus): void;
  sendCommand(command: DesktopRuntimeCommand): void;
  subscribeCommand(listener: (command: DesktopRuntimeCommand) => void): () => void;
  subscribePillHover(listener: (hovered: boolean) => void): () => void;
  beginTextInsertion(): Promise<BeginTextInsertionResult>;
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
