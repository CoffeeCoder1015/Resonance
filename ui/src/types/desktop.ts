import type { PillStatus } from '../components/transcription-pill/pillPresentation';
import type { VisualTheme } from './voice';

export interface DesktopRuntimeSnapshot {
  visualTheme: VisualTheme;
}

export type DesktopRuntimeCommand =
  | 'toggle-transcription'
  | 'begin-transcription'
  | 'end-transcription'
  | 'show-expanded';


export type HotkeyModifier = 'ctrl' | 'alt' | 'shift' | 'meta';

export type HotkeyKey =
  | 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j'
  | 'k' | 'l' | 'm' | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't'
  | 'u' | 'v' | 'w' | 'x' | 'y' | 'z'
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | 'space' | 'enter' | 'tab' | 'backspace'
  | 'arrowup' | 'arrowdown' | 'arrowleft' | 'arrowright'
  | 'insert' | 'delete' | 'home' | 'end' | 'pageup' | 'pagedown'
  | 'capslock' | 'numlock' | 'scrolllock' | 'printscreen' | 'pause' | 'contextmenu'
  | 'semicolon' | 'equal' | 'comma' | 'minus' | 'period' | 'slash'
  | 'backquote' | 'bracketleft' | 'backslash' | 'bracketright' | 'quote'
  | 'numpad0' | 'numpad1' | 'numpad2' | 'numpad3' | 'numpad4'
  | 'numpad5' | 'numpad6' | 'numpad7' | 'numpad8' | 'numpad9'
  | 'numpadmultiply' | 'numpadadd' | 'numpadsubtract' | 'numpaddecimal'
  | 'numpaddivide' | 'numpadenter'
  | 'f1' | 'f2' | 'f3' | 'f4' | 'f5' | 'f6'
  | 'f7' | 'f8' | 'f9' | 'f10' | 'f11' | 'f12'
  | 'f13' | 'f14' | 'f15' | 'f16' | 'f17' | 'f18'
  | 'f19' | 'f20' | 'f21' | 'f22' | 'f23' | 'f24'
  | 'volumeup' | 'volumedown' | 'volumemute'
  | 'mediatracknext' | 'mediatrackprevious' | 'mediaplaypause' | 'mediastop' | 'mediaselect'
  | 'browserback' | 'browserforward' | 'browserrefresh' | 'browserstop'
  | 'browsersearch' | 'browserfavorites' | 'browserhome'
  | 'appmail' | 'appcalculator' | 'appmusic';

export interface HotkeyCombo {
  modifiers: HotkeyModifier[];
  key?: HotkeyKey;
}

export interface HotkeySettings {
  globalHoldToTalk: HotkeyCombo;
}

export type UpdateHotkeysResult =
  | { status: 'ok'; settings: HotkeySettings }
  | { status: 'failed'; reason: string };

export const DEFAULT_HOTKEYS: HotkeySettings = {
  globalHoldToTalk: { modifiers: ['ctrl', 'meta'] }
};

export type BeginTextInsertionResult =
  | { status: 'ready'; sessionId: string }
  | { status: 'unavailable'; reason: string };

export interface TranscriptionAudio {
  data: ArrayBuffer;
  contentType: string;
}

export type ProcessTranscriptionResult =
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
  | { status: 'failed'; reason: string }
  | { status: 'cancelled' };

export interface ResonanceDesktopBridge {
  isElectron: true;
  getSnapshot(): Promise<DesktopRuntimeSnapshot>;
  publishSnapshot(snapshot: DesktopRuntimeSnapshot): void;
  subscribeSnapshot(listener: (snapshot: DesktopRuntimeSnapshot) => void): () => void;
  publishPillStatus(status: PillStatus): void;
  sendCommand(command: DesktopRuntimeCommand): void;
  subscribeCommand(listener: (command: DesktopRuntimeCommand) => void): () => void;
  subscribePillHover(listener: (hovered: boolean) => void): () => void;
  getWindowFocus(): Promise<boolean>;
  subscribeWindowFocus(listener: (focused: boolean) => void): () => void;
  beginTextInsertion(): Promise<BeginTextInsertionResult>;
  cancelTextInsertion(sessionId: string): void;
  insertTextAtCaret(
    sessionId: string,
    text: string
  ): Promise<{ status: 'inserted' | 'failed'; reason?: string }>;
  processTranscription(
    sessionId: string,
    audio: TranscriptionAudio
  ): Promise<ProcessTranscriptionResult>;
  getHotkeys(): Promise<HotkeySettings>;
  updateHotkeys(settings: HotkeySettings): Promise<UpdateHotkeysResult>;
}

declare global {
  interface Window {
    resonanceDesktop?: ResonanceDesktopBridge;
  }
}
