import { useEffect, useState } from 'react';
import { TranscriptionPill } from '../components/transcription-pill/TranscriptionPill';
import type { PillStatus } from '../components/transcription-pill/pillPresentation';
import type { DesktopRuntimeSnapshot } from '../types/desktop';
import type { VisualTheme } from '../types/voice';

const STATUSES: PillStatus[] = [
  'idle',
  'recording',
  'processing',
  'success',
  'error'
];
const DEFAULT_THEME: VisualTheme = 'clay-blob';
const DEFAULT_SNAPSHOT: DesktopRuntimeSnapshot = {
  phase: 'idle',
  pillStatus: 'idle',
  elapsedSeconds: 0,
  visualTheme: DEFAULT_THEME
};

function BrowserPillHarness() {
  const [status, setStatus] = useState<PillStatus>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (status !== 'recording') {
      setElapsedSeconds(0);
      return;
    }
    const timer = window.setInterval(() => setElapsedSeconds(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  return (
    <>
      <div className="fixed left-4 top-4 z-20 flex gap-2 rounded-xl border-2 border-black bg-white p-2 shadow-[4px_4px_0_#000]">
        {STATUSES.map(value => (
          <button
            key={value}
            type="button"
            onClick={() => setStatus(value)}
            aria-pressed={status === value}
            className="rounded-lg border-2 border-black px-2 py-1 text-xs font-bold capitalize aria-pressed:bg-[#FFDE29]"
          >
            {value}
          </button>
        ))}
      </div>
      <PillStage>
        <TranscriptionPill
          status={status}
          elapsedSeconds={elapsedSeconds}
          visualTheme={DEFAULT_THEME}
          onPrimaryAction={() =>
            setStatus(current => (current === 'recording' ? 'processing' : 'recording'))
          }
        />
      </PillStage>
    </>
  );
}

function ElectronPillRenderer() {
  const bridge = window.resonanceDesktop!;
  const [snapshot, setSnapshot] = useState(DEFAULT_SNAPSHOT);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    void bridge.getSnapshot().then(setSnapshot);
    const unsubscribeSnapshot = bridge.subscribeSnapshot(setSnapshot);
    const unsubscribeAudioLevel = bridge.subscribeAudioLevel(frame => {
      setMicrophoneLevel(frame.active ? frame.level : 0);
    });
    const unsubscribeHover = bridge.subscribePillHover(setHovered);
    return () => {
      unsubscribeSnapshot();
      unsubscribeAudioLevel();
      unsubscribeHover();
    };
  }, [bridge]);

  return (
    <PillStage>
      <TranscriptionPill
        status={snapshot.pillStatus}
        elapsedSeconds={snapshot.elapsedSeconds}
        visualTheme={snapshot.visualTheme}
        microphoneLevel={microphoneLevel}
        hovered={hovered}
        onPrimaryAction={() => bridge.sendCommand('toggle-transcription')}
        onExpand={() => bridge.sendCommand('show-expanded')}
      />
    </PillStage>
  );
}

function PillStage({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <main
      className="flex h-screen w-screen items-center justify-center overflow-hidden bg-transparent px-32 py-8"
    >
      {children}
    </main>
  );
}

export function PillHarnessApp() {
  return window.resonanceDesktop ? <ElectronPillRenderer /> : <BrowserPillHarness />;
}
