export type PillStatus =
  | 'idle'
  | 'recording'
  | 'processing'
  | 'error';

export interface RuntimeSnapshot {
  visualTheme:
    | 'clay-blob'
    | 'toy-collider'
    | 'memphis-bloom'
    | 'comic-burst'
    | 'superflat-bloom'
    | 'voxel-pulse';
}

export type InsertTextResult =
  | { status: 'inserted' }
  | { status: 'failed'; reason: string };

export type BeginTextInsertionResult =
  | { status: 'ready'; sessionId: string }
  | { status: 'unavailable'; reason: string };

export type RuntimeCommand =
  | 'toggle-transcription'
  | 'begin-transcription'
  | 'end-transcription'
  | 'begin-hold-to-talk'
  | 'end-hold-to-talk'
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
  inWindowHoldToTalk: HotkeyCombo;
}

export type UpdateHotkeysResult =
  | { status: 'ok'; settings: HotkeySettings }
  | { status: 'failed'; reason: string };

export const CHANNELS = {
  getSnapshot: 'runtime:get-snapshot',
  publishSnapshot: 'runtime:publish-snapshot',
  snapshot: 'runtime:snapshot',
  command: 'runtime:command',
  pillHover: 'pill:hover',
  pillStatus: 'pill:status',
  beginTextInsertion: 'insertion:begin',
  insertTextAtCaret: 'insertion:insert-at-caret',
  getHotkeys: 'hotkeys:get',
  updateHotkeys: 'hotkeys:update'
} as const;

export const DEFAULT_SNAPSHOT: RuntimeSnapshot = {
  visualTheme: 'clay-blob'
};

export const DEFAULT_HOTKEYS: HotkeySettings = {
  globalHoldToTalk: { modifiers: ['ctrl', 'meta'] },
  inWindowHoldToTalk: { modifiers: [], key: 'space' }
};
