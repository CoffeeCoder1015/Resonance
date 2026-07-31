import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const POWERSHELL_TIMEOUT_MS = 10_000;

const FOREGROUND_WINDOW_SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ResonanceForegroundWindow {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
}
'@
$window = [ResonanceForegroundWindow]::GetForegroundWindow()
$processId = [uint32]0
[void][ResonanceForegroundWindow]::GetWindowThreadProcessId($window, [ref]$processId)
[Console]::Out.Write($window.ToInt64().ToString() + ':' + $processId.ToString())
`;

const SEND_UNICODE_SCRIPT = String.raw`
param([string]$TextPath, [string]$ExpectedWindow)
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class ResonanceUnicodeInput {
  private const uint INPUT_KEYBOARD = 1;
  private const uint KEYEVENTF_KEYUP = 0x0002;
  private const uint KEYEVENTF_UNICODE = 0x0004;

  [StructLayout(LayoutKind.Sequential)]
  private struct INPUT {
    public uint type;
    public InputUnion input;
  }

  [StructLayout(LayoutKind.Explicit)]
  private struct InputUnion {
    [FieldOffset(0)]
    public KEYBDINPUT keyboard;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct KEYBDINPUT {
    public ushort virtualKey;
    public ushort scanCode;
    public uint flags;
    public uint time;
    public UIntPtr extraInfo;
  }

  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll", SetLastError = true)]
  private static extern uint SendInput(uint inputCount, INPUT[] inputs, int inputSize);

  public static string Insert(string text, long expectedWindow) {
    if (GetForegroundWindow().ToInt64() != expectedWindow) {
      return "target-changed:0";
    }

    INPUT[] inputs = new INPUT[text.Length * 2];
    for (int index = 0; index < text.Length; index++) {
      ushort codeUnit = text[index];
      inputs[index * 2] = new INPUT {
        type = INPUT_KEYBOARD,
        input = new InputUnion {
          keyboard = new KEYBDINPUT {
            scanCode = codeUnit,
            flags = KEYEVENTF_UNICODE
          }
        }
      };
      inputs[index * 2 + 1] = new INPUT {
        type = INPUT_KEYBOARD,
        input = new InputUnion {
          keyboard = new KEYBDINPUT {
            scanCode = codeUnit,
            flags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP
          }
        }
      };
    }

    uint inserted = SendInput(
      (uint)inputs.Length,
      inputs,
      Marshal.SizeOf(typeof(INPUT))
    );
    if (inserted == inputs.Length) {
      return "inserted:" + text.Length.ToString();
    }
    if (inserted == 0) {
      return "send-failed:" + Marshal.GetLastWin32Error().ToString();
    }
    return "partial:" + (inserted / 2).ToString();
  }
}
'@
$text = [System.IO.File]::ReadAllText($TextPath, [System.Text.Encoding]::Unicode)
[Console]::Out.Write([ResonanceUnicodeInput]::Insert($text, [long]$ExpectedWindow))
`;

export interface ForegroundTarget {
  windowHandle: string;
  processId: number;
}

export type NativeInsertionResult =
  | { status: 'inserted'; insertedCodeUnits: number }
  | { status: 'target-changed'; insertedCodeUnits: 0 }
  | { status: 'partial'; insertedCodeUnits: number }
  | { status: 'send-failed'; insertedCodeUnits: 0; nativeError: number };

async function runPowerShell(script: string, args: string[] = []) {
  return execFileAsync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
      ...args
    ],
    {
      encoding: 'utf8',
      timeout: POWERSHELL_TIMEOUT_MS,
      windowsHide: true
    }
  );
}

export async function getForegroundTarget(): Promise<ForegroundTarget | null> {
  if (process.platform !== 'win32') return null;

  const { stdout } = await runPowerShell(FOREGROUND_WINDOW_SCRIPT);
  const match = stdout.trim().match(/^(-?\d+):(\d+)$/);
  if (!match || match[1] === '0') return null;
  return {
    windowHandle: match[1],
    processId: Number(match[2])
  };
}

export async function insertUnicodeText(
  target: ForegroundTarget,
  text: string
): Promise<NativeInsertionResult> {
  const textPath = path.join(
    tmpdir(),
    `resonance-insertion-${process.pid}-${randomUUID()}.txt`
  );

  try {
    await writeFile(textPath, text, { encoding: 'utf16le', flag: 'wx' });
    const { stdout } = await runPowerShell(SEND_UNICODE_SCRIPT, [
      textPath,
      target.windowHandle
    ]);
    const [status, rawValue] = stdout.trim().split(':', 2);
    const value = Number(rawValue);

    if (status === 'inserted' && Number.isSafeInteger(value)) {
      return { status, insertedCodeUnits: value };
    }
    if (status === 'target-changed') {
      return { status, insertedCodeUnits: 0 };
    }
    if (status === 'partial' && Number.isSafeInteger(value)) {
      return { status, insertedCodeUnits: value };
    }
    if (status === 'send-failed' && Number.isSafeInteger(value)) {
      return { status, insertedCodeUnits: 0, nativeError: value };
    }
    throw new Error(`Windows returned an invalid insertion result: ${stdout.trim()}`);
  } finally {
    await unlink(textPath).catch(() => undefined);
  }
}
