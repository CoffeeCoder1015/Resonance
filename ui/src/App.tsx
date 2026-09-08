import { useEffect, useState } from 'react';
import { Check, Settings2 } from 'lucide-react';
import { AvatarCanvas } from './components/AvatarCanvas';
import { ProviderSettingsPanel } from './components/ProviderSettingsPanel';
import { DESIGN_VARIANTS, type VisualTheme } from './types/voice';
import type { HotkeySettings, UpdateHotkeysResult } from './types/desktop';

const PREVIEW_FREQUENCIES = new Uint8Array(64);

export function App() {
  const [visualTheme, setVisualTheme] = useState<VisualTheme>('clay-blob');
  const [hotkeys, setHotkeys] = useState<HotkeySettings | null>(null);
  const [active, setActive] = useState(document.hasFocus());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const bridge = window.resonanceDesktop;
    if (!bridge) {
      setError('Open Resonance on your desktop to configure the transcription bar.');
      return;
    }
    let disposed = false;
    const unsubscribe = bridge.subscribeWindowFocus(setActive);
    void Promise.all([bridge.getSnapshot(), bridge.getHotkeys(), bridge.getWindowFocus()])
      .then(([snapshot, settings, focused]) => {
        if (disposed) return;
        setVisualTheme(snapshot.visualTheme);
        setHotkeys(settings);
        setActive(focused);
      })
      .catch(error => {
        if (!disposed) setError(error instanceof Error ? error.message : 'Settings could not be loaded.');
      });
    return () => { disposed = true; unsubscribe(); };
  }, []);

  const updateHotkeys = async (next: HotkeySettings): Promise<UpdateHotkeysResult> => {
    const bridge = window.resonanceDesktop;
    if (!bridge) return { status: 'failed', reason: 'Desktop integration is unavailable.' };
    const result = await bridge.updateHotkeys(next);
    if (result.status === 'ok') setHotkeys(result.settings);
    return result;
  };

  const selectTheme = (theme: VisualTheme) => {
    setVisualTheme(theme);
    window.resonanceDesktop?.publishSnapshot({ visualTheme: theme });
  };
  const variant = DESIGN_VARIANTS.find(item => item.id === visualTheme) ?? DESIGN_VARIANTS[0];

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#fff8e7] font-sans text-zinc-950">
      <header className="desktop-window-drag-region flex shrink-0 items-center gap-4 border-b-[3px] border-black bg-[#ffde00] px-7 py-5 pr-36">
        <Settings2 className="h-8 w-8 shrink-0" strokeWidth={2.5} />
        <div>
          <p className="font-mono text-[10px] font-black uppercase tracking-[0.2em]">Resonance</p>
          <h1 className="text-2xl font-black tracking-tight">Transcription bar settings</h1>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">
        <p className="mb-6 text-sm font-semibold text-black/65">Dictate into the app you’re using. Make the transcription bar your own here.</p>
        {error && <p role="alert" className="mb-5 rounded-xl border-[3px] border-black bg-[#ffdad6] p-4 text-sm font-bold">{error}</p>}
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.2fr)]">
          <section aria-label="Transcription settings" className="rounded-3xl border-[3px] border-black bg-white neo-shadow">
            <ProviderSettingsPanel hotkeys={hotkeys} onUpdateHotkeys={updateHotkeys} />
          </section>
          <section aria-labelledby="appearance-heading" className="rounded-3xl border-[3px] border-black bg-white p-5 neo-shadow">
            <p className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-black/45">Appearance</p>
            <h2 id="appearance-heading" className="text-xl font-black tracking-tight">Bar theme</h2>
            <p className="mt-1 text-sm font-semibold text-black/55">Choose the character that moves with your voice.</p>
            <div style={{ backgroundColor: variant.bgHex }} className="relative my-5 h-48 overflow-hidden rounded-2xl border-[3px] border-black">
              <span className="absolute left-3 top-3 z-10 rounded-md border-2 border-black bg-white px-2 py-1 font-mono text-[9px] font-black uppercase">Preview</span>
              <AvatarCanvas state="idle" visualTheme={visualTheme} volume={0.05} frequencies={PREVIEW_FREQUENCIES} preview active={active} powerPreference="default" maxFrameRate={60} />
            </div>
            <div className="grid grid-cols-2 gap-3" role="group" aria-label="Bar themes">
              {DESIGN_VARIANTS.map(item => (
                <button key={item.id} type="button" aria-pressed={item.id === visualTheme} onClick={() => selectTheme(item.id)} style={{ backgroundColor: item.bgHex }} className="flex min-h-24 items-start justify-between gap-2 rounded-2xl border-[3px] border-black p-4 text-left neo-press focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-[#007bff]">
                  <span>
                    <span className="mb-2 inline-block rounded-md bg-black px-2 py-1 font-mono text-[9px] font-black text-white">{item.badge}</span>
                    <span className="block text-sm font-black leading-tight">{item.name}</span>
                  </span>
                  {item.id === visualTheme && <Check aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={3} />}
                </button>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

export default App;
