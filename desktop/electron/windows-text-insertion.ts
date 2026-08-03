const WINDOWS_API_TIMEOUT_MS = 10_000;
const BACKEND_ORIGIN = process.env.RESONANCE_BACKEND_ORIGIN || 'http://127.0.0.1:8000';

export interface ForegroundTarget {
  windowHandle: string;
  processId: number;
}

type ClipboardRestore = 'restored' | 'empty' | 'skipped' | 'failed';
type InsertionStatus =
  | 'inserted'
  | 'modifiers-held'
  | 'target-changed'
  | 'clipboard-failed'
  | 'paste-timeout'
  | 'paste-failed'
  | 'restore-failed';

export interface NativeInsertionResult {
  status: InsertionStatus;
  clipboardRestore: ClipboardRestore;
  nativeError: number;
  diagnostics: Record<string, number>;
}

interface ForegroundTargetResponse {
  target: ForegroundTarget | null;
}

async function requestWindowsApi<T>(
  pathname: string,
  options?: RequestInit
): Promise<T> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), WINDOWS_API_TIMEOUT_MS);

  try {
    const response = await fetch(new URL(pathname, BACKEND_ORIGIN), {
      ...options,
      signal: abortController.signal
    });
    const result = (await response.json().catch(() => null)) as
      | T
      | { detail?: string }
      | null;
    if (!response.ok) {
      const detail =
        result && typeof result === 'object' && 'detail' in result
          ? result.detail
          : undefined;
      throw new Error(detail || `Windows integration returned ${response.status}.`);
    }
    if (!result || typeof result !== 'object') {
      throw new Error('Windows integration returned an invalid response.');
    }
    return result as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Windows integration timed out.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getForegroundTarget(): Promise<ForegroundTarget | null> {
  if (process.platform !== 'win32') return null;
  const result = await requestWindowsApi<ForegroundTargetResponse>(
    '/v1/windows/foreground-target'
  );
  const target = result.target;
  if (target === null) return null;
  if (
    typeof target !== 'object' ||
    typeof target.windowHandle !== 'string' ||
    !/^[1-9]\d*$/.test(target.windowHandle) ||
    !Number.isSafeInteger(target.processId) ||
    target.processId <= 0
  ) {
    throw new Error('Windows integration returned an invalid foreground target.');
  }
  return target;
}

export async function pasteTextViaClipboard(
  target: ForegroundTarget,
  text: string
): Promise<NativeInsertionResult> {
  if (process.platform !== 'win32') {
    throw new Error('Clipboard text insertion is currently supported on Windows only.');
  }
  if (!/^[1-9]\d*$/.test(target.windowHandle) || !Number.isSafeInteger(target.processId)) {
    throw new Error('The captured Windows target is invalid.');
  }

  const result = await requestWindowsApi<NativeInsertionResult>(
    '/v1/windows/insert-text',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        window_handle: target.windowHandle,
        process_id: target.processId,
        text
      })
    }
  );
  if (
    ![
      'inserted',
      'modifiers-held',
      'target-changed',
      'clipboard-failed',
      'paste-timeout',
      'paste-failed',
      'restore-failed'
    ].includes(result.status) ||
    !['restored', 'empty', 'skipped', 'failed'].includes(result.clipboardRestore) ||
    !Number.isSafeInteger(result.nativeError) ||
    !result.diagnostics ||
    typeof result.diagnostics !== 'object'
  ) {
    throw new Error('Windows integration returned an invalid insertion result.');
  }
  return result;
}
