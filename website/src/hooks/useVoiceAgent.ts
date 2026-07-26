import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentState, DialogueTurn, VisualTheme } from '../types/voice';
import { formatTimestamp, getIntelligentResponse, SIMULATED_CONVERSATIONS } from '../utils/dialogueEngine';

interface VoiceWindow extends Window {
  SpeechRecognition?: new () => any;
  webkitSpeechRecognition?: new () => any;
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
  const [hasMicPermission, setHasMicPermission] = useState<boolean | null>(null);
  const [speechRecognitionSupported, setSpeechRecognitionSupported] = useState<boolean | null>(null);
  const [speechOutputEnabled, setSpeechOutputEnabled] = useState(true);
  const [currentSpeechVolume, setCurrentSpeechVolume] = useState(0.05);
  const [audioFrequencies, setAudioFrequencies] = useState<Uint8Array>(() => new Uint8Array(64).fill(12));

  const stateRef = useRef<AgentState>('idle');
  const speechOutputEnabledRef = useRef(true);
  const turnGenerationRef = useRef(0);
  const recognitionRef = useRef<any>(null);
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

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // The recognition session may already be closed.
      }
    }
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
        startAgentSpeech(overrideReply ?? getIntelligentResponse(userPrompt), generation);
      }, Math.floor(Math.random() * 350) + 650);
    },
    [schedule, setState, startAgentSpeech]
  );

  const startSimulatedListening = useCallback(
    (generation: number) => {
      setState('listening');
      const topic = SIMULATED_CONVERSATIONS[Math.floor(Math.random() * SIMULATED_CONVERSATIONS.length)];
      const userTurnId = createTurnId('user');

      setTranscript(turns => [
        ...turns,
        {
          id: userTurnId,
          sender: 'user',
          text: '',
          timestamp: formatTimestamp(),
          isStreaming: true
        }
      ]);

      let characterIndex = 0;
      const streamUserText = () => {
        if (generation !== turnGenerationRef.current) return;

        if (characterIndex <= topic.userPrompt.length) {
          const nextText = topic.userPrompt.slice(0, characterIndex);
          setTranscript(turns =>
            turns.map(turn =>
              turn.id === userTurnId
                ? { ...turn, text: nextText, isStreaming: characterIndex < topic.userPrompt.length }
                : turn
            )
          );
          characterIndex += Math.floor(Math.random() * 4) + 2;
          schedule(streamUserText, 40);
          return;
        }

        setTranscript(turns =>
          turns.map(turn =>
            turn.id === userTurnId ? { ...turn, text: topic.userPrompt, isStreaming: false } : turn
          )
        );
        handleAgentProcessing(topic.userPrompt, generation, topic.agentResponse);
      };

      streamUserText();
    },
    [handleAgentProcessing, schedule, setState]
  );

  const initMicrophone = useCallback(async () => {
    if (streamRef.current) return true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const voiceWindow = window as VoiceWindow;
      const AudioContextConstructor = window.AudioContext ?? voiceWindow.webkitAudioContext;
      if (!AudioContextConstructor) throw new Error('Web Audio is unavailable.');

      const context = new AudioContextConstructor();
      const analyser = context.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.75;

      const microphone = context.createMediaStreamSource(stream);
      microphone.connect(analyser);

      streamRef.current = stream;
      audioContextRef.current = context;
      analyserRef.current = analyser;
      microphoneRef.current = microphone;
      setHasMicPermission(true);
      return true;
    } catch (error) {
      console.warn('Microphone unavailable. Using demo mode.', error);
      setHasMicPermission(false);
      releaseMicrophone();
      return false;
    }
  }, [releaseMicrophone]);

  const toggleListening = useCallback(async () => {
    if (stateRef.current !== 'idle') {
      cancelCurrentTurn();
      return;
    }

    cancelCurrentTurn();
    const generation = turnGenerationRef.current;

    if (!speechRecognitionSupported || !recognitionRef.current) {
      startSimulatedListening(generation);
      return;
    }

    const hasMicrophone = await initMicrophone();
    if (generation !== turnGenerationRef.current) return;
    if (!hasMicrophone) {
      startSimulatedListening(generation);
      return;
    }

    try {
      recognitionRef.current.start();
      setState('listening');
    } catch {
      releaseMicrophone();
      startSimulatedListening(generation);
    }
  }, [
    cancelCurrentTurn,
    initMicrophone,
    releaseMicrophone,
    setState,
    speechRecognitionSupported,
    startSimulatedListening
  ]);

  const triggerSimulatedTurn = useCallback(
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
    const voiceWindow = window as VoiceWindow;
    const SpeechRecognitionConstructor =
      voiceWindow.SpeechRecognition ?? voiceWindow.webkitSpeechRecognition;
    setSpeechRecognitionSupported(Boolean(SpeechRecognitionConstructor));
    if (!SpeechRecognitionConstructor) return;

    const recognition = new SpeechRecognitionConstructor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => setState('listening');
    recognition.onresult = (event: any) => {
      let interimText = '';
      let finalText = '';

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalText += result[0].transcript;
        else interimText += result[0].transcript;
      }

      const activeText = finalText || interimText;
      if (activeText) {
        setTranscript(turns => {
          const previous = turns[turns.length - 1];
          if (previous?.sender === 'user' && previous.isStreaming) {
            return [...turns.slice(0, -1), { ...previous, text: activeText, isStreaming: !finalText }];
          }
          return [
            ...turns,
            {
              id: createTurnId('user'),
              sender: 'user',
              text: activeText,
              timestamp: formatTimestamp(),
              isStreaming: !finalText
            }
          ];
        });
      }

      if (finalText) {
        const generation = turnGenerationRef.current;
        schedule(() => handleAgentProcessing(finalText, generation), 250);
      }
    };
    recognition.onerror = () => {
      if (stateRef.current === 'listening') setState('idle');
      releaseMicrophone();
    };
    recognition.onend = () => {
      if (stateRef.current === 'listening') setState('idle');
      releaseMicrophone();
    };

    recognitionRef.current = recognition;
    return () => {
      try {
        recognition.abort();
      } catch {
        // The recognition session may already be closed.
      }
      if (recognitionRef.current === recognition) recognitionRef.current = null;
    };
  }, [handleAgentProcessing, releaseMicrophone, schedule, setState]);

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
      releaseMicrophone();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    },
    [clearScheduledWork, releaseMicrophone]
  );

  return {
    state,
    visualTheme,
    transcript,
    hasMicPermission,
    speechRecognitionSupported,
    speechOutputEnabled,
    canReplayResponse: transcript.some(turn => turn.sender === 'agent' && turn.text.trim().length > 0),
    currentSpeechVolume,
    audioFrequencies,
    toggleListening,
    triggerSimulatedTurn,
    toggleSpeechOutput,
    replayLastResponse,
    selectTheme,
    stopAgentSpeech: cancelCurrentTurn,
    setVisualTheme
  };
}
