import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentState, DialogueTurn, VisualTheme } from '../types/voice';
import { transcribeAudio } from '../services/asr';
import { WavRecorder } from '../services/wavRecorder';
import { formatTimestamp } from '../utils/dialogueEngine';

interface VoiceWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

const DEFAULT_THEME: VisualTheme = 'clay-blob';
const SIGNAL_UPDATE_INTERVAL_MS = 50;

function createTurnId(prefix: 'user' | 'agent' | 'system') {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now().toString(36);
  return `${prefix}-${id}`;
}

export function useVoiceAgent() {
  const [state, setStateValue] = useState<AgentState>('idle');
  const [visualTheme, setVisualTheme] = useState<VisualTheme>(DEFAULT_THEME);
  const [transcript, setTranscript] = useState<DialogueTurn[]>([
    {
      id: createTurnId('system'),
      sender: 'agent',
      text: 'Vibrant acoustic UI online! Feel free to talk or use the keyboard button for an upbeat conversation!',
      timestamp: formatTimestamp()
    }
  ]);
  const [speechOutputEnabled, setSpeechOutputEnabled] = useState(true);
  const [currentSpeechVolume, setCurrentSpeechVolume] = useState(0.05);
  const [audioFrequencies, setAudioFrequencies] = useState<Uint8Array>(() => new Uint8Array(64).fill(12));

  const stateRef = useRef<AgentState>('idle');
  const speechOutputEnabledRef = useRef(true);
  const turnGenerationRef = useRef(0);
  const wavRecorderRef = useRef<WavRecorder | null>(null);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  const microphoneInitializationRef = useRef<Promise<boolean> | null>(null);
  const captureStartInProgressRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const microphoneRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const timeoutIdsRef = useRef<Set<number>>(new Set());

  const setState = useCallback((next: AgentState) => {
    stateRef.current = next;
    setStateValue(next);
  }, []);

  const schedule = useCallback((callback: () => void, delay: number) => {
    const timeoutId = window.setTimeout(() => {
      timeoutIdsRef.current.delete(timeoutId);
      callback();
    }, delay);
    timeoutIdsRef.current.add(timeoutId);
    return timeoutId;
  }, []);

  const clearScheduledWork = useCallback(() => {
    timeoutIdsRef.current.forEach(timeoutId => window.clearTimeout(timeoutId));
    timeoutIdsRef.current.clear();
  }, []);

  const releaseMicrophone = useCallback(() => {
    microphoneRef.current?.disconnect();
    microphoneRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    analyserRef.current = null;

    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== 'closed') {
      void context.close().catch(() => undefined);
    }
  }, []);

  const cancelCurrentTurn = useCallback(() => {
    turnGenerationRef.current += 1;
    clearScheduledWork();

    transcriptionAbortRef.current?.abort();
    transcriptionAbortRef.current = null;

    wavRecorderRef.current?.cancel();
    wavRecorderRef.current = null;
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    releaseMicrophone();
    setState('idle');
    setTranscript(turns => turns.map(turn => (turn.isStreaming ? { ...turn, isStreaming: false } : turn)));
  }, [clearScheduledWork, releaseMicrophone, setState]);

  const startAgentSpeech = useCallback(
    (replyText: string, generation: number) => {
      if (generation !== turnGenerationRef.current) return;
      setState('speaking');

      const agentTurnId = createTurnId('agent');
      setTranscript(turns => [
        ...turns,
        {
          id: agentTurnId,
          sender: 'agent',
          text: '',
          timestamp: formatTimestamp(),
          isStreaming: true
        }
      ]);

      let speechWillSignalCompletion = false;
      if (speechOutputEnabledRef.current && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(replyText);
        utterance.rate = 1.02;
        utterance.pitch = 1.04;

        const voices = window.speechSynthesis.getVoices();
        const preferredVoice =
          voices.find(
            voice =>
              voice.lang.startsWith('en') &&
              ['Natural', 'Samantha', 'Google', 'Karen'].some(name => voice.name.includes(name))
          ) ?? voices[0];
        if (preferredVoice) utterance.voice = preferredVoice;

        utterance.onend = () => {
          if (generation === turnGenerationRef.current) setState('idle');
        };
        utterance.onerror = () => {
          if (generation === turnGenerationRef.current) setState('idle');
        };

        try {
          window.speechSynthesis.speak(utterance);
          speechWillSignalCompletion = true;
        } catch {
          speechWillSignalCompletion = false;
        }
      }

      let characterIndex = 0;
      const streamText = () => {
        if (generation !== turnGenerationRef.current) return;

        if (characterIndex <= replyText.length) {
          const nextText = replyText.slice(0, characterIndex);
          setTranscript(turns =>
            turns.map(turn =>
              turn.id === agentTurnId
                ? { ...turn, text: nextText, isStreaming: characterIndex < replyText.length }
                : turn
            )
          );
          characterIndex += Math.floor(Math.random() * 3) + 2;
          schedule(streamText, 24);
          return;
        }

        setTranscript(turns =>
          turns.map(turn => (turn.id === agentTurnId ? { ...turn, text: replyText, isStreaming: false } : turn))
        );
        if (!speechWillSignalCompletion) {
          schedule(() => {
            if (generation === turnGenerationRef.current) setState('idle');
          }, 350);
        }
      };

      streamText();
    },
    [schedule, setState]
  );

  const handleAgentProcessing = useCallback(
    (userPrompt: string, generation: number, overrideReply?: string) => {
      if (generation !== turnGenerationRef.current) return;
      setState('processing');
      schedule(() => {
        if (generation !== turnGenerationRef.current) return;
        startAgentSpeech(overrideReply ?? userPrompt, generation);
      }, 180);
    },
    [schedule, setState, startAgentSpeech]
  );

  const initMicrophone = useCallback(async (generation: number) => {
    if (streamRef.current) return true;
    if (microphoneInitializationRef.current) {
      return microphoneInitializationRef.current;
    }

    const initialization = (async () => {
      let stream: MediaStream | null = null;
      let context: AudioContext | null = null;
      let microphone: MediaStreamAudioSourceNode | null = null;

      const releasePendingResources = () => {
        microphone?.disconnect();
        stream?.getTracks().forEach(track => track.stop());
        if (context && context.state !== 'closed') {
          void context.close().catch(() => undefined);
        }
      };

      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (generation !== turnGenerationRef.current) {
          releasePendingResources();
          return false;
        }

        const voiceWindow = window as VoiceWindow;
        const AudioContextConstructor = window.AudioContext ?? voiceWindow.webkitAudioContext;
        if (!AudioContextConstructor) throw new Error('Web Audio is unavailable.');

        context = new AudioContextConstructor();
        const analyser = context.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.75;

        microphone = context.createMediaStreamSource(stream);
        microphone.connect(analyser);

        if (generation !== turnGenerationRef.current) {
          releasePendingResources();
          return false;
        }

        streamRef.current = stream;
        audioContextRef.current = context;
        analyserRef.current = analyser;
        microphoneRef.current = microphone;
        return true;
      } catch (error) {
        console.warn('Microphone unavailable.', error);
        releasePendingResources();
        return false;
      }
    })();

    microphoneInitializationRef.current = initialization;
    try {
      return await initialization;
    } finally {
      if (microphoneInitializationRef.current === initialization) {
        microphoneInitializationRef.current = null;
      }
    }
  }, []);

  const finishListening = useCallback(async () => {
    if (stateRef.current !== 'listening') return;

    const recorder = wavRecorderRef.current;
    wavRecorderRef.current = null;
    if (!recorder) {
      cancelCurrentTurn();
      return;
    }

    const generation = turnGenerationRef.current;
    setState('processing');

    let abortController: AbortController | null = null;
    try {
      const audio = recorder.stop();
      releaseMicrophone();
      abortController = new AbortController();
      transcriptionAbortRef.current = abortController;
      const text = await transcribeAudio(audio, abortController.signal);

      if (transcriptionAbortRef.current === abortController) {
        transcriptionAbortRef.current = null;
      }
      if (generation !== turnGenerationRef.current) return;
      if (!text) throw new Error('No speech was detected.');

      setTranscript(turns => [
        ...turns,
        {
          id: createTurnId('user'),
          sender: 'user',
          text,
          timestamp: formatTimestamp()
        }
      ]);
      handleAgentProcessing(text, generation, text);
    } catch (error) {
      if (abortController && transcriptionAbortRef.current === abortController) {
        transcriptionAbortRef.current = null;
      }
      releaseMicrophone();
      if (generation !== turnGenerationRef.current) return;

      console.error('Transcription failed.', error);
      setTranscript(turns => [
        ...turns,
        {
          id: createTurnId('agent'),
          sender: 'agent',
          text: error instanceof Error ? error.message : 'Transcription failed.',
          timestamp: formatTimestamp()
        }
      ]);
      setState('idle');
    }
  }, [cancelCurrentTurn, handleAgentProcessing, releaseMicrophone, setState]);

  const toggleListening = useCallback(async () => {
    if (stateRef.current === 'listening') {
      await finishListening();
      return;
    }

    if (microphoneInitializationRef.current) {
      cancelCurrentTurn();
      return;
    }

    if (captureStartInProgressRef.current) {
      cancelCurrentTurn();
      return;
    }

    if (stateRef.current !== 'idle') {
      cancelCurrentTurn();
      return;
    }

    cancelCurrentTurn();
    const generation = turnGenerationRef.current;
    captureStartInProgressRef.current = true;

    try {
      const hasMicrophone = await initMicrophone(generation);
      if (generation !== turnGenerationRef.current) return;
      if (!hasMicrophone) {
        setTranscript(turns => [
          ...turns,
          {
            id: createTurnId('agent'),
            sender: 'agent',
            text: 'Microphone access is unavailable.',
            timestamp: formatTimestamp()
          }
        ]);
        return;
      }

      const context = audioContextRef.current;
      const microphone = microphoneRef.current;
      if (!context || !microphone) throw new Error('Microphone initialization failed.');
      if (context.state === 'suspended') await context.resume();

      if (generation !== turnGenerationRef.current) {
        releaseMicrophone();
        return;
      }

      const recorder = new WavRecorder(context, microphone, {
        onMaxDuration: () => {
          void finishListening();
        }
      });
      recorder.start();
      wavRecorderRef.current = recorder;
      setState('listening');
    } catch (error) {
      if (generation !== turnGenerationRef.current) return;

      console.error('Recording failed.', error);
      releaseMicrophone();
      setTranscript(turns => [
        ...turns,
        {
          id: createTurnId('agent'),
          sender: 'agent',
          text: error instanceof Error ? error.message : 'Recording failed.',
          timestamp: formatTimestamp()
        }
      ]);
      setState('idle');
    } finally {
      captureStartInProgressRef.current = false;
    }
  }, [
    cancelCurrentTurn,
    finishListening,
    initMicrophone,
    releaseMicrophone,
    setState
  ]);

  const submitTextTurn = useCallback(
    (userText: string, agentReply?: string) => {
      const text = userText.trim();
      if (!text) return;

      cancelCurrentTurn();
      const generation = turnGenerationRef.current;
      setTranscript(turns => [
        ...turns,
        {
          id: createTurnId('user'),
          sender: 'user',
          text,
          timestamp: formatTimestamp()
        }
      ]);
      handleAgentProcessing(text, generation, agentReply);
    },
    [cancelCurrentTurn, handleAgentProcessing]
  );

  const selectTheme = useCallback((theme: VisualTheme) => {
    setVisualTheme(theme);
  }, []);

  const toggleSpeechOutput = useCallback(() => {
    setSpeechOutputEnabled(enabled => {
      const nextEnabled = !enabled;
      speechOutputEnabledRef.current = nextEnabled;
      if (!nextEnabled && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        if (stateRef.current === 'speaking') setState('idle');
      }
      return nextEnabled;
    });
  }, [setState]);

  const replayLastResponse = useCallback(() => {
    if (!speechOutputEnabledRef.current || !('speechSynthesis' in window)) return;
    const lastResponse = [...transcript]
      .reverse()
      .find(turn => turn.sender === 'agent' && turn.text.trim().length > 0);
    if (!lastResponse) return;

    cancelCurrentTurn();
    const generation = turnGenerationRef.current;
    const utterance = new SpeechSynthesisUtterance(lastResponse.text);
    utterance.rate = 1.02;
    utterance.pitch = 1.04;

    const voices = window.speechSynthesis.getVoices();
    const preferredVoice =
      voices.find(
        voice =>
          voice.lang.startsWith('en') &&
          ['Natural', 'Samantha', 'Google', 'Karen'].some(name => voice.name.includes(name))
      ) ?? voices[0];
    if (preferredVoice) utterance.voice = preferredVoice;

    utterance.onend = () => {
      if (generation === turnGenerationRef.current) setState('idle');
    };
    utterance.onerror = () => {
      if (generation === turnGenerationRef.current) setState('idle');
    };

    try {
      setState('speaking');
      window.speechSynthesis.speak(utterance);
    } catch {
      setState('idle');
    }
  }, [cancelCurrentTurn, setState, transcript]);

  useEffect(() => {
    let lastSignalUpdate = 0;
    let lastSignalState: AgentState | null = null;

    const updateAudioSignal = (timestamp: number) => {
      const currentState = stateRef.current;
      const shouldUpdate =
        currentState !== lastSignalState || timestamp - lastSignalUpdate >= SIGNAL_UPDATE_INTERVAL_MS;

      if (shouldUpdate) {
        lastSignalState = currentState;
        lastSignalUpdate = timestamp;

        if (currentState === 'listening' && analyserRef.current) {
          const data = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(data);
          const average = data.reduce((sum, value) => sum + value, 0) / (data.length || 1);
          setCurrentSpeechVolume(Math.min(1, (average / 128) * 1.6));
          setAudioFrequencies(data);
        } else if (currentState === 'speaking') {
          const time = Date.now() / 130;
          const data = new Uint8Array(64);
          let sum = 0;
          for (let index = 0; index < data.length; index += 1) {
            const value = Math.floor(
              (Math.sin(time * 1.7 + index * 0.28) * 0.45 +
                Math.cos(time * 0.9 - index * 0.38) * 0.45 +
                0.5) *
                235 *
                (Math.random() * 0.2 + 0.8)
            );
            data[index] = Math.max(15, Math.min(255, value));
            sum += data[index];
          }
          setCurrentSpeechVolume(Math.min(1, (sum / data.length / 255) * 1.95));
          setAudioFrequencies(data);
        } else if (currentState === 'processing') {
          const time = Date.now() / 65;
          const data = new Uint8Array(64);
          for (let index = 0; index < data.length; index += 1) {
            data[index] = Math.floor((Math.sin(time + index * 0.25) + 1) * 80);
          }
          setCurrentSpeechVolume(0.38);
          setAudioFrequencies(data);
        } else if (currentState === 'idle') {
          setCurrentSpeechVolume(0.05);
          setAudioFrequencies(new Uint8Array(64).fill(12));
        }
      }

      animationFrameRef.current = window.requestAnimationFrame(updateAudioSignal);
    };

    animationFrameRef.current = window.requestAnimationFrame(updateAudioSignal);
    return () => {
      if (animationFrameRef.current) window.cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  useEffect(
    () => () => {
      turnGenerationRef.current += 1;
      clearScheduledWork();
      transcriptionAbortRef.current?.abort();
      wavRecorderRef.current?.cancel();
      releaseMicrophone();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    },
    [clearScheduledWork, releaseMicrophone]
  );

  return {
    state,
    visualTheme,
    transcript,
    speechOutputEnabled,
    canReplayResponse: transcript.some(turn => turn.sender === 'agent' && turn.text.trim().length > 0),
    currentSpeechVolume,
    audioFrequencies,
    toggleListening,
    submitTextTurn,
    toggleSpeechOutput,
    replayLastResponse,
    selectTheme,
    stopAgentSpeech: cancelCurrentTurn,
    setVisualTheme
  };
}
