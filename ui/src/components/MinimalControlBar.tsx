import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronRight,
  Keyboard,
  Mic,
  MicOff,
  Palette,
  Repeat2,
  Send,
  Settings2,
  Volume2,
  VolumeX,
  X
} from 'lucide-react';
import { AgentState, DESIGN_VARIANTS, VisualTheme } from '../types/voice';
import { AvatarCanvas } from './AvatarCanvas';

interface MinimalControlBarProps {
  state: AgentState;
  visualTheme: VisualTheme;
  volume: number;
  frequencies: Uint8Array;
  speechOutputEnabled: boolean;
  canReplayResponse: boolean;
  onToggleListen: () => void;
  onSubmitTextTurn: (text: string, reply?: string) => void;
  onToggleSpeechOutput: () => void;
  onReplayLastResponse: () => void;
  onSelectTheme: (theme: VisualTheme) => void;
  onStopSpeech: () => void;
}

export const MinimalControlBar: React.FC<MinimalControlBarProps> = ({
  state,
  visualTheme,
  volume,
  frequencies,
  speechOutputEnabled,
  canReplayResponse,
  onToggleListen,
  onSubmitTextTurn,
  onToggleSpeechOutput,
  onReplayLastResponse,
  onSelectTheme,
  onStopSpeech
}) => {
  const [showTextInput, setShowTextInput] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [inputText, setInputText] = useState('');
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const isListening = state === 'listening';
  const isSpeaking = state === 'speaking' || state === 'processing';
  const activeVariant = DESIGN_VARIANTS.find(variant => variant.id === visualTheme) || DESIGN_VARIANTS[0];

  useEffect(() => {
    if (!showSettings) return;
    const previouslyFocused = document.activeElement;
    closeButtonRef.current?.focus();

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowSettings(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [showSettings]);

  const handleTextSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!inputText.trim()) return;
    onSubmitTextTurn(inputText.trim());
    setInputText('');
    setShowTextInput(false);
  };

  const handleCenterAction = () => {
    if (isSpeaking) onStopSpeech();
    else onToggleListen();
  };

  const openSettings = () => {
    setShowTextInput(false);
    setShowSettings(true);
  };

  return (
    <div className="fixed bottom-4 sm:bottom-6 left-0 right-0 z-30 flex flex-col items-center justify-center px-3 pointer-events-none">
      {showSettings && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 pointer-events-auto">
          <button
            type="button"
            className="absolute inset-0 w-full h-full bg-white/15 backdrop-blur-[16px] cursor-default"
            onClick={() => setShowSettings(false)}
            aria-label="Close settings"
            tabIndex={-1}
          />

          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            className="relative w-full max-w-5xl max-h-[calc(100dvh-2rem)] overflow-hidden bg-white/90 backdrop-blur-xl border-4 border-black neo-shadow-xl rounded-[2rem] text-black"
          >
            <header className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6 border-b-[3px] border-black">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-11 h-11 shrink-0 rounded-2xl bg-[#ff3b30] text-white border-[3px] border-black neo-shadow flex items-center justify-center">
                  <Settings2 className="w-5 h-5 stroke-[2.5]" />
                </span>
                <div className="min-w-0">
                  <h2 id="settings-title" className="text-xl sm:text-2xl font-black tracking-tight">
                    Settings
                  </h2>
                  <p className="text-xs sm:text-sm font-semibold text-black/55">
                    Shape your Resonance experience.
                  </p>
                </div>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setShowSettings(false)}
                title="Close settings"
                className="w-10 h-10 shrink-0 rounded-full bg-white border-[3px] border-black neo-shadow flex items-center justify-center neo-press"
              >
                <X className="w-5 h-5 stroke-[2.5]" />
              </button>
            </header>

            <div className="grid h-[min(690px,calc(100dvh-8.75rem))] min-h-0 grid-cols-[132px_minmax(0,1fr)] sm:grid-cols-[180px_minmax(0,1fr)]">
              <aside
                aria-label="Settings sections"
                className="border-r-[3px] border-black bg-[#fff8d6]/75 p-3 sm:p-4"
              >
                <p className="mb-3 px-2 font-mono text-[9px] font-black uppercase tracking-[0.16em] text-black/45">
                  Settings
                </p>
                <div role="tablist" aria-orientation="vertical">
                  <button
                    type="button"
                    role="tab"
                    aria-selected="true"
                    aria-controls="avatar-settings-panel"
                    className="flex w-full items-center gap-2 rounded-xl border-[3px] border-black bg-[#ffde00] px-2.5 py-3 text-left neo-shadow neo-press"
                  >
                    <Palette className="h-4 w-4 shrink-0 stroke-[2.5]" />
                    <span className="min-w-0 flex-1 truncate text-xs font-black sm:text-sm">Avatar</span>
                    <ChevronRight className="h-4 w-4 shrink-0 stroke-[3]" />
                  </button>
                </div>
              </aside>

              <div
                id="avatar-settings-panel"
                role="tabpanel"
                className="min-w-0 overflow-y-auto no-scrollbar p-4 sm:p-5"
              >
                <div className="mb-4 flex items-end justify-between gap-3">
                  <div>
                    <p className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-black/45">
                      Appearance
                    </p>
                    <h3 className="text-lg font-black tracking-tight sm:text-xl">Avatar</h3>
                    <p className="mt-0.5 text-xs font-semibold text-black/55 sm:text-sm">
                      Choose how your visual voice looks and moves.
                    </p>
                  </div>
                  <span className="shrink-0 rounded-lg bg-black px-2.5 py-1 font-mono text-[9px] font-black uppercase tracking-wider text-white">
                    {activeVariant.badge}
                  </span>
                </div>

                <div
                  data-testid="settings-avatar-preview"
                  style={{
                    backgroundColor: activeVariant.bgHex,
                    backgroundImage: `radial-gradient(circle at 50% 0%, ${activeVariant.accentHex}55 0%, transparent 60%), linear-gradient(135deg, rgba(255,255,255,0.24), transparent 65%)`
                  }}
                  className="relative mb-5 h-44 overflow-hidden rounded-[1.5rem] border-[3px] border-black neo-shadow sm:h-52"
                >
                  <span className="pointer-events-none absolute left-3 top-3 z-10 rounded-md border-2 border-black bg-white/85 px-2 py-1 font-mono text-[9px] font-black uppercase tracking-wider backdrop-blur-sm">
                    Live preview
                  </span>
                  <AvatarCanvas
                    state={state}
                    visualTheme={visualTheme}
                    volume={volume}
                    frequencies={frequencies}
                    preview
                  />
                </div>

                <div className="mb-3 flex items-center justify-between gap-3">
                  <h4 className="text-sm font-black">Avatar styles</h4>
                  <span className="font-mono text-[9px] font-black uppercase tracking-[0.14em] text-black/45">
                    {DESIGN_VARIANTS.length} available
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {DESIGN_VARIANTS.map(variant => {
                    const isSelected = variant.id === visualTheme;
                    return (
                      <button
                        type="button"
                        key={variant.id}
                        onClick={() => onSelectTheme(variant.id)}
                        aria-pressed={isSelected}
                        style={{ backgroundColor: variant.bgHex }}
                        className={`relative min-h-28 overflow-hidden flex flex-col items-start p-4 rounded-2xl border-[3px] border-black text-left neo-press ${
                          isSelected ? 'neo-shadow-lg' : 'neo-shadow'
                        }`}
                      >
                        <span
                          className="absolute -right-6 -top-6 w-20 h-20 rounded-full opacity-65 border-[3px] border-black"
                          style={{ backgroundColor: variant.accentHex }}
                          aria-hidden="true"
                        />
                        <div className="relative flex items-center justify-between w-full mb-2 gap-2">
                          <span className="text-[10px] font-mono font-extrabold px-2 py-1 bg-black text-white rounded-md">
                            {variant.badge}
                          </span>
                          {isSelected && (
                            <span className="w-6 h-6 shrink-0 rounded-full bg-[#00e676] border-2 border-black flex items-center justify-center">
                              <Check className="w-3.5 h-3.5 text-black stroke-[3]" />
                            </span>
                          )}
                        </div>
                        <p className="relative text-sm font-black leading-tight pr-8">{variant.name}</p>
                        <p className="relative mt-2 text-[11px] leading-relaxed text-black/65 font-semibold line-clamp-3">
                          {variant.philosophy}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {showTextInput && (
        <form
          onSubmit={handleTextSubmit}
          className="pointer-events-auto mb-3 w-full max-w-md bg-white border-[3px] border-black rounded-full pl-5 pr-2 py-2 flex items-center gap-2 neo-shadow-lg"
        >
          <input
            type="text"
            value={inputText}
            onChange={event => setInputText(event.target.value)}
            placeholder="Type upbeat message..."
            autoFocus
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-zinc-950 font-bold text-sm placeholder:text-zinc-500"
          />
          <button
            type="submit"
            disabled={!inputText.trim()}
            title="Send message"
            className="w-9 h-9 shrink-0 rounded-full bg-[#ff007f] border-2 border-black neo-shadow-sm text-white flex items-center justify-center neo-press disabled:opacity-40"
          >
            <Send className="w-4 h-4 stroke-[2.5]" />
          </button>
        </form>
      )}

      <div className="pointer-events-auto bg-white border-4 border-black rounded-full px-4 sm:px-6 py-3 flex items-center gap-3 sm:gap-5 neo-shadow-xl">
        <button
          type="button"
          onClick={onToggleSpeechOutput}
          title={speechOutputEnabled ? 'Mute voice responses' : 'Enable voice responses'}
          className={`w-11 h-11 rounded-full border-[3px] border-black neo-shadow flex items-center justify-center neo-press ${
            speechOutputEnabled ? 'bg-[#ffde00] text-black' : 'bg-zinc-900 text-white'
          }`}
        >
          {speechOutputEnabled ? (
            <Volume2 className="w-5 h-5 stroke-[2.5]" />
          ) : (
            <VolumeX className="w-5 h-5 stroke-[2.5]" />
          )}
        </button>

        <button
          type="button"
          onClick={handleCenterAction}
          title={isListening ? 'Stop listening' : isSpeaking ? 'Interrupt agent' : 'Start voice dialogue'}
          className={`w-11 h-11 rounded-full border-[3px] border-black flex items-center justify-center neo-shadow neo-press ${
            isListening
              ? 'bg-[#ff007f] text-white'
              : isSpeaking
                ? 'bg-[#00e676] text-black'
                : 'bg-[#007bff] text-white'
          }`}
        >
          {isListening ? (
            <Mic className="w-5 h-5 stroke-[2.5]" />
          ) : isSpeaking ? (
            <Volume2 className="w-5 h-5 stroke-[2.5]" />
          ) : (
            <MicOff className="w-5 h-5 stroke-[2.5]" />
          )}
        </button>

        <button
          type="button"
          onClick={onReplayLastResponse}
          disabled={!speechOutputEnabled || !canReplayResponse}
          title="Replay last agent response"
          className="w-11 h-11 rounded-full bg-[#00e676] border-[3px] border-black neo-shadow text-black flex items-center justify-center neo-press disabled:opacity-35 disabled:cursor-not-allowed"
        >
          <Repeat2 className="w-5 h-5 stroke-[2.5]" />
        </button>

        <button
          type="button"
          onClick={() => {
            setShowSettings(false);
            setShowTextInput(visible => !visible);
          }}
          title="Toggle keyboard input"
          className={`w-11 h-11 rounded-full border-[3px] border-black neo-shadow flex items-center justify-center neo-press ${
            showTextInput ? 'bg-black text-white' : 'bg-white text-black'
          }`}
        >
          <Keyboard className="w-5 h-5 stroke-[2]" />
        </button>

        <button
          ref={settingsButtonRef}
          type="button"
          onClick={openSettings}
          title="Open settings"
          className="w-11 h-11 rounded-full bg-[#ff3b30] border-[3px] border-black neo-shadow text-white flex items-center justify-center neo-press"
        >
          <Settings2 className="w-5 h-5 stroke-[2.5]" />
        </button>
      </div>
    </div>
  );
};
