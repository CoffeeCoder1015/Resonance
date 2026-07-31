import { Keyboard, RotateCcw } from 'lucide-react';

const shortcuts = [
  {
    label: 'Global push-to-talk',
    description: 'Works while Resonance is hidden in the tray.',
    keys: ['Ctrl', 'Windows']
  },
  {
    label: 'In-window hold-to-talk',
    description: 'Works while the expanded Resonance window is focused.',
    keys: ['Space']
  }
];

export function HotkeySettingsPanel() {
  return (
    <div className="mt-5 rounded-[1.5rem] border-[3px] border-black bg-[#d7f5ff] p-4 neo-shadow sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-[3px] border-black bg-[#007bff] text-white neo-shadow-sm">
            <Keyboard className="h-5 w-5 stroke-[2.5]" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-black">Hold-to-talk shortcuts</h4>
              <span className="rounded-md border-2 border-black bg-[#ffde00] px-2 py-0.5 font-mono text-[8px] font-black uppercase tracking-wider">
                Coming soon
              </span>
            </div>
            <p className="mt-1 text-xs font-semibold text-black/55">
              Preview the default controls. Custom rebinding is not available yet.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled
          className="flex shrink-0 items-center gap-1.5 rounded-lg border-2 border-black bg-white px-2.5 py-2 text-[10px] font-black opacity-45"
          title="Default shortcut restoration is coming soon"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Defaults
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {shortcuts.map(shortcut => (
          <div
            key={shortcut.label}
            className="flex flex-col gap-3 rounded-xl border-[3px] border-black bg-white p-3 sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black">{shortcut.label}</p>
              <p className="mt-0.5 text-[11px] font-semibold text-black/50">
                {shortcut.description}
              </p>
            </div>
            <div className="flex items-center gap-1.5" aria-label={shortcut.keys.join(' plus ')}>
              {shortcut.keys.map(key => (
                <kbd
                  key={key}
                  className="min-w-12 rounded-lg border-2 border-black bg-[#fff8d6] px-3 py-2 text-center font-mono text-xs font-black shadow-[2px_2px_0_#000]"
                >
                  {key}
                </kbd>
              ))}
            </div>
            <button
              type="button"
              disabled
              className="rounded-lg border-2 border-black bg-[#ffde00] px-3 py-2 text-xs font-black opacity-45"
              title="Shortcut rebinding is coming soon"
            >
              Change
            </button>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] font-semibold leading-relaxed text-black/50">
        These controls show the current defaults only. They do not change keyboard behavior.
      </p>
    </div>
  );
}
