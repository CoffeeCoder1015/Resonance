import { useEffect } from 'react';
import { useVoiceAgent } from './hooks/useVoiceAgent';
import { AvatarCanvas } from './components/AvatarCanvas';
import { TranscriptLog } from './components/TranscriptLog';
import { MinimalControlBar } from './components/MinimalControlBar';
import { DESIGN_VARIANTS } from './types/voice';

export function App() {
  const {
    state,
    visualTheme,
    transcript,
    speechOutputEnabled,
    canReplayResponse,
    currentSpeechVolume,
    audioFrequencies,
    toggleListening,
    submitTextTurn,
    toggleSpeechOutput,
    replayLastResponse,
    selectTheme,
    stopAgentSpeech
  } = useVoiceAgent();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target;
      if (
        e.repeat ||
        (target instanceof HTMLElement &&
          Boolean(target.closest('input, textarea, button, select, a, [contenteditable="true"]')))
      ) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        toggleListening();
      } else if (e.key === 'Escape') {
        stopAgentSpeech();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleListening, stopAgentSpeech]);

  const getStateDescription = () => {
    switch (state) {
      case 'listening':
        return { text: 'LISTENING', dot: 'bg-[#ff007f]', badge: 'bg-[#ffde00]' };
      case 'processing':
        return { text: 'THINKING', dot: 'bg-[#007bff]', badge: 'bg-[#e9d8fd]' };
      case 'speaking':
        return { text: 'SPEAKING', dot: 'bg-[#00e676]', badge: 'bg-[#c6f6d5]' };
      case 'idle':
      default:
        return { text: 'STANDBY', dot: 'bg-zinc-900', badge: 'bg-white' };
    }
  };

  const statusInfo = getStateDescription();
  const activeVariant = DESIGN_VARIANTS.find(v => v.id === visualTheme) || DESIGN_VARIANTS[0];

  return (
    <div
      style={{
        backgroundColor: activeVariant.bgHex,
        backgroundImage: `radial-gradient(circle at 50% -10%, ${activeVariant.accentHex}55 0%, transparent 48%), linear-gradient(135deg, rgba(255,255,255,0.26), transparent 58%)`
      }}
      className="relative w-screen h-[100dvh] overflow-hidden flex flex-col select-none font-sans text-zinc-950 transition-colors duration-500"
    >
      <div
        style={{ backgroundColor: activeVariant.accentHex }}
        className="absolute -top-40 left-1/2 -translate-x-1/2 w-[75vw] h-[75vw] rounded-full blur-[90px] opacity-20 pointer-events-none transition-colors duration-700"
      />

      <header className="w-full pt-4 sm:pt-6 px-4 flex justify-center items-center z-20 pointer-events-none shrink-0">
        <div
          className={`flex items-center gap-2.5 px-4 py-1.5 rounded-full border-[3px] border-black ${statusInfo.badge} neo-shadow font-mono text-[11px] font-black uppercase tracking-widest text-black`}
        >
          <span
            className={`w-3 h-3 rounded-full border-2 border-black ${statusInfo.dot} ${
              state !== 'idle' ? 'animate-pulse' : ''
            }`}
          />
          <span>{statusInfo.text}</span>
          <span className="px-2 py-0.5 bg-black text-white rounded-md text-[9px]">
            {activeVariant.badge}
          </span>
        </div>
      </header>

      <main className="relative flex-1 w-full flex flex-col items-center overflow-hidden z-10 min-h-0">
        <div className="w-full h-full flex flex-col items-center min-h-0">
          <div className="flex-1 w-full flex items-center justify-center min-h-0">
            <AvatarCanvas
              state={state}
              visualTheme={visualTheme}
              volume={currentSpeechVolume}
              frequencies={audioFrequencies}
              onAvatarClick={toggleListening}
            />
          </div>

          <div className="w-full shrink-0 flex items-end justify-center pb-32 sm:pb-36 px-2">
            <TranscriptLog transcript={transcript} agentState={state} />
          </div>
        </div>
      </main>

      <MinimalControlBar
        state={state}
        visualTheme={visualTheme}
        volume={currentSpeechVolume}
        frequencies={audioFrequencies}
        speechOutputEnabled={speechOutputEnabled}
        canReplayResponse={canReplayResponse}
        onToggleListen={toggleListening}
        onSubmitTextTurn={submitTextTurn}
        onToggleSpeechOutput={toggleSpeechOutput}
        onReplayLastResponse={replayLastResponse}
        onSelectTheme={selectTheme}
        onStopSpeech={stopAgentSpeech}
      />
    </div>
  );
}

export default App;
