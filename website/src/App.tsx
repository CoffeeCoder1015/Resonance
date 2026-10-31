import { useCallback, useEffect, useRef, useState } from 'react';
import { TranscriptionPill } from './components/transcription-pill/TranscriptionPill';
import { RefinementStory } from './components/RefinementStory';
import type { PillStatus } from './components/transcription-pill/pillPresentation';
import { DESIGN_VARIANTS, type VoiceState, type VisualTheme } from './types/voice';

type TranscriptLine = { id: number; text: string };
type RecognitionResultEvent = Event & { resultIndex: number; results: { [index: number]: { [index: number]: { transcript: string }; isFinal: boolean }; length: number } };
type RecognitionInstance = { lang: string; continuous: boolean; interimResults: boolean; onresult: ((event: RecognitionResultEvent) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void };
type RecognitionConstructor = new () => RecognitionInstance;

const INITIAL_TRANSCRIPT: TranscriptLine[] = [
  { id: 1, text: 'try it out' },
  { id: 2, text: 'say what’s on your mind' },
  { id: 3, text: 'your words appear right here' },
  { id: 4, text: 'no typing needed' },
  { id: 5, text: 'let your thoughts flow' }
];
const FALLBACK_LINES = ['Sample: I will send the updated draft this afternoon.', 'Sample: The main idea is to keep things simple.', 'Sample: Let me know what you think.'];
const MAX_TRANSCRIPT_LINES = 300;
const THEME_HINT_STORAGE_KEY = 'resonance-seen-themes';
const THEME_HINT_COOLDOWN_MS = 4000;

function readSeenThemes(): VisualTheme[] {
  try {
    const stored = JSON.parse(sessionStorage.getItem(THEME_HINT_STORAGE_KEY) ?? 'null');
    if (Array.isArray(stored)) return DESIGN_VARIANTS.map(theme => theme.id).filter(id => stored.includes(id));
  } catch { /* Session storage may be unavailable in restricted browsing modes. */ }
  return [DESIGN_VARIANTS[0].id];
}

function storeSeenThemes(themes: VisualTheme[]) {
  try { sessionStorage.setItem(THEME_HINT_STORAGE_KEY, JSON.stringify(themes)); } catch { /* The hint still works for the current render. */ }
}

function getRecognitionConstructor() {
  const browserWindow = window as Window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
}

export function App() {
  const [lines, setLines] = useState(INITIAL_TRANSCRIPT);
  const [interim, setInterim] = useState('');
  const [status, setStatus] = useState<PillStatus>('idle');
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [frequencies, setFrequencies] = useState(new Uint8Array(64).fill(12));
  const [themeIndex, setThemeIndex] = useState(0);
  const recognitionRef = useRef<RecognitionInstance | null>(null);
  const stoppingRecognitionRef = useRef<RecognitionInstance | null>(null);
  const transcriptionGenerationRef = useRef(0);
  const fallbackTimerRef = useRef<number | null>(null);
  const meterFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const nextIdRef = useRef(INITIAL_TRANSCRIPT.length + 1);
  const fallbackIndexRef = useRef(0);
  const themeHintTimerRef = useRef<number | null>(null);
  const activeTheme = DESIGN_VARIANTS[themeIndex];
  const [, setSeenThemeIds] = useState<VisualTheme[]>(() => readSeenThemes());
  const [themeHintVisible, setThemeHintVisible] = useState(() => readSeenThemes().length < DESIGN_VARIANTS.length);
  const [themeHintText, setThemeHintText] = useState(() => readSeenThemes().length > 1 ? "There's more!" : 'Tap the orb to switch themes');

  const appendLine = useCallback((text: string) => {
    const cleanText = text.trim();
    if (!cleanText) return;
    setLines(current => [...current, { id: nextIdRef.current++, text: cleanText }].slice(-MAX_TRANSCRIPT_LINES));
  }, []);

  const stopMeter = useCallback(() => {
    if (meterFrameRef.current !== null) window.cancelAnimationFrame(meterFrameRef.current);
    meterFrameRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') void audioContextRef.current.close();
    audioContextRef.current = null;
    setMicrophoneLevel(0);
    setFrequencies(new Uint8Array(64).fill(12));
  }, []);

  const startMeter = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 128;
    context.createMediaStreamSource(stream).connect(analyser);
    streamRef.current = stream;
    audioContextRef.current = context;
    const readMeter = () => {
      const nextFrequencies = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(nextFrequencies);
      const average = nextFrequencies.reduce((total, value) => total + value, 0) / nextFrequencies.length;
      setMicrophoneLevel(Math.min(1, (average / 128) * 1.6));
      setFrequencies(nextFrequencies);
      meterFrameRef.current = window.requestAnimationFrame(readMeter);
    };
    readMeter();
  }, []);

  const resetToIdle = useCallback(() => {
    if (elapsedTimerRef.current !== null) window.clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = null;
    setElapsedSeconds(0); setInterim(''); setStatus('idle'); setVoiceState('idle'); stopMeter();
  }, [stopMeter]);

  const startFallback = useCallback(() => {
    setStatus('recording'); setVoiceState('listening');
    const addFallbackLine = () => { appendLine(FALLBACK_LINES[fallbackIndexRef.current % FALLBACK_LINES.length]); fallbackIndexRef.current += 1; };
    addFallbackLine();
    fallbackTimerRef.current = window.setInterval(addFallbackLine, 2600);
  }, [appendLine]);

  const stopTranscription = useCallback(() => {
    transcriptionGenerationRef.current += 1;
    const recognition = recognitionRef.current;
    if (recognition) {
      stoppingRecognitionRef.current = recognition;
      setStatus('processing');
      setVoiceState('processing');
      recognition.stop();
    }
    if (fallbackTimerRef.current !== null) window.clearInterval(fallbackTimerRef.current);
    fallbackTimerRef.current = null;
    if (!recognition) resetToIdle();
  }, [resetToIdle]);

  const startTranscription = useCallback(async () => {
    const generation = ++transcriptionGenerationRef.current;
    setStatus('recording'); setVoiceState('listening');
    try { await startMeter(); } catch { /* Recognition may obtain microphone access independently. */ }
    if (generation !== transcriptionGenerationRef.current) {
      stopMeter();
      return;
    }
    const Recognition = getRecognitionConstructor();
    if (!Recognition) { startFallback(); return; }
    const recognition = new Recognition();
    recognition.lang = 'en-US'; recognition.continuous = true; recognition.interimResults = true;
    recognition.onresult = event => {
      let nextInterim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) appendLine(result[0].transcript); else nextInterim += result[0].transcript;
      }
      setInterim(nextInterim);
    };
    recognition.onerror = () => {
      if (recognitionRef.current !== recognition) return;
      if (stoppingRecognitionRef.current === recognition) {
        stoppingRecognitionRef.current = null;
        recognitionRef.current = null;
        resetToIdle();
        return;
      }
      recognitionRef.current = null;
      startFallback();
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) { recognitionRef.current = null; resetToIdle(); }
      if (stoppingRecognitionRef.current === recognition) stoppingRecognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    try { recognition.start(); }
    catch { recognitionRef.current = null; startFallback(); }
  }, [appendLine, resetToIdle, startFallback, startMeter, stopMeter]);

  useEffect(() => {
    if (status !== 'recording') return;
    elapsedTimerRef.current = window.setInterval(() => setElapsedSeconds(seconds => seconds + 1), 1000);
    return () => { if (elapsedTimerRef.current !== null) window.clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; };
  }, [status]);
  useEffect(() => () => {
    stopTranscription();
    if (themeHintTimerRef.current !== null) window.clearTimeout(themeHintTimerRef.current);
  }, [stopTranscription]);

  useEffect(() => {
    const history = historyRef.current;
    if (history) history.scrollTop = history.scrollHeight;
  }, [interim, lines]);

  const cycleTheme = () => {
    if (themeHintTimerRef.current !== null) window.clearTimeout(themeHintTimerRef.current);
    setThemeHintVisible(false);
    setThemeIndex(index => {
      const nextTheme = DESIGN_VARIANTS[(index + 1) % DESIGN_VARIANTS.length].id as VisualTheme;
      setSeenThemeIds(current => {
        if (current.includes(nextTheme)) return current;
        const nextSeen = [...current, nextTheme];
        storeSeenThemes(nextSeen);
        return nextSeen;
      });
      return (index + 1) % DESIGN_VARIANTS.length;
    });
    themeHintTimerRef.current = window.setTimeout(() => {
      setSeenThemeIds(current => {
        if (current.length >= DESIGN_VARIANTS.length) return current;
        setThemeHintText("There's more!");
        setThemeHintVisible(true);
        return current;
      });
      themeHintTimerRef.current = null;
    }, THEME_HINT_COOLDOWN_MS);
  };
  const toggleTranscription = () => {
    if (status === 'recording') stopTranscription();
    else if (status === 'idle' || status === 'error') void startTranscription();
  };

  return (
    <main className="product-page" style={{ '--theme-bg': activeTheme.bgHex, '--theme-accent': activeTheme.accentHex, '--theme-accent-foreground': activeTheme.accentForegroundHex } as React.CSSProperties}>
      <div className="site-shell">
      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow">Your voice. Refined. On your device.</p>
        <h1 id="page-title">Resonance<span className="title-dot">.</span></h1>
        <p className="intro-copy">Speak naturally. Get clear, polished text in the apps you use. Resonance transcribes and refines your words entirely on your computer.</p>
        <p className="supporting-copy">Hold a shortcut, say what’s on your mind, and release. Resonance cleans up the fillers and false starts, then puts the text where you’re writing.</p>
        <div className="micro-note"><span className="micro-dot" /> local models <span className="micro-slash">/</span> private by design</div>
        <div className="intro-actions">
          <a className="repo-badge" href="https://github.com/CoffeeCoder1015/Resonance">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.64-1.25-1.64-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.62 1.22 3.26.93.1-.73.39-1.22.71-1.5-2.5-.28-5.13-1.25-5.13-5.56 0-1.23.44-2.24 1.16-3.03-.12-.28-.5-1.43.11-2.99 0 0 .95-.3 3.09 1.16a10.7 10.7 0 0 1 5.63 0c2.14-1.45 3.08-1.16 3.08-1.16.62 1.56.23 2.71.12 2.99.72.79 1.16 1.8 1.16 3.03 0 4.32-2.64 5.27-5.15 5.55.4.35.76 1.03.76 2.08v3.1c0 .3.2.65.77.54A11.25 11.25 0 0 0 12 .75Z" /></svg>
            Visit the repo
          </a>
          <a className="story-link" href="#refinement">See what happens after you speak <span aria-hidden="true">↓</span></a>
        </div>
      </section>
      <section className="demo-area" aria-label="Browser transcription preview">
        <div className="demo-stage">
          <div ref={historyRef} className="transcript-history" role="log" aria-live="polite">
            {lines.map(line => <p className="transcript-line" key={line.id}>{line.text}</p>)}
            {interim && <p className="transcript-line transcript-interim">{interim}<span className="cursor-block" /></p>}
          </div>
          <div className="pill-dock"><TranscriptionPill status={status} elapsedSeconds={elapsedSeconds} visualTheme={activeTheme.id as VisualTheme} voiceState={voiceState} volume={microphoneLevel} frequencies={frequencies} microphoneLevel={microphoneLevel} hovered scale={1.2} themeHintVisible={themeHintVisible} themeHintText={themeHintText} onPrimaryAction={toggleTranscription} onExpand={cycleTheme} /></div>
        </div>
        <p className="widget-caption">Try the mic to preview transcription; tap the avatar to explore themes. This preview uses browser speech recognition, which may use online services, or sample text when unavailable. The desktop app runs transcription and refinement locally.</p>
      </section>
      </div>
      <RefinementStory theme={activeTheme.id as VisualTheme} />
      <footer className="page-footer"><span>© RESONANCE</span><span>Voice → text → your next idea.</span></footer>
    </main>
  );
}

export default App;
