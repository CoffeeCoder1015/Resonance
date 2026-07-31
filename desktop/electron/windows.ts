import path from 'node:path';
import {
  BrowserWindow,
  screen,
  type BrowserWindowConstructorOptions
} from 'electron';

const PILL_WIDTH = 680;
const PILL_HEIGHT = 168;

function secureWebPreferences(preloadPath: string): BrowserWindowConstructorOptions['webPreferences'] {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true
  };
}

export function createExpandedWindow(preloadPath: string) {
  return new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 620,
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: true,
    backgroundColor: '#FFF480',
    webPreferences: secureWebPreferences(preloadPath)
  });
}

export function createPillWindow(preloadPath: string) {
  const window = new BrowserWindow({
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    webPreferences: secureWebPreferences(preloadPath)
  });
  window.setAlwaysOnTop(true, 'screen-saver', 1);
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  return window;
}

export function positionPill(window: BrowserWindow) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.workArea;
  window.setPosition(
    Math.round(x + (width - PILL_WIDTH) / 2),
    Math.round(y + height - PILL_HEIGHT - 20),
    false
  );
}

export function preloadPath(directory: string) {
  return path.join(directory, 'preload.cjs');
}
