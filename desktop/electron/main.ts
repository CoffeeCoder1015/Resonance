import path from 'node:path';
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

const IDLE_PILL_HIT_WIDTH = 48;
const IDLE_PILL_HIT_HEIGHT = 48;
const HOVERED_IDLE_HIT_WIDTH = 184;
const ACTIVE_PILL_HIT_WIDTH = 280;
const EXPANDED_PILL_HIT_HEIGHT = 56;
const EXPANDED_PILL_CENTER_OFFSET_X = -26;
let globalHoldActive = false;

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

function isHotkeyModifier(keycode: number) {
  return (
    keycode === UiohookKey.Ctrl ||
    keycode === UiohookKey.CtrlRight ||
    keycode === UiohookKey.Meta ||
    keycode === UiohookKey.MetaRight
  );
}

function installGlobalHotkey() {
  const handleKeyDown = (event: UiohookKeyboardEvent) => {
    if (
      globalHoldActive ||
      !isHotkeyModifier(event.keycode) ||
      !event.ctrlKey ||
      !event.metaKey
    ) {
      return;
    }
    globalHoldActive = true;
    expandedWindow?.webContents.send(CHANNELS.command, 'begin-hold-to-talk');
  };
  const handleKeyUp = (event: UiohookKeyboardEvent) => {
    if (!globalHoldActive || !isHotkeyModifier(event.keycode)) return;
    globalHoldActive = false;
    expandedWindow?.webContents.send(CHANNELS.command, 'end-hold-to-talk');
  };

  uIOhook.on('keydown', handleKeyDown);
  uIOhook.on('keyup', handleKeyUp);
  uIOhook.start();
  console.info('Registered global hold-to-talk hotkey: Ctrl+Windows');
}

function uninstallGlobalHotkey() {
  if (globalHoldActive) {
    globalHoldActive = false;
    expandedWindow?.webContents.send(CHANNELS.command, 'end-hold-to-talk');
  }
  uIOhook.stop();
}

function setPillHovered(hovered: boolean) {
  if (pillHovered === hovered) return;
  pillHovered = hovered;
  pillWindow?.webContents.send(CHANNELS.pillHover, hovered);
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
