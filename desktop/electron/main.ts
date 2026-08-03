import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  protocol,
  screen,
  session,
  Tray
} from 'electron';
import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi';
import {
  CHANNELS,
  DEFAULT_HOTKEYS,
  DEFAULT_SNAPSHOT,
  type BeginTextInsertionResult,
  type HotkeyCombo,
  type HotkeyKey,
  type HotkeyModifier,
  type HotkeySettings,
  type InsertTextResult,
  type PillStatus,
  type RuntimeCommand,
  type RuntimeSnapshot,
  type UpdateHotkeysResult
} from './contract.js';
import { installAppProtocol } from './protocol.js';
import {
  createExpandedWindow,
  createPillWindow,
  positionPill,
  preloadPath
} from './windows.js';
import {
  getForegroundTarget,
  pasteTextViaClipboard,
  type ForegroundTarget
} from './windows-text-insertion.js';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'resonance',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

const directory = path.dirname(fileURLToPath(import.meta.url));
let expandedWindow: BrowserWindow | null = null;
let pillWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let snapshot: RuntimeSnapshot = DEFAULT_SNAPSHOT;
let pillStatus: PillStatus = 'idle';
let pillHovered = false;
let pillHoverTimer: NodeJS.Timeout | null = null;
let pillIgnoresMouseEvents = false;
const insertionTargets = new Map<string, StoredInsertionTarget>();

const IDLE_PILL_HIT_WIDTH = 48;
const IDLE_PILL_HIT_HEIGHT = 48;
const HOVERED_IDLE_HIT_WIDTH = 184;
const ACTIVE_PILL_HIT_WIDTH = 280;
const EXPANDED_PILL_HIT_HEIGHT = 56;
const EXPANDED_PILL_CENTER_OFFSET_X = -26;
const INSERTION_SESSION_MAX_AGE_MS = 10 * 60_000;

const MODIFIER_ORDER: Record<HotkeyModifier, number> = {
  ctrl: 0,
  alt: 1,
  shift: 2,
  meta: 3
};

const MODIFIER_KEYCODES: Record<HotkeyModifier, number[]> = {
  ctrl: [UiohookKey.Ctrl, UiohookKey.CtrlRight],
  alt: [UiohookKey.Alt, UiohookKey.AltRight],
  shift: [UiohookKey.Shift, UiohookKey.ShiftRight],
  meta: [UiohookKey.Meta, UiohookKey.MetaRight]
};

const EXTENDED_KEYCODES: Record<string, number> = {
  pause: 0x0e45,
  contextmenu: 0x0e5d,
  volumeup: 0xe030,
  volumedown: 0xe02e,
  volumemute: 0xe020,
  mediatracknext: 0xe019,
  mediatrackprevious: 0xe010,
  mediaplaypause: 0xe022,
  mediastop: 0xe024,
  mediaselect: 0xe06d,
  browserback: 0xe06a,
  browserforward: 0xe069,
  browserrefresh: 0xe067,
  browserstop: 0xe068,
  browsersearch: 0xe065,
  browserfavorites: 0xe066,
  browserhome: 0xe032,
  appmail: 0xe06c,
  appcalculator: 0xe021,
  appmusic: 0xe03c
};

function buildKeyKeycodes(): Record<HotkeyKey, number[]> {
  const result = {} as Record<HotkeyKey, number[]>;
  const single = (keycode: number) => [keycode];

  for (const key of 'abcdefghijklmnopqrstuvwxyz0123456789') {
    result[key as HotkeyKey] = single((UiohookKey as Record<string, number>)[key.toUpperCase()]);
  }
  for (let index = 1; index <= 24; index += 1) {
    result[`f${index}` as HotkeyKey] = single(
      (UiohookKey as Record<string, number>)[`F${index}`]
    );
  }

  result.space = single(UiohookKey.Space);
  result.enter = single(UiohookKey.Enter);
  result.tab = single(UiohookKey.Tab);
  result.backspace = single(UiohookKey.Backspace);
  result.arrowup = single(UiohookKey.ArrowUp);
  result.arrowdown = single(UiohookKey.ArrowDown);
  result.arrowleft = single(UiohookKey.ArrowLeft);
  result.arrowright = single(UiohookKey.ArrowRight);
  result.insert = single(UiohookKey.Insert);
  result.delete = single(UiohookKey.Delete);
  result.home = single(UiohookKey.Home);
  result.end = single(UiohookKey.End);
  result.pageup = single(UiohookKey.PageUp);
  result.pagedown = single(UiohookKey.PageDown);
  result.capslock = single(UiohookKey.CapsLock);
  result.numlock = single(UiohookKey.NumLock);
  result.scrolllock = single(UiohookKey.ScrollLock);
  result.printscreen = single(UiohookKey.PrintScreen);
  result.semicolon = single(UiohookKey.Semicolon);
  result.equal = single(UiohookKey.Equal);
  result.comma = single(UiohookKey.Comma);
  result.minus = single(UiohookKey.Minus);
  result.period = single(UiohookKey.Period);
  result.slash = single(UiohookKey.Slash);
  result.backquote = single(UiohookKey.Backquote);
  result.bracketleft = single(UiohookKey.BracketLeft);
  result.backslash = single(UiohookKey.Backslash);
  result.bracketright = single(UiohookKey.BracketRight);
  result.quote = single(UiohookKey.Quote);

  for (let digit = 0; digit <= 9; digit += 1) {
    const keycode = (UiohookKey as Record<string, number>)[`Numpad${digit}`];
    result[`numpad${digit}` as HotkeyKey] = [keycode, 0xee00 | keycode];
  }
  result.numpadmultiply = single(UiohookKey.NumpadMultiply);
  result.numpadadd = single(UiohookKey.NumpadAdd);
  result.numpadsubtract = single(UiohookKey.NumpadSubtract);
  result.numpaddecimal = single(UiohookKey.NumpadDecimal);
  result.numpaddivide = single(UiohookKey.NumpadDivide);
  result.numpadenter = single(UiohookKey.NumpadEnter);

  for (const [key, keycode] of Object.entries(EXTENDED_KEYCODES)) {
    result[key as HotkeyKey] = single(keycode);
  }
  return result;
}

const KEY_KEYCODES = buildKeyKeycodes();

let hotkeys: HotkeySettings = DEFAULT_HOTKEYS;
let globalHotkeyActive = false;
let globalHotkeyHookStarted = false;
const pressedHotkeyKeycodes = new Set<number>();

interface StoredInsertionTarget {
  target: ForegroundTarget;
  createdAt: number;
}

function observeRenderer(label: 'desktop' | 'pill', window: BrowserWindow) {
  const contents = window.webContents;

  contents.on('did-finish-load', () => {
    console.info(`[renderer:${label}] loaded ${contents.getURL()}`);
  });
  contents.on('console-message', details => {
    const location = details.sourceId
      ? ` (${details.sourceId}:${details.lineNumber})`
      : '';
    if (details.level === 'warning') {
      console.warn(`[renderer:${label}] ${details.message}${location}`);
    } else if (details.level === 'error') {
      console.error(`[renderer:${label}] ${details.message}${location}`);
    }
  });
  contents.on('preload-error', (_event, failedPreloadPath, error) => {
    console.error(`[renderer:${label}:preload] ${failedPreloadPath}`, error);
  });
  contents.on('render-process-gone', (_event, details) => {
    console.error(`[renderer:${label}:gone]`, details);
  });
  contents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      console.error(
        `[renderer:${label}:load] ${errorCode} ${errorDescription} ${validatedURL}`
      );
    }
  );
}

async function beginTextInsertion(): Promise<string> {
  if (process.platform !== 'win32') {
    throw new Error('Automatic text insertion is currently supported on Windows only.');
  }

  const target = await getForegroundTarget();
  if (!target) {
    throw new Error('The active application could not be identified.');
  }
  if (target.processId === process.pid) {
    throw new Error('Focus an external application before starting transcription.');
  }

  const sessionId = `insertion_${randomUUID()}`;
  insertionTargets.clear();
  insertionTargets.set(sessionId, {
    target,
    createdAt: Date.now()
  });
  console.info('[text-insertion] Captured target.', {
    sessionId,
    windowHandle: target.windowHandle,
    processId: target.processId
  });
  return sessionId;
}

async function insertTextAtCaret(
  sessionId: unknown,
  text: unknown
): Promise<InsertTextResult> {
  if (typeof sessionId !== 'string') {
    return { status: 'failed', reason: 'The insertion session is invalid.' };
  }
  if (typeof text !== 'string' || text.length === 0) {
    return { status: 'failed', reason: 'There is no transcription text to insert.' };
  }

  const stored = insertionTargets.get(sessionId);
  insertionTargets.delete(sessionId);
  if (!stored) {
    return {
      status: 'failed',
      reason: 'The insertion session expired or was already used.'
    };
  }
  if (Date.now() - stored.createdAt > INSERTION_SESSION_MAX_AGE_MS) {
    return { status: 'failed', reason: 'The insertion session expired.' };
  }

  try {
    console.info('[text-insertion] Insertion requested.', {
      sessionId,
      textCodeUnits: text.length,
      textUtf8Bytes: Buffer.byteLength(text, 'utf8'),
      sessionAgeMs: Date.now() - stored.createdAt,
      expectedWindowHandle: stored.target.windowHandle,
      expectedProcessId: stored.target.processId
    });
    const foreground = await getForegroundTarget();
    console.info('[text-insertion] Foreground target checked.', {
      expected: stored.target,
      actual: foreground,
      matches:
        foreground?.windowHandle === stored.target.windowHandle &&
        foreground?.processId === stored.target.processId
    });
    if (
      !foreground ||
      foreground.windowHandle !== stored.target.windowHandle ||
      foreground.processId !== stored.target.processId
    ) {
      return {
        status: 'failed',
        reason: 'The active application changed before transcription completed.'
      };
    }

    const result = await pasteTextViaClipboard(stored.target, text);
    console.info('[text-insertion] Native helper completed.', result);
    if (result.status === 'inserted') {
      console.info('[text-insertion] Paste completed.', {
        clipboardRestore: result.clipboardRestore,
        diagnostics: result.diagnostics
      });
      return { status: 'inserted' };
    }
    if (result.status === 'modifiers-held') {
      return {
        status: 'failed',
        reason: 'Release Ctrl, Windows, Alt, and Shift before inserting text.'
      };
    }
    if (result.status === 'target-changed') {
      return {
        status: 'failed',
        reason: 'The active application changed immediately before insertion.'
      };
    }
    if (result.status === 'restore-failed') {
      return {
        status: 'failed',
        reason:
          'The text was pasted, but the previous clipboard contents could not be restored.'
      };
    }
    if (result.status === 'clipboard-failed') {
      return {
        status: 'failed',
        reason:
          result.nativeError === 0
            ? 'The Windows clipboard is unavailable.'
            : `The Windows clipboard could not be accessed (error ${result.nativeError}).`
      };
    }
    if (result.status === 'paste-timeout') {
      return {
        status: 'failed',
        reason:
          'Windows accepted the paste shortcut, but the target did not request the transcript from the clipboard.'
      };
    }
    return {
      status: 'failed',
      reason:
        result.nativeError === 0
          ? 'Windows blocked the paste shortcut, possibly because the target runs at a higher integrity level.'
          : `Windows paste failed with error ${result.nativeError}. SendInput accepted ${result.diagnostics.sent ?? '?'} of ${result.diagnostics.requested ?? '4'} events using INPUT size ${result.diagnostics.inputSize ?? '?'} on a ${result.diagnostics.pointerSize === '8' ? '64-bit' : '32-bit'} process.`
    };
  } catch (error) {
    console.error('[text-insertion] Clipboard text insertion failed.', {
      sessionId,
      expectedTarget: stored.target,
      error
    });
    return {
      status: 'failed',
      reason: error instanceof Error ? error.message : 'Clipboard text insertion failed.'
    };
  }
}

interface PillPosition {
  x: number;
  y: number;
}

function pillPositionPath() {
  return path.join(app.getPath('userData'), 'pill-position.json');
}

function readPillPosition(): PillPosition | null {
  try {
    const value = JSON.parse(readFileSync(pillPositionPath(), 'utf8')) as Partial<PillPosition>;
    if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
    return { x: value.x as number, y: value.y as number };
  } catch {
    return null;
  }
}

function savePillPosition(window: BrowserWindow) {
  const { x, y } = window.getBounds();
  writeFileSync(pillPositionPath(), JSON.stringify({ x, y }));
}

function pillIsVisible(window: BrowserWindow) {
  const bounds = window.getBounds();
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapWidth =
      Math.min(bounds.x + bounds.width, workArea.x + workArea.width) -
      Math.max(bounds.x, workArea.x);
    const overlapHeight =
      Math.min(bounds.y + bounds.height, workArea.y + workArea.height) -
      Math.max(bounds.y, workArea.y);
    return overlapWidth >= 80 && overlapHeight >= 40;
  });
}

function ensurePillVisible() {
  if (!pillWindow || pillIsVisible(pillWindow)) return;
  positionPill(pillWindow);
}

function rendererRoots() {
  if (app.isPackaged) {
    const root = path.join(process.resourcesPath, 'app', 'ui');
    return { main: path.join(root, 'dist'), pill: path.join(root, 'dist-pill') };
  }
  const uiRoot = path.resolve(directory, '..', '..', 'ui');
  return { main: path.join(uiRoot, 'dist'), pill: path.join(uiRoot, 'dist-pill') };
}

function showExpanded() {
  expandedWindow?.show();
  expandedWindow?.focus();
}

function hotkeysPath() {
  return path.join(app.getPath('userData'), 'hotkeys.json');
}

function describeCombo(combo: HotkeyCombo) {
  const modifiers = combo.modifiers.map(modifier => modifier.toUpperCase()).join('+');
  return combo.key === undefined ? modifiers : `${modifiers}+${combo.key.toUpperCase()}`;
}

function normalizeCombo(value: unknown, allowNoModifier: boolean): HotkeyCombo | null {
  if (!value || typeof value !== 'object') return null;
  const combo = value as Partial<HotkeyCombo>;
  if (!Array.isArray(combo.modifiers)) return null;

  const modifiers: HotkeyModifier[] = [];
  for (const modifier of combo.modifiers) {
    if (
      modifier !== 'ctrl' &&
      modifier !== 'alt' &&
      modifier !== 'shift' &&
      modifier !== 'meta'
    ) {
      return null;
    }
    if (!modifiers.includes(modifier)) modifiers.push(modifier);
  }
  modifiers.sort((a, b) => MODIFIER_ORDER[a] - MODIFIER_ORDER[b]);

  let key: HotkeyKey | undefined;
  if (combo.key !== undefined) {
    if (typeof combo.key !== 'string' || !(combo.key in KEY_KEYCODES)) return null;
    key = combo.key as HotkeyKey;
  }

  if (modifiers.length === 0 && key === undefined) return null;
  if (!allowNoModifier && modifiers.length === 0) return null;
  return { modifiers, key };
}

function combosEqual(a: HotkeyCombo, b: HotkeyCombo) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalizeHotkeys(value: unknown): HotkeySettings | null {
  if (!value || typeof value !== 'object') return null;
  const settings = value as Partial<HotkeySettings>;
  const globalHoldToTalk = normalizeCombo(settings.globalHoldToTalk, false);
  const inWindowHoldToTalk = normalizeCombo(settings.inWindowHoldToTalk, true);
  if (!globalHoldToTalk || !inWindowHoldToTalk) return null;
  if (combosEqual(globalHoldToTalk, inWindowHoldToTalk)) return null;
  return { globalHoldToTalk, inWindowHoldToTalk };
}

function loadHotkeys(): HotkeySettings {
  try {
    const parsed = JSON.parse(readFileSync(hotkeysPath(), 'utf8'));
    return normalizeHotkeys(parsed) ?? DEFAULT_HOTKEYS;
  } catch {
    return DEFAULT_HOTKEYS;
  }
}

function saveHotkeys(settings: HotkeySettings) {
  writeFileSync(hotkeysPath(), JSON.stringify(settings, null, 2));
}

function comboIsHeld(combo: HotkeyCombo) {
  for (const modifier of combo.modifiers) {
    if (!MODIFIER_KEYCODES[modifier].some(code => pressedHotkeyKeycodes.has(code))) {
      return false;
    }
  }
  if (combo.key === undefined) return true;
  return KEY_KEYCODES[combo.key].some(code => pressedHotkeyKeycodes.has(code));
}

function applyHotkeys(settings: HotkeySettings) {
  hotkeys = settings;
  saveHotkeys(settings);
  pressedHotkeyKeycodes.clear();
  if (globalHotkeyActive) {
    globalHotkeyActive = false;
    pillWindow?.webContents.send(CHANNELS.command, 'end-transcription');
  }
  console.info(`Global hold-to-talk hotkey: ${describeCombo(hotkeys.globalHoldToTalk)}`);
}

function installGlobalHotkey() {
  if (globalHotkeyHookStarted) return;
  globalHotkeyHookStarted = true;

  const handleKeyDown = (event: UiohookKeyboardEvent) => {
    pressedHotkeyKeycodes.add(event.keycode);
    if (globalHotkeyActive || !comboIsHeld(hotkeys.globalHoldToTalk)) return;
    globalHotkeyActive = true;
    pillWindow?.webContents.send(CHANNELS.command, 'begin-transcription');
  };
  const handleKeyUp = (event: UiohookKeyboardEvent) => {
    pressedHotkeyKeycodes.delete(event.keycode);
    if (!globalHotkeyActive || comboIsHeld(hotkeys.globalHoldToTalk)) return;
    globalHotkeyActive = false;
    pillWindow?.webContents.send(CHANNELS.command, 'end-transcription');
  };

  uIOhook.on('keydown', handleKeyDown);
  uIOhook.on('keyup', handleKeyUp);
  uIOhook.start();
  console.info(`Registered global hold-to-talk hotkey: ${describeCombo(hotkeys.globalHoldToTalk)}`);
}

function uninstallGlobalHotkey() {
  pressedHotkeyKeycodes.clear();
  if (globalHotkeyActive) {
    globalHotkeyActive = false;
    pillWindow?.webContents.send(CHANNELS.command, 'end-transcription');
  }
  uIOhook.stop();
  globalHotkeyHookStarted = false;
}

function setPillHovered(hovered: boolean) {
  if (pillHovered === hovered) return;
  pillHovered = hovered;
  pillWindow?.webContents.send(CHANNELS.pillHover, hovered);
}

function setPillIgnoresMouseEvents(ignoresMouseEvents: boolean) {
  if (!pillWindow || pillIgnoresMouseEvents === ignoresMouseEvents) return;
  pillIgnoresMouseEvents = ignoresMouseEvents;
  pillWindow.setIgnoreMouseEvents(ignoresMouseEvents, { forward: true });
}

function startPillHoverTracking() {
  if (pillHoverTimer) clearInterval(pillHoverTimer);
  pillHoverTimer = setInterval(() => {
    if (!pillWindow?.isVisible()) return;
    const cursor = screen.getCursorScreenPoint();
    const bounds = pillWindow.getBounds();
    const interactionWidth =
      pillStatus === 'idle'
        ? pillHovered
          ? HOVERED_IDLE_HIT_WIDTH
          : IDLE_PILL_HIT_WIDTH
        : ACTIVE_PILL_HIT_WIDTH;
    const interactionHeight =
      pillStatus === 'idle'
        ? pillHovered
          ? EXPANDED_PILL_HIT_HEIGHT
          : IDLE_PILL_HIT_HEIGHT
        : EXPANDED_PILL_HIT_HEIGHT;
    const interactionCenterOffsetX =
      pillStatus === 'idle' && !pillHovered
        ? 0
        : EXPANDED_PILL_CENTER_OFFSET_X;
    const interactionLeft =
      bounds.x + (bounds.width - interactionWidth) / 2 + interactionCenterOffsetX;
    const interactionTop = bounds.y + (bounds.height - interactionHeight) / 2;
    const insideInteractionBounds =
      cursor.x >= interactionLeft &&
      cursor.x < interactionLeft + interactionWidth &&
      cursor.y >= interactionTop &&
      cursor.y < interactionTop + interactionHeight;

    setPillIgnoresMouseEvents(!insideInteractionBounds);
    setPillHovered(insideInteractionBounds);
  }, 50);
}

async function createTray() {
  const icon = await app.getFileIcon(process.execPath, { size: 'small' });
  tray = new Tray(icon);
  tray.setToolTip('Resonance');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Resonance', click: showExpanded },
      {
        label: 'Show transcription pill',
        click: () => {
          if (!pillWindow) return;
          ensurePillVisible();
          pillWindow.showInactive();
        }
      },
      { label: 'Hide transcription pill', click: () => pillWindow?.hide() },
      { type: 'separator' },
      {
        label: 'Quit Resonance',
        click: () => {
          quitting = true;
          app.quit();
        }
      }
    ])
  );
  tray.on('double-click', showExpanded);
}

function installIpc() {
  ipcMain.handle(CHANNELS.getSnapshot, () => snapshot);
  ipcMain.handle(CHANNELS.beginTextInsertion, async event => {
    if (event.sender !== pillWindow?.webContents) {
      return {
        status: 'unavailable',
        reason: 'Text insertion may only be started by the transcription pill.'
      } satisfies BeginTextInsertionResult;
    }
    try {
      return {
        status: 'ready',
        sessionId: await beginTextInsertion()
      } satisfies BeginTextInsertionResult;
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'The insertion target is unavailable.';
      console.warn(`[text-insertion] ${reason}`);
      return {
        status: 'unavailable',
        reason
      } satisfies BeginTextInsertionResult;
    }
  });
  ipcMain.handle(
    CHANNELS.insertTextAtCaret,
    (event, sessionId: unknown, text: unknown) => {
      if (event.sender !== pillWindow?.webContents) {
        return {
          status: 'failed',
          reason: 'Text insertion may only be requested by the transcription pill.'
        } satisfies InsertTextResult;
      }
      return insertTextAtCaret(sessionId, text);
    }
  );
  ipcMain.on(CHANNELS.publishSnapshot, (event, nextSnapshot: RuntimeSnapshot) => {
    if (event.sender !== expandedWindow?.webContents) return;
    snapshot = nextSnapshot;
    pillWindow?.webContents.send(CHANNELS.snapshot, snapshot);
  });
  ipcMain.handle(CHANNELS.getHotkeys, () => hotkeys);
  ipcMain.handle(CHANNELS.updateHotkeys, (_event, value: unknown) => {
    if (_event.sender !== expandedWindow?.webContents) {
      return {
        status: 'failed',
        reason: 'Shortcuts may only be changed by the expanded Resonance window.'
      } satisfies UpdateHotkeysResult;
    }
    const next = normalizeHotkeys(value);
    if (!next) {
      return {
        status: 'failed',
        reason: 'That shortcut is not valid. Use at least one modifier for the global hotkey, and pick a shortcut that differs from the other.'
      } satisfies UpdateHotkeysResult;
    }
    applyHotkeys(next);
    return { status: 'ok', settings: hotkeys } satisfies UpdateHotkeysResult;
  });
  ipcMain.on(CHANNELS.pillStatus, (event, nextStatus: unknown) => {
    if (event.sender !== pillWindow?.webContents) return;
    if (!['idle', 'recording', 'processing', 'error'].includes(String(nextStatus))) return;
    pillStatus = nextStatus as PillStatus;
  });
  ipcMain.on(CHANNELS.command, (event, command: RuntimeCommand) => {
    if (event.sender !== pillWindow?.webContents) return;
    if (command === 'show-expanded') {
      showExpanded();
      return;
    }
  });
}

async function loadWindows() {
  const preload = preloadPath(directory);
  expandedWindow = createExpandedWindow(preload);
  pillWindow = createPillWindow(preload);
  observeRenderer('desktop', expandedWindow);
  observeRenderer('pill', pillWindow);

  expandedWindow.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    expandedWindow?.hide();
  });
  pillWindow.on('close', event => {
    if (quitting) return;
    event.preventDefault();
  });
  pillWindow.on('moved', () => {
    if (pillWindow) savePillPosition(pillWindow);
  });

  const mainDevUrl = process.env.RESONANCE_MAIN_DEV_URL;
  const pillDevUrl = process.env.RESONANCE_PILL_DEV_URL;
  if (mainDevUrl && pillDevUrl) {
    await Promise.all([
      expandedWindow.loadURL(mainDevUrl),
      pillWindow.loadURL(pillDevUrl)
    ]);
  } else {
    await Promise.all([
      expandedWindow.loadURL('resonance://app/index.html'),
      pillWindow.loadURL('resonance://app/pill.html')
    ]);
  }

  const savedPosition = readPillPosition();
  if (savedPosition) {
    pillWindow.setPosition(savedPosition.x, savedPosition.y, false);
    ensurePillVisible();
  } else {
    positionPill(pillWindow);
  }
  startPillHoverTracking();
  expandedWindow.show();
  pillWindow.showInactive();
}

function installPermissionPolicy() {
  const isTrustedOrigin = (url: string) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'resonance:' && parsed.host === 'app') return true;
      return (
        !app.isPackaged &&
        parsed.protocol === 'http:' &&
        parsed.hostname === '127.0.0.1'
      );
    } catch {
      return false;
    }
  };
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin) => {
      const origin = requestingOrigin || webContents?.getURL() || '';
      const allowed = permission === 'media' && isTrustedOrigin(origin);
      return allowed;
    }
  );
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      const origin = webContents.getURL();
      const allowed = permission === 'media' && isTrustedOrigin(origin);
      callback(allowed);
    }
  );
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', showExpanded);
  app.on('before-quit', () => {
    quitting = true;
    insertionTargets.clear();
    if (pillHoverTimer) clearInterval(pillHoverTimer);
    uninstallGlobalHotkey();
  });
  app.on('window-all-closed', () => {
    // The tray process owns application lifetime; only the explicit tray Quit exits.
  });

  void app.whenReady().then(async () => {
    const roots = rendererRoots();
    installAppProtocol(roots.main, roots.pill);
    installPermissionPolicy();
    installIpc();
    hotkeys = loadHotkeys();
    await createTray();
    screen.on('display-added', ensurePillVisible);
    screen.on('display-removed', ensurePillVisible);
    screen.on('display-metrics-changed', ensurePillVisible);
    await loadWindows();
    installGlobalHotkey();
  });
}
