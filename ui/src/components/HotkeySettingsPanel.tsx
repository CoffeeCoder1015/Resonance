import { useEffect, useRef, useState } from 'react';
import { Keyboard, Loader2, RotateCcw, X } from 'lucide-react';
import type {
  HotkeyCombo,
  HotkeySettings,
  UpdateHotkeysResult
} from '../types/desktop';
import { DEFAULT_HOTKEYS } from '../types/desktop';
import {
  describeCombo,
  hotkeyKeyFromEventCode,
  keyLabel,
  modifierFromDomKey,
  modifierLabel
} from '../services/hotkeys';

interface HotkeySettingsPanelProps {
  hotkeys: HotkeySettings | null;
  onUpdateHotkeys: (settings: HotkeySettings) => Promise<UpdateHotkeysResult>;
}

interface CaptureState {
  pressed: Set<string>;
  modifiers: ('ctrl' | 'alt' | 'shift' | 'meta')[];
  sawMainKey: boolean;
}

function freshCaptureState(): CaptureState {
  return { pressed: new Set(), modifiers: [], sawMainKey: false };
}

export function HotkeySettingsPanel({
  hotkeys,
  onUpdateHotkeys
}: HotkeySettingsPanelProps) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const captureRef = useRef<CaptureState>(freshCaptureState());

  useEffect(() => {
    if (!isCapturing || !hotkeys) return;
    captureRef.current = freshCaptureState();
    setCaptureError(null);

    const commit = (combo: HotkeyCombo) => {
      if (!hotkeys) return;
      setSaving(true);
      const next: HotkeySettings = { globalHoldToTalk: combo };
      void onUpdateHotkeys(next)
        .then(result => {
          if (result.status === 'ok') {
            setIsCapturing(false);
            setCaptureError(null);
          } else {
            setCaptureError(result.reason);
            captureRef.current = freshCaptureState();
          }
        })
        .catch(error => {
          setCaptureError(
            error instanceof Error ? error.message : 'The shortcut could not be saved.'
          );
          captureRef.current = freshCaptureState();
        })
        .finally(() => setSaving(false));
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (event.key === 'Escape') {
        setIsCapturing(false);
        setCaptureError(null);
        return;
      }

      const modifier = modifierFromDomKey(event.key);
      if (modifier) {
        captureRef.current.pressed.add(event.key);
        if (!captureRef.current.modifiers.includes(modifier)) {
          captureRef.current.modifiers.push(modifier);
        }
        return;
      }

      const key = hotkeyKeyFromEventCode(event.code);
      if (key === undefined) return;
      captureRef.current.sawMainKey = true;
      commit({ modifiers: [...captureRef.current.modifiers], key });
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const modifier = modifierFromDomKey(event.key);
      if (!modifier) return;
      captureRef.current.pressed.delete(event.key);
      if (
        captureRef.current.pressed.size === 0 &&
        !captureRef.current.sawMainKey &&
        captureRef.current.modifiers.length > 0
      ) {
        commit({ modifiers: [...captureRef.current.modifiers] });
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
    };
  }, [isCapturing, hotkeys, onUpdateHotkeys]);

  const cancelCapture = () => {
    captureRef.current = freshCaptureState();
    setIsCapturing(false);
    setCaptureError(null);
  };

  const restoreDefaults = () => {
    if (!hotkeys) return;
    setSaving(true);
    setCaptureError(null);
    void onUpdateHotkeys({
      globalHoldToTalk: { modifiers: [...DEFAULT_HOTKEYS.globalHoldToTalk.modifiers] }
    })
      .then(result => {
        if (result.status === 'failed') setCaptureError(result.reason);
      })
      .catch(error => {
        setCaptureError(
          error instanceof Error ? error.message : 'The defaults could not be restored.'
        );
      })
      .finally(() => setSaving(false));
  };

  const combo = hotkeys?.globalHoldToTalk;

  return (
    <div className="mt-5 rounded-[1.5rem] border-[3px] border-black bg-[#d7f5ff] p-4 neo-shadow sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-[3px] border-black bg-[#007bff] text-white neo-shadow-sm">
            <Keyboard className="h-5 w-5 stroke-[2.5]" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-black">Hold-to-talk shortcut</h4>
              {isCapturing && (
                <span className="flex items-center gap-1.5 rounded-md border-2 border-black bg-[#ffde00] px-2 py-0.5 font-mono text-[8px] font-black uppercase tracking-wider">
                  <Loader2 className="h-3 w-3 animate-spin" stroke="3" />
                  {saving ? 'Saving...' : 'Press a shortcut'}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs font-semibold text-black/55">
              {isCapturing
                ? 'Press your new shortcut, or press Escape to cancel.'
                : 'Hold this shortcut to dictate into the focused app.'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={restoreDefaults}
          disabled={!hotkeys || isCapturing || saving}
          title="Restore the default shortcuts"
          className="flex shrink-0 items-center gap-1.5 rounded-lg border-2 border-black bg-white px-2.5 py-2 text-[10px] font-black neo-press disabled:opacity-45"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Defaults
        </button>
      </div>

      {captureError && (
        <p
          role="alert"
          className="mt-3 rounded-lg border-2 border-black bg-[#ff3b30] px-3 py-2 text-xs font-black text-white"
        >
          {captureError}
        </p>
      )}

      <div className="mt-4 space-y-3">
            <div
              className={`flex flex-col gap-3 rounded-xl border-[3px] border-black p-3 sm:flex-row sm:items-center ${
                isCapturing ? 'bg-[#ffde00]' : 'bg-white'
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black">Global push-to-talk</p>
                <p className="mt-0.5 text-[11px] font-semibold text-black/50">
                  Works while Resonance is hidden in the tray.
                </p>
              </div>
              <div
                className="flex min-h-11 flex-wrap items-center gap-1.5"
                aria-label={combo ? describeCombo(combo) : 'Loading shortcut'}
              >
                {combo ? (
                  [
                    ...combo.modifiers.map(modifier => (
                      <kbd
                        key={modifier}
                        className="min-w-12 rounded-lg border-2 border-black bg-[#fff8d6] px-3 py-2 text-center font-mono text-xs font-black shadow-[2px_2px_0_#000]"
                      >
                        {modifierLabel(modifier)}
                      </kbd>
                    )),
                    ...(combo.key === undefined
                      ? []
                      : [
                          <kbd
                            key="key"
                            className="min-w-12 rounded-lg border-2 border-black bg-[#fff8d6] px-3 py-2 text-center font-mono text-xs font-black shadow-[2px_2px_0_#000]"
                          >
                            {keyLabel(combo.key)}
                          </kbd>
                        ])
                  ]
                ) : (
                  <span className="text-[11px] font-bold text-black/40">Loading...</span>
                )}
              </div>
              {isCapturing ? (
                <button
                  type="button"
                  onClick={cancelCapture}
                  className="flex items-center justify-center gap-1.5 rounded-lg border-2 border-black bg-white px-3 py-2 text-xs font-black neo-press"
                >
                  <X className="h-3.5 w-3.5" />
                  Cancel
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsCapturing(true)}
                  disabled={!hotkeys || isCapturing || saving}
                  className="rounded-lg border-2 border-black bg-[#ffde00] px-3 py-2 text-xs font-black neo-press disabled:opacity-45"
                >
                  Change
                </button>
              )}
            </div>
      </div>
    </div>
  );
}
