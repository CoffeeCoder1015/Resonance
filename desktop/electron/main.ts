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
  DEFAULT_SNAPSHOT,
  type AudioLevel,
  type InsertTextResult,
  type RuntimeCommand,
  type RuntimeSnapshot
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
let globalHoldActive = false;
const pressedCtrlKeys = new Set<number>();
const pressedMetaKeys = new Set<number>();
const INSERTION_SESSION_MAX_AGE_MS = 10 * 60_000;

interface StoredInsertionTarget {
  target: ForegroundTarget;
  createdAt: number;
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

function trackHotkeyModifier(keycode: number, pressed: boolean) {
  const target =
    keycode === UiohookKey.Ctrl || keycode === UiohookKey.CtrlRight
      ? pressedCtrlKeys
      : keycode === UiohookKey.Meta || keycode === UiohookKey.MetaRight
        ? pressedMetaKeys
        : null;
  if (!target) return false;
  if (pressed) target.add(keycode);
  else target.delete(keycode);
  return true;
}

function installGlobalHotkey() {
  const handleKeyDown = (event: UiohookKeyboardEvent) => {
    if (!trackHotkeyModifier(event.keycode, true) || globalHoldActive) return;
    if (pressedCtrlKeys.size === 0 || pressedMetaKeys.size === 0) return;
    globalHoldActive = true;
    expandedWindow?.webContents.send(CHANNELS.command, 'begin-transcription');
  };
  const handleKeyUp = (event: UiohookKeyboardEvent) => {
    if (!trackHotkeyModifier(event.keycode, false) || !globalHoldActive) return;
    if (pressedCtrlKeys.size !== 0 || pressedMetaKeys.size !== 0) return;
    globalHoldActive = false;
    expandedWindow?.webContents.send(CHANNELS.command, 'end-transcription');
  };

  uIOhook.on('keydown', handleKeyDown);
  uIOhook.on('keyup', handleKeyUp);
  uIOhook.start();
  console.info('Registered global hold-to-talk hotkey: Ctrl+Windows');
}

function uninstallGlobalHotkey() {
  pressedCtrlKeys.clear();
  pressedMetaKeys.clear();
  if (globalHoldActive) {
    globalHoldActive = false;
    expandedWindow?.webContents.send(CHANNELS.command, 'end-transcription');
  }
  uIOhook.stop();
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
      snapshot.pillStatus === 'idle'
        ? pillHovered
          ? HOVERED_IDLE_HIT_WIDTH
          : IDLE_PILL_HIT_WIDTH
        : ACTIVE_PILL_HIT_WIDTH;
    const interactionHeight =
      snapshot.pillStatus === 'idle'
        ? pillHovered
          ? EXPANDED_PILL_HIT_HEIGHT
          : IDLE_PILL_HIT_HEIGHT
        : EXPANDED_PILL_HIT_HEIGHT;
    const interactionCenterOffsetX =
      snapshot.pillStatus === 'idle' && !pillHovered
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
  ipcMain.handle(CHANNELS.beginTextInsertion, event => {
    if (event.sender !== expandedWindow?.webContents) {
      throw new Error('Text insertion may only be started by the main renderer.');
    }
    return beginTextInsertion();
  });
  ipcMain.handle(
    CHANNELS.insertTextAtCaret,
    (event, sessionId: unknown, text: unknown) => {
      if (event.sender !== expandedWindow?.webContents) {
        return {
          status: 'failed',
          reason: 'Text insertion may only be requested by the main renderer.'
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
  ipcMain.on(CHANNELS.audioLevel, (event, nextLevel: unknown) => {
    if (event.sender !== expandedWindow?.webContents) return;
    if (
      typeof nextLevel !== 'object' ||
      nextLevel === null ||
      typeof (nextLevel as Partial<AudioLevel>).active !== 'boolean' ||
      typeof (nextLevel as Partial<AudioLevel>).level !== 'number' ||
      !Number.isFinite((nextLevel as Partial<AudioLevel>).level)
    ) {
      return;
    }

    const level: AudioLevel = {
      active: (nextLevel as AudioLevel).active,
      level: Math.max(0, Math.min(1, (nextLevel as AudioLevel).level))
    };
    pillWindow?.webContents.send(CHANNELS.audioLevel, level);
  });
  ipcMain.on(CHANNELS.command, (event, command: RuntimeCommand) => {
    if (event.sender !== pillWindow?.webContents) return;
    if (command === 'show-expanded') {
      showExpanded();
      return;
    }
    expandedWindow?.webContents.send(CHANNELS.command, command);
  });
}

async function loadWindows() {
  const preload = preloadPath(directory);
  expandedWindow = createExpandedWindow(preload);
  pillWindow = createPillWindow(preload);

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
    await createTray();
    screen.on('display-added', ensurePillVisible);
    screen.on('display-removed', ensurePillVisible);
    screen.on('display-metrics-changed', ensurePillVisible);
    await loadWindows();
    installGlobalHotkey();
  });
}
