import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NATIVE_HELPER_TIMEOUT_MS = 10_000;
const CLIPBOARD_RESTORE_DELAY_MS = 100;
const directory = path.dirname(fileURLToPath(import.meta.url));

export interface ForegroundTarget {
  windowHandle: string;
  processId: number;
}

export type NativeInsertionDiagnostics = Record<string, string>;

export type NativeInsertionResult = (
  | {
      status: 'inserted';
      clipboardRestore: 'restored' | 'skipped';
    }
  | { status: 'modifiers-held' }
  | { status: 'target-changed' }
  | { status: 'clipboard-failed'; nativeError: number }
  | { status: 'restore-failed'; nativeError: number }
  | { status: 'paste-timeout'; nativeError: number }
  | { status: 'send-failed'; nativeError: number }
) & { diagnostics: NativeInsertionDiagnostics };

interface NativeHelperResult {
  stdout: string;
  stderr: string;
}

function nativeHelperPath() {
  const runningAsPackagedElectron =
    Boolean(process.versions.electron) && !process.defaultApp;
  if (runningAsPackagedElectron) {
    return path.join(
      process.resourcesPath,
      'app',
      'native',
      'resonance-paste.exe'
    );
  }
  return path.resolve(directory, '..', 'native', 'bin', 'resonance-paste.exe');
}

function runNativeHelper(
  args: string[],
  stdinText = ''
): Promise<NativeHelperResult> {
  return new Promise((resolve, reject) => {
    const helper = nativeHelperPath();
    const child = spawn(helper, args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, NATIVE_HELPER_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', error => {
      finish(() => {
        reject(
          error.message.includes('ENOENT')
            ? new Error(
                `The native text-insertion helper is missing at ${helper}. Run npm run build in the desktop directory.`
              )
            : error
        );
      });
    });
    child.once('close', code => {
      finish(() => {
        if (timedOut) {
          reject(new Error('The native clipboard insertion helper timed out.'));
          return;
        }
        if (code !== 0) {
          reject(
            new Error(
              `The native clipboard helper exited with code ${code}: ${stderr.trim() || 'No error output.'}`
            )
          );
          return;
        }
        resolve({ stdout, stderr });
      });
    });

    child.stdin.end(stdinText, 'utf8');
  });
}

function parseDiagnostics(fields: string[]): NativeInsertionDiagnostics {
  return Object.fromEntries(
    fields.map(field => {
      const separator = field.indexOf('=');
      return separator === -1
        ? [field, '']
        : [field.slice(0, separator), field.slice(separator + 1)];
    })
  );
}

export async function getForegroundTarget(): Promise<ForegroundTarget | null> {
  if (process.platform !== 'win32') return null;

  const { stdout, stderr } = await runNativeHelper(['--foreground']);
  if (stderr.trim()) {
    console.warn('[text-insertion] Native foreground helper stderr:', stderr.trim());
  }
  const match = stdout.trim().match(/^(-?\d+):(\d+)$/);
  if (!match || match[1] === '0') return null;
  return {
    windowHandle: match[1],
    processId: Number(match[2])
  };
}

export async function pasteTextViaClipboard(
  target: ForegroundTarget,
  text: string
): Promise<NativeInsertionResult> {
  if (!/^-?\d+$/.test(target.windowHandle)) {
    throw new Error('The captured Windows target is invalid.');
  }

  const { stdout, stderr } = await runNativeHelper(
    [
      '--paste',
      '--window',
      target.windowHandle,
      '--restore-delay',
      CLIPBOARD_RESTORE_DELAY_MS.toString()
    ],
    text
  );
  if (stderr.trim()) {
    console.info('[text-insertion] Native helper trace:\n' + stderr.trim());
  }

  const [result, ...diagnosticFields] = stdout.trim().split('|');
  const [status, rawValue] = result.split(':', 2);
  const diagnostics = parseDiagnostics(diagnosticFields);
  const value = Number(rawValue);

  if (status === 'inserted' && rawValue === 'restored') {
    return { status, clipboardRestore: 'restored', diagnostics };
  }
  if (status === 'inserted' && rawValue === 'restore-skipped') {
    return { status, clipboardRestore: 'skipped', diagnostics };
  }
  if (status === 'target-changed' || status === 'modifiers-held') {
    return { status, diagnostics };
  }
  if (
    (status === 'clipboard-failed' ||
      status === 'restore-failed' ||
      status === 'paste-timeout' ||
      status === 'send-failed') &&
    Number.isSafeInteger(value)
  ) {
    return { status, nativeError: value, diagnostics };
  }
  throw new Error(`Windows returned an invalid insertion result: ${stdout.trim()}`);
}
