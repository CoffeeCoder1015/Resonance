import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  clipboard,
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
  type ProcessTranscriptionResult,
  type RuntimeCommand,
  type RuntimeSnapshot,
  type UpdateHotkeysResult,
  type VoiceInputOwner
} from './contract.js';
import { installAppProtocol } from './protocol.js';
import {
  cancelTranscription,
  processTranscription
} from './transcription.js';
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
import { VoiceInputOwnership } from './voice-input-ownership.js';

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
let pillPositionSaveTimer: NodeJS.Timeout | null = null;
let pendingPillPosition: PillPosition | null = null;
let pillPositionWrite = Promise.resolve();
let pillPositionFlush: Promise<void> | null = null;
let quitAfterPillPositionSaved = false;
let pillRequested = true;
let rendererWindowsClosing = false;
let expandedWindowLoad: Promise<BrowserWindow> | null = null;
let pillWindowLoad: Promise<BrowserWindow> | null = null;
const voiceInputOwnership = new VoiceInputOwnership();
const insertionTargets = new Map<string, StoredInsertionTarget>();
let activeTranscription: {
  id: string;
  sessionId: string;
  abortController: AbortController;
  cancelled: boolean;
} | null = null;

const IDLE_PILL_HIT_WIDTH = 48;
const IDLE_PILL_HIT_HEIGHT = 48;
const HOVERED_IDLE_HIT_WIDTH = 184;
const ACTIVE_PILL_HIT_WIDTH = 280;
const EXPANDED_PILL_HIT_HEIGHT = 56;
const EXPANDED_PILL_CENTER_OFFSET_X = -26;
const PILL_POSITION_SAVE_DEBOUNCE_MS = 250;
const HOVER_POLL_NEAR_MS = 50;
const HOVER_POLL_MID_MS = 125;
const HOVER_POLL_FAR_MS = 400;
const VOICE_INPUT_REVOCATION_TIMEOUT_MS = 5_000;
const MAX_TRANSCRIPTION_AUDIO_BYTES = 25 * 1024 * 1024;

function cancelActiveTranscription(sessionId?: string) {
  const active = activeTranscription;
  if (!active || (sessionId !== undefined && active.sessionId !== sessionId)) return;
  active.cancelled = true;
  active.abortController.abort();
  insertionTargets.delete(active.sessionId);
  void cancelTranscription(active.id);
}

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
let globalHotkeyKeyDownListener: ((event: UiohookKeyboardEvent) => void) | null = null;
let globalHotkeyKeyUpListener: ((event: UiohookKeyboardEvent) => void) | null = null;
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
  try {
    console.info('[text-insertion] Insertion requested.', {
      sessionId,
      textCodeUnits: text.length,
      textUtf8Bytes: Buffer.byteLength(text, 'utf8'),
      sessionAgeMs: Date.now() - stored.createdAt,
      expectedWindowHandle: stored.target.windowHandle,
      expectedProcessId: stored.target.processId
    });
    const result = await pasteTextViaClipboard(stored.target, text);
    console.info('[text-insertion] Python Windows integration completed.', result);
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
        reason: 'Windows accepted the paste shortcut, but the target did not request the transcript.'
      };
    }
    return {
      status: 'failed',
      reason:
        result.nativeError === 0
          ? 'Windows blocked the paste shortcut, possibly because the target runs at a higher integrity level.'
          : `Windows paste failed with error ${result.nativeError}. SendInput accepted ${result.diagnostics.sent ?? '?'} of ${result.diagnostics.requested ?? '4'} events using INPUT size ${result.diagnostics.inputSize ?? '?'} on a ${result.diagnostics.pointerSize === 8 ? '64-bit' : '32-bit'} process.`
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

function pillPositionFor(window: BrowserWindow): PillPosition {
  const { x, y } = window.getBounds();
  return { x, y };
}

function persistPillPosition(position: PillPosition): Promise<void> {
  const write = pillPositionWrite
    .catch(() => undefined)
    .then(() => writeFile(pillPositionPath(), JSON.stringify(position)));
  pillPositionWrite = write.catch(error => {
    console.warn('[pill-position] Could not persist the transcription pill position.', error);
  });
  return pillPositionWrite;
}

function schedulePillPositionSave(window: BrowserWindow) {
  pendingPillPosition = pillPositionFor(window);
  if (pillPositionSaveTimer) return;
  pillPositionSaveTimer = setTimeout(() => {
    pillPositionSaveTimer = null;
    void flushPillPositionSave();
  }, PILL_POSITION_SAVE_DEBOUNCE_MS);
}

function flushPillPositionSave(window?: BrowserWindow): Promise<void> {
  if (window && windowIsUsable(window)) {
    pendingPillPosition = pillPositionFor(window);
  }
  if (pillPositionSaveTimer) {
    clearTimeout(pillPositionSaveTimer);
    pillPositionSaveTimer = null;
  }
  const position = pendingPillPosition;
  pendingPillPosition = null;
  return position ? persistPillPosition(position) : pillPositionWrite;
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
  void resumeExpandedWindow();
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

  globalHotkeyKeyDownListener = (event: UiohookKeyboardEvent) => {
    pressedHotkeyKeycodes.add(event.keycode);
    if (globalHotkeyActive || !comboIsHeld(hotkeys.globalHoldToTalk)) return;
    globalHotkeyActive = true;
    pillWindow?.webContents.send(CHANNELS.command, 'begin-transcription');
  };
  globalHotkeyKeyUpListener = (event: UiohookKeyboardEvent) => {
    pressedHotkeyKeycodes.delete(event.keycode);
    if (!globalHotkeyActive || comboIsHeld(hotkeys.globalHoldToTalk)) return;
    globalHotkeyActive = false;
    pillWindow?.webContents.send(CHANNELS.command, 'end-transcription');
  };

  uIOhook.on('keydown', globalHotkeyKeyDownListener);
  uIOhook.on('keyup', globalHotkeyKeyUpListener);
  uIOhook.start();
  globalHotkeyHookStarted = true;
  console.info(`Registered global hold-to-talk hotkey: ${describeCombo(hotkeys.globalHoldToTalk)}`);
}

function uninstallGlobalHotkey() {
  pressedHotkeyKeycodes.clear();
  if (globalHotkeyActive) {
    globalHotkeyActive = false;
    pillWindow?.webContents.send(CHANNELS.command, 'end-transcription');
  }
  if (!globalHotkeyHookStarted) return;
  if (globalHotkeyKeyDownListener) {
    uIOhook.off('keydown', globalHotkeyKeyDownListener);
    globalHotkeyKeyDownListener = null;
  }
  if (globalHotkeyKeyUpListener) {
    uIOhook.off('keyup', globalHotkeyKeyUpListener);
    globalHotkeyKeyUpListener = null;
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

function distanceFromPillInteractionBounds(
  cursor: Electron.Point,
  left: number,
  top: number,
  width: number,
  height: number
) {
  const horizontalDistance = Math.max(left - cursor.x, 0, cursor.x - (left + width));
  const verticalDistance = Math.max(top - cursor.y, 0, cursor.y - (top + height));
  return Math.hypot(horizontalDistance, verticalDistance);
}

function startPillHoverTracking() {
  if (pillHoverTimer) clearTimeout(pillHoverTimer);
  const poll = () => {
    pillHoverTimer = null;
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
    const distance = distanceFromPillInteractionBounds(
      cursor,
      interactionLeft,
      interactionTop,
      interactionWidth,
      interactionHeight
    );
    const delay =
      insideInteractionBounds || distance < 160
        ? HOVER_POLL_NEAR_MS
        : distance < 720
          ? HOVER_POLL_MID_MS
          : HOVER_POLL_FAR_MS;
    pillHoverTimer = setTimeout(poll, delay);
  };
  poll();
}

function stopPillHoverTracking() {
  if (pillHoverTimer) clearTimeout(pillHoverTimer);
  pillHoverTimer = null;
  pillHovered = false;
  pillIgnoresMouseEvents = false;
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
        click: () => void showPill()
      },
      { label: 'Hide transcription pill', click: destroyPillRenderer },
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
  const ownerForSender = (sender: Electron.WebContents): VoiceInputOwner | null => {
    if (sender === expandedWindow?.webContents) return 'desktop';
    if (sender === pillWindow?.webContents) return 'pill';
    return null;
  };
  const windowForOwner = (owner: VoiceInputOwner) =>
    owner === 'desktop' ? expandedWindow : pillWindow;
  const pendingRevocations = new Map<
    string,
    {
      sender: Electron.WebContents;
      finish: (stopped: boolean) => void;
    }
  >();
  const revokeVoiceInput = (owner: VoiceInputOwner): Promise<boolean> => {
    const previousWindow = windowForOwner(owner);
    if (!windowIsUsable(previousWindow) || previousWindow.webContents.isDestroyed()) {
      return Promise.resolve(true);
    }

    const sender = previousWindow.webContents;
    const requestId = randomUUID();
    return new Promise(resolve => {
      let settled = false;
      const finish = (stopped: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        sender.removeListener('destroyed', handleDestroyed);
        pendingRevocations.delete(requestId);
        resolve(stopped);
      };
      const handleDestroyed = () => finish(true);
      const timeout = setTimeout(
        () => finish(false),
        VOICE_INPUT_REVOCATION_TIMEOUT_MS
      );
      pendingRevocations.set(requestId, { sender, finish });
      sender.once('destroyed', handleDestroyed);
      sender.send(CHANNELS.voiceInputRevoked, requestId);
    });
  };
  ipcMain.on(CHANNELS.voiceInputRevokedAck, (event, requestId: unknown) => {
    if (typeof requestId !== 'string') return;
    const pending = pendingRevocations.get(requestId);
    if (pending?.sender === event.sender) pending.finish(true);
  });
  ipcMain.handle(CHANNELS.claimVoiceInput, async (event, requestedOwner: unknown) => {
    const owner = ownerForSender(event.sender);
    if (!owner || requestedOwner !== owner) return false;
    return voiceInputOwnership.claim(owner, revokeVoiceInput);
  });
  ipcMain.on(CHANNELS.releaseVoiceInput, (event, requestedOwner: unknown) => {
    const owner = ownerForSender(event.sender);
    if (owner && requestedOwner === owner) voiceInputOwnership.release(owner);
  });
  ipcMain.handle(CHANNELS.getWindowFocus, event => {
    const expanded = expandedWindow;
    return Boolean(
      expanded &&
      !expanded.isDestroyed() &&
      event.sender === expanded.webContents &&
      expanded.isFocused()
    );
  });
  ipcMain.handle(CHANNELS.beginTextInsertion, async event => {
    const sender = event.sender;
    if (sender !== pillWindow?.webContents) {
      return {
        status: 'unavailable',
        reason: 'Text insertion may only be started by the transcription pill.'
      } satisfies BeginTextInsertionResult;
    }
    try {
      const sessionId = await beginTextInsertion();
      if (sender.isDestroyed() || sender !== pillWindow?.webContents) {
        insertionTargets.delete(sessionId);
        return {
          status: 'unavailable',
          reason: 'The transcription pill closed before the insertion target was captured.'
        } satisfies BeginTextInsertionResult;
      }
      return {
        status: 'ready',
        sessionId
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
  ipcMain.on(CHANNELS.cancelTextInsertion, (event, sessionId: unknown) => {
    if (event.sender !== pillWindow?.webContents || typeof sessionId !== 'string') return;
    insertionTargets.delete(sessionId);
    cancelActiveTranscription(sessionId);
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
  ipcMain.handle(
    CHANNELS.processTranscription,
    async (event, sessionId: unknown, audio: unknown) => {
      if (event.sender !== pillWindow?.webContents) {
        return {
          status: 'failed',
          reason: 'Transcription may only be requested by the transcription pill.'
        } satisfies ProcessTranscriptionResult;
      }
      if (
        typeof sessionId !== 'string' ||
        !audio ||
        typeof audio !== 'object' ||
        !(audio as { data?: unknown }).data ||
        !((audio as { data: unknown }).data instanceof ArrayBuffer) ||
        typeof (audio as { contentType?: unknown }).contentType !== 'string'
      ) {
        return {
          status: 'failed',
          reason: 'The transcription audio is invalid.'
        } satisfies ProcessTranscriptionResult;
      }

      const payload = audio as { data: ArrayBuffer; contentType: string };
      if (
        payload.data.byteLength === 0 ||
        payload.data.byteLength > MAX_TRANSCRIPTION_AUDIO_BYTES
      ) {
        return {
          status: 'failed',
          reason: 'The transcription audio is empty or too large.'
        } satisfies ProcessTranscriptionResult;
      }

      cancelActiveTranscription();
      const job = {
        id: randomUUID(),
        sessionId,
        abortController: new AbortController(),
        cancelled: false
      };
      activeTranscription = job;

      try {
        const result = await processTranscription(
          payload.data,
          payload.contentType,
          job.id,
          job.abortController.signal
        );
        if (job.cancelled || activeTranscription !== job) {
          return { status: 'cancelled' } satisfies ProcessTranscriptionResult;
        }
        const insertion = await insertTextAtCaret(sessionId, result.text);
        if (job.cancelled || activeTranscription !== job) {
          return { status: 'cancelled' } satisfies ProcessTranscriptionResult;
        }
        if (insertion.status === 'inserted') {
          return {
            status: 'inserted',
            transcript: result.transcript,
            text: result.text,
            downstream: result.downstream
          } satisfies ProcessTranscriptionResult;
        }

        clipboard.writeText(result.text);
        return {
          status: 'copied',
          transcript: result.transcript,
          text: result.text,
          downstream: result.downstream,
          reason: `${insertion.reason || 'Automatic insertion failed.'} Final text was copied to the clipboard.`
        } satisfies ProcessTranscriptionResult;
      } catch (error) {
        insertionTargets.delete(sessionId);
        if (job.cancelled || activeTranscription !== job) {
          return { status: 'cancelled' } satisfies ProcessTranscriptionResult;
        }
        return {
          status: 'failed',
          reason: error instanceof Error ? error.message : 'Transcription failed.'
        } satisfies ProcessTranscriptionResult;
      } finally {
        if (activeTranscription === job) activeTranscription = null;
      }
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

function expandedRendererUrl() {
  return process.env.RESONANCE_MAIN_DEV_URL ?? 'resonance://app/index.html';
}

function pillRendererUrl() {
  return process.env.RESONANCE_PILL_DEV_URL ?? 'resonance://app/pill.html';
}

function windowIsUsable(window: BrowserWindow | null): window is BrowserWindow {
  return window !== null && !window.isDestroyed();
}

/** Destroy only the expanded renderer. The transcription pill is an
 * independent feature with its own microphone, VAD, and WebGL lifecycle.
 */
function suspendExpandedToTray() {
  if (rendererWindowsClosing || quitting) return;
  rendererWindowsClosing = true;

  const expanded = expandedWindow;
  expandedWindow = null;
  try {
    if (windowIsUsable(expanded)) expanded.destroy();
    console.info('[lifecycle] Suspended expanded renderer to tray.');
  } finally {
    voiceInputOwnership.release('desktop');
    rendererWindowsClosing = false;
  }
}

function destroyPillRenderer() {
  pillRequested = false;
  if (rendererWindowsClosing || !windowIsUsable(pillWindow)) return;
  rendererWindowsClosing = true;
  insertionTargets.clear();
  stopPillHoverTracking();
  uninstallGlobalHotkey();

  const pill = pillWindow;
  pillWindow = null;
  try {
    const flush = flushPillPositionSave(pill);
    const pendingFlush = flush.finally(() => {
      if (pillPositionFlush === pendingFlush) pillPositionFlush = null;
    });
    pillPositionFlush = pendingFlush;
    pill.destroy();
    console.info('[lifecycle] Destroyed transcription pill renderer.');
  } finally {
    voiceInputOwnership.release('pill');
    rendererWindowsClosing = false;
  }
}

async function ensureExpandedWindow(): Promise<BrowserWindow> {
  if (windowIsUsable(expandedWindow)) return expandedWindow;
  if (expandedWindowLoad) return expandedWindowLoad;

  const window = createExpandedWindow(preloadPath(directory));
  expandedWindow = window;
  observeRenderer('desktop', window);
  const publishWindowFocus = (focused: boolean) => {
    if (expandedWindow === window && !window.webContents.isDestroyed()) {
      window.webContents.send(CHANNELS.windowFocus, focused);
    }
  };
  window.on('focus', () => publishWindowFocus(true));
  window.on('blur', () => publishWindowFocus(false));
  window.on('close', event => {
    if (quitting || rendererWindowsClosing) return;
    event.preventDefault();
    suspendExpandedToTray();
  });
  window.on('closed', () => {
    if (expandedWindow === window) {
      expandedWindow = null;
      voiceInputOwnership.release('desktop');
    }
  });
  expandedWindowLoad = window
    .loadURL(expandedRendererUrl())
    .then(() => window)
    .catch(error => {
      if (expandedWindow === window) expandedWindow = null;
      if (windowIsUsable(window)) window.destroy();
      throw error;
    })
    .finally(() => {
      expandedWindowLoad = null;
    });
  return expandedWindowLoad;
}

async function ensurePillWindow(): Promise<BrowserWindow> {
  if (windowIsUsable(pillWindow)) return pillWindow;
  if (pillWindowLoad) return pillWindowLoad;
  if (pillPositionFlush) await pillPositionFlush;
  if (windowIsUsable(pillWindow)) return pillWindow;
  if (pillWindowLoad) return pillWindowLoad;

  const window = createPillWindow(preloadPath(directory));
  pillWindow = window;
  observeRenderer('pill', window);
  window.on('close', event => {
    if (quitting || rendererWindowsClosing) return;
    event.preventDefault();
    destroyPillRenderer();
  });
  window.on('closed', () => {
    if (pillWindow === window) {
      pillWindow = null;
      voiceInputOwnership.release('pill');
    }
  });
  window.on('moved', () => {
    if (pillWindow === window) schedulePillPositionSave(window);
  });
  pillWindowLoad = window
    .loadURL(pillRendererUrl())
    .then(() => {
      if (pillWindow !== window || !windowIsUsable(window)) {
        throw new Error('The transcription pill was closed before it finished loading.');
      }
      const savedPosition = readPillPosition();
      if (savedPosition) {
        window.setPosition(savedPosition.x, savedPosition.y, false);
        ensurePillVisible();
      } else {
        positionPill(window);
      }
      startPillHoverTracking();
      installGlobalHotkey();
      return window;
    })
    .catch(error => {
      if (pillWindow === window) pillWindow = null;
      if (windowIsUsable(window)) window.destroy();
      throw error;
    })
    .finally(() => {
      pillWindowLoad = null;
    });
  return pillWindowLoad;
}

async function showPill() {
  pillRequested = true;
  try {
    const window = await ensurePillWindow();
    ensurePillVisible();
    window.showInactive();
    startPillHoverTracking();
  } catch (error) {
    console.error('[lifecycle] Could not resume transcription pill.', error);
  }
}

async function resumeExpandedWindow() {
  try {
    const expandedPromise = ensureExpandedWindow();
    const pillPromise = pillRequested ? ensurePillWindow() : null;
    const expanded = await expandedPromise;
    expanded.show();
    expanded.focus();
    if (pillPromise) {
      const pill = await pillPromise;
      pill.showInactive();
      startPillHoverTracking();
    }
  } catch (error) {
    console.error('[lifecycle] Could not resume Resonance windows.', error);
  }
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
  app.on('before-quit', event => {
    if (quitAfterPillPositionSaved) return;
    quitting = true;
    cancelActiveTranscription();
    insertionTargets.clear();
    stopPillHoverTracking();
    uninstallGlobalHotkey();
    event.preventDefault();
    void flushPillPositionSave(pillWindow ?? undefined).finally(() => {
      quitAfterPillPositionSaved = true;
      app.quit();
    });
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
    await resumeExpandedWindow();
  });
  app.on('activate', showExpanded);
}
