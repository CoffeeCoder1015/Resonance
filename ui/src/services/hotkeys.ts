import type { HotkeyCombo, HotkeyKey, HotkeyModifier } from '../types/desktop';

const KEY_CODES: Record<HotkeyKey, string> = {
  a: 'KeyA',
  b: 'KeyB',
  c: 'KeyC',
  d: 'KeyD',
  e: 'KeyE',
  f: 'KeyF',
  g: 'KeyG',
  h: 'KeyH',
  i: 'KeyI',
  j: 'KeyJ',
  k: 'KeyK',
  l: 'KeyL',
  m: 'KeyM',
  n: 'KeyN',
  o: 'KeyO',
  p: 'KeyP',
  q: 'KeyQ',
  r: 'KeyR',
  s: 'KeyS',
  t: 'KeyT',
  u: 'KeyU',
  v: 'KeyV',
  w: 'KeyW',
  x: 'KeyX',
  y: 'KeyY',
  z: 'KeyZ',
  '0': 'Digit0',
  '1': 'Digit1',
  '2': 'Digit2',
  '3': 'Digit3',
  '4': 'Digit4',
  '5': 'Digit5',
  '6': 'Digit6',
  '7': 'Digit7',
  '8': 'Digit8',
  '9': 'Digit9',
  space: 'Space',
  enter: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  insert: 'Insert',
  delete: 'Delete',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  capslock: 'CapsLock',
  numlock: 'NumLock',
  scrolllock: 'ScrollLock',
  printscreen: 'PrintScreen',
  pause: 'Pause',
  contextmenu: 'ContextMenu',
  semicolon: 'Semicolon',
  equal: 'Equal',
  comma: 'Comma',
  minus: 'Minus',
  period: 'Period',
  slash: 'Slash',
  backquote: 'Backquote',
  bracketleft: 'BracketLeft',
  backslash: 'Backslash',
  bracketright: 'BracketRight',
  quote: 'Quote',
  numpad0: 'Numpad0',
  numpad1: 'Numpad1',
  numpad2: 'Numpad2',
  numpad3: 'Numpad3',
  numpad4: 'Numpad4',
  numpad5: 'Numpad5',
  numpad6: 'Numpad6',
  numpad7: 'Numpad7',
  numpad8: 'Numpad8',
  numpad9: 'Numpad9',
  numpadmultiply: 'NumpadMultiply',
  numpadadd: 'NumpadAdd',
  numpadsubtract: 'NumpadSubtract',
  numpaddecimal: 'NumpadDecimal',
  numpaddivide: 'NumpadDivide',
  numpadenter: 'NumpadEnter',
  f1: 'F1',
  f2: 'F2',
  f3: 'F3',
  f4: 'F4',
  f5: 'F5',
  f6: 'F6',
  f7: 'F7',
  f8: 'F8',
  f9: 'F9',
  f10: 'F10',
  f11: 'F11',
  f12: 'F12',
  f13: 'F13',
  f14: 'F14',
  f15: 'F15',
  f16: 'F16',
  f17: 'F17',
  f18: 'F18',
  f19: 'F19',
  f20: 'F20',
  f21: 'F21',
  f22: 'F22',
  f23: 'F23',
  f24: 'F24',
  volumeup: 'VolumeUp',
  volumedown: 'VolumeDown',
  volumemute: 'VolumeMute',
  mediatracknext: 'MediaTrackNext',
  mediatrackprevious: 'MediaTrackPrevious',
  mediaplaypause: 'MediaPlayPause',
  mediastop: 'MediaStop',
  mediaselect: 'MediaSelect',
  browserback: 'BrowserBack',
  browserforward: 'BrowserForward',
  browserrefresh: 'BrowserRefresh',
  browserstop: 'BrowserStop',
  browsersearch: 'BrowserSearch',
  browserfavorites: 'BrowserFavorites',
  browserhome: 'BrowserHome',
  appmail: 'LaunchMail',
  appcalculator: 'LaunchApp1',
  appmusic: 'LaunchMediaPlayer'
};

const CODE_TO_KEY = Object.fromEntries(
  (Object.entries(KEY_CODES) as [HotkeyKey, string][]).map(([key, code]) => [code, key])
) as Record<string, HotkeyKey>;

export function eventCodeForHotkeyKey(key: HotkeyKey): string {
  return KEY_CODES[key];
}

export function hotkeyKeyFromEventCode(code: string): HotkeyKey | undefined {
  return CODE_TO_KEY[code];
}

export function modifierFromDomKey(key: string): HotkeyModifier | undefined {
  switch (key) {
    case 'Control':
      return 'ctrl';
    case 'Alt':
      return 'alt';
    case 'Shift':
      return 'shift';
    case 'Meta':
      return 'meta';
    default:
      return undefined;
  }
}

export function modifierDomKeyName(modifier: HotkeyModifier): string {
  switch (modifier) {
    case 'ctrl':
      return 'Control';
    case 'alt':
      return 'Alt';
    case 'shift':
      return 'Shift';
    case 'meta':
      return 'Meta';
  }
}

export function domModifiersFromEvent(
  event: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }
): HotkeyModifier[] {
  const modifiers: HotkeyModifier[] = [];
  if (event.ctrlKey) modifiers.push('ctrl');
  if (event.altKey) modifiers.push('alt');
  if (event.shiftKey) modifiers.push('shift');
  if (event.metaKey) modifiers.push('meta');
  return modifiers;
}

export function eventMatchesCombo(
  event: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; code: string },
  combo: HotkeyCombo
): boolean {
  const current = domModifiersFromEvent(event);
  if (
    current.length !== combo.modifiers.length ||
    !combo.modifiers.every(modifier => current.includes(modifier))
  ) {
    return false;
  }
  if (combo.key === undefined) return true;
  return KEY_CODES[combo.key] === event.code;
}

export function eventIsComboMemberKeyUp(
  event: { key: string; code: string },
  combo: HotkeyCombo
): boolean {
  if (combo.key !== undefined) return KEY_CODES[combo.key] === event.code;
  return combo.modifiers.some(modifier => modifierDomKeyName(modifier) === event.key);
}

export function describeCombo(combo: HotkeyCombo): string {
  const modifiers = combo.modifiers.map(modifier => modifierLabel(modifier));
  const key = combo.key === undefined ? [] : [keyLabel(combo.key)];
  return [...modifiers, ...key].join(' + ');
}

export function modifierLabel(modifier: HotkeyModifier): string {
  switch (modifier) {
    case 'ctrl':
      return 'Ctrl';
    case 'alt':
      return 'Alt';
    case 'shift':
      return 'Shift';
    case 'meta':
      return 'Win';
  }
}

export function keyLabel(key: HotkeyKey): string {
  switch (key) {
    case 'space':
      return 'Space';
    case 'enter':
      return 'Enter';
    case 'tab':
      return 'Tab';
    case 'backspace':
      return 'BkSp';
    case 'arrowup':
      return 'Up';
    case 'arrowdown':
      return 'Down';
    case 'arrowleft':
      return 'Left';
    case 'arrowright':
      return 'Right';
    case 'insert':
      return 'Ins';
    case 'delete':
      return 'Del';
    case 'pageup':
      return 'PgUp';
    case 'pagedown':
      return 'PgDn';
    case 'capslock':
      return 'Caps';
    case 'numlock':
      return 'NumLk';
    case 'scrolllock':
      return 'ScrLk';
    case 'printscreen':
      return 'PrtSc';
    case 'pause':
      return 'Pause';
    case 'contextmenu':
      return 'Menu';
    case 'semicolon':
      return ';';
    case 'equal':
      return '=';
    case 'comma':
      return ',';
    case 'minus':
      return '-';
    case 'period':
      return '.';
    case 'slash':
      return '/';
    case 'backquote':
      return '`';
    case 'bracketleft':
      return '[';
    case 'backslash':
      return '\\';
    case 'bracketright':
      return ']';
    case 'quote':
      return "'";
    case 'numpad0':
    case 'numpad1':
    case 'numpad2':
    case 'numpad3':
    case 'numpad4':
    case 'numpad5':
    case 'numpad6':
    case 'numpad7':
    case 'numpad8':
    case 'numpad9':
      return `Num ${key.slice(-1)}`;
    case 'numpadmultiply':
      return 'Num *';
    case 'numpadadd':
      return 'Num +';
    case 'numpadsubtract':
      return 'Num -';
    case 'numpaddecimal':
      return 'Num .';
    case 'numpaddivide':
      return 'Num /';
    case 'numpadenter':
      return 'Num Enter';
    case 'volumeup':
      return 'Vol Up';
    case 'volumedown':
      return 'Vol Dn';
    case 'volumemute':
      return 'Mute';
    case 'mediatracknext':
      return 'Next';
    case 'mediatrackprevious':
      return 'Prev';
    case 'mediaplaypause':
      return 'Play';
    case 'mediastop':
      return 'Stop';
    case 'mediaselect':
      return 'Media';
    case 'browserback':
      return 'Bw Back';
    case 'browserforward':
      return 'Bw Fwd';
    case 'browserrefresh':
      return 'Refresh';
    case 'browserstop':
      return 'Bw Stop';
    case 'browsersearch':
      return 'Search';
    case 'browserfavorites':
      return 'Favs';
    case 'browserhome':
      return 'Bw Home';
    case 'appmail':
      return 'Mail';
    case 'appcalculator':
      return 'Calc';
    case 'appmusic':
      return 'Music';
    default:
      return key.toUpperCase();
  }
}
