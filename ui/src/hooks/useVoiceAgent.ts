import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentState,
  DialogueTurn,
  VisualTheme,
  VoicePhase
} from '../types/voice';
import { transcribeAudio } from '../services/asr';
import { MicrophoneCapture } from '../services/microphoneCapture';
import { formatTimestamp } from '../utils/dialogueEngine';
import { useAudioVisualization } from './useAudioVisualization';
import { useSpeechOutput } from './useSpeechOutput';

const DEFAULT_THEME: VisualTheme = 'clay-blob';

function createTurnId(prefix: 'user' | 'agent' | 'system') {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Date.now().toString(36);
  return `${prefix}-${id}`;
}

function toAgentState(phase: VoicePhase): AgentState {
  switch (phase) {
    case 'listening':
      return 'listening';
    case 'transcribing':
    case 'responding':
      return 'processing';
    case 'speaking':
      return 'speaking';
    case 'acquiring-microphone':
    case 'idle':
      return 'idle';
  }
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function useVoiceAgent() {
  const [phase, setPhaseValue] = useState<VoicePhase>('idle');
  const [visualTheme, setVisualTheme] = useState<VisualTheme>(DEFAULT_THEME);
  const [transcript, setTranscript] = useState<DialogueTurn[]>([
    {
      id: createTurnId('system'),
      sender: 'agent',
      text: 'Vibrant acoustic UI online! Feel free to talk or use the keyboard button for an upbeat conversation!',
      timestamp: formatTimestamp()
    }
  ]);

  const phaseRef = useRef<VoicePhase>('idle');
  const turnGenerationRef = useRef(0);
  const captureStartupRef = useRef<Promise<void> | null>(null);
  const captureStartupAbortRef = useRef<AbortController | null>(null);
  const captureRef = useRef<MicrophoneCapture | null>(null);
  const transcriptionAbortRef = useRef<AbortController | null>(null);

  const {
    enabled: speechOutputEnabled,
    canSpeak,
    speak,
    cancel: cancelSpeech,
    toggle: toggleSpeech
  } = useSpeechOutput();

  const setPhase = useCallback((nextPhase: VoicePhase) => {
    phaseRef.current = nextPhase;
    setPhaseValue(nextPhase);
  }, []);

  const state = toAgentState(phase);
  const analyser = captureRef.current?.analyser ?? null;
  const { currentSpeechVolume, audioFrequencies } = useAudioVisualization(state, analyser);

  const appendTurn = useCallback((sender: DialogueTurn['sender'], text: string) => {
    setTranscript(turns => [
      ...turns,
      {
        id: createTurnId(sender),
        sender,
        text,
        timestamp: formatTimestamp()
      }
    ]);
  }, []);

  const cancelCurrentTurn = useCallback(() => {
    turnGenerationRef.current += 1;

    captureStartupAbortRef.current?.abort();
    transcriptionAbortRef.current?.abort();
    transcriptionAbortRef.current = null;

    captureRef.current?.dispose();
    captureRef.current = null;
    cancelSpeech();

    setPhase('idle');
    setTranscript(turns =>
      turns.map(turn => (turn.isStreaming ? { ...turn, isStreaming: false } : turn))
    );
  }, [cancelSpeech, setPhase]);

  const startResponseOutput = useCallback(
    (replyText: string, generation: number) => {
      if (generation !== turnGenerationRef.current) return;

      appendTurn('agent', replyText);
      setPhase('speaking');

      const speechStarted = speak(replyText, {
        onComplete: () => {
          if (generation === turnGenerationRef.current) setPhase('idle');
        }
      });
      if (!speechStarted) setPhase('idle');
    },
    [appendTurn, setPhase, speak]
  );

  const processTranscript = useCallback(
    (userPrompt: string, generation: number, overrideReply?: string) => {
      if (generation !== turnGenerationRef.current) return;

      setPhase('responding');
      startResponseOutput(overrideReply ?? userPrompt, generation);
    },
    [setPhase, startResponseOutput]
  );

  const transcribeRecording = useCallback(
    async (audio: Blob, generation: number) => {
      if (generation !== turnGenerationRef.current) return;

      setPhase('transcribing');
      const abortController = new AbortController();
      transcriptionAbortRef.current = abortController;

      try {
        const text = await transcribeAudio(audio, abortController.signal);
        if (transcriptionAbortRef.current === abortController) {
          transcriptionAbortRef.current = null;
        }
        if (generation !== turnGenerationRef.current) return;
        if (!text) throw new Error('No speech was detected.');

        appendTurn('user', text);
        processTranscript(text, generation, text);
      } catch (error) {
        if (transcriptionAbortRef.current === abortController) {
          transcriptionAbortRef.current = null;
        }
        if (generation !== turnGenerationRef.current) return;

        console.error('Transcription failed.', error);
        appendTurn('agent', getErrorMessage(error, 'Transcription failed.'));
        setPhase('idle');
      }
    },
    [appendTurn, processTranscript, setPhase]
  );

  const finishCaptureAndTranscribe = useCallback(async () => {
    if (phaseRef.current !== 'listening') return;

    const capture = captureRef.current;
    captureRef.current = null;
    if (!capture) {
      cancelCurrentTurn();
      return;
    }

    const generation = turnGenerationRef.current;
    setPhase('transcribing');

    let audio: Blob;
    try {
      audio = capture.stop();
    } catch (error) {
      if (generation !== turnGenerationRef.current) return;

      console.error('Recording failed.', error);
      appendTurn('agent', getErrorMessage(error, 'Recording failed.'));
      setPhase('idle');
      return;
    } finally {
      capture.dispose();
    }

    if (generation !== turnGenerationRef.current) return;
    await transcribeRecording(audio, generation);
  }, [appendTurn, cancelCurrentTurn, setPhase, transcribeRecording]);

  const startCapture = useCallback(async () => {
    if (captureStartupRef.current) return captureStartupRef.current;

    cancelCurrentTurn();
    const generation = turnGenerationRef.current;
    const abortController = new AbortController();
    captureStartupAbortRef.current = abortController;
    setPhase('acquiring-microphone');

    const startup = (async () => {
      let capture: MicrophoneCapture;
      try {
        capture = await MicrophoneCapture.open(abortController.signal);
      } catch (error) {
        if (generation !== turnGenerationRef.current) return;

        console.warn('Microphone unavailable.', error);
        appendTurn('agent', 'Microphone access is unavailable.');
        setPhase('idle');
        return;
      }

      if (generation !== turnGenerationRef.current) {
        capture.dispose();
        return;
      }

      captureRef.current = capture;
      try {
        await capture.start({
          onMaxDuration: () => {
            if (
              generation === turnGenerationRef.current &&
              captureRef.current === capture
            ) {
              void finishCaptureAndTranscribe();
            }
          }
        });
      } catch (error) {
        if (captureRef.current === capture) captureRef.current = null;
        capture.dispose();
        if (generation !== turnGenerationRef.current) return;

        console.error('Recording failed.', error);
        appendTurn('agent', getErrorMessage(error, 'Recording failed.'));
        setPhase('idle');
        return;
      }

      if (
        generation !== turnGenerationRef.current ||
        captureRef.current !== capture
      ) {
        if (captureRef.current === capture) captureRef.current = null;
        capture.dispose();
        return;
      }

      setPhase('listening');
    })();
    captureStartupRef.current = startup;

    try {
      await startup;
    } finally {
      if (captureStartupRef.current === startup) captureStartupRef.current = null;
      if (captureStartupAbortRef.current === abortController) {
        captureStartupAbortRef.current = null;
      }
    }
  }, [appendTurn, cancelCurrentTurn, finishCaptureAndTranscribe, setPhase]);

  const toggleListening = useCallback(async () => {
    if (captureStartupRef.current) {
      cancelCurrentTurn();
      return;
    }

    if (phaseRef.current === 'listening') {
      await finishCaptureAndTranscribe();
      return;
    }

    if (phaseRef.current !== 'idle') {
      cancelCurrentTurn();
      return;
    }

    await startCapture();
  }, [cancelCurrentTurn, finishCaptureAndTranscribe, startCapture]);

  const submitTextTurn = useCallback(
    (userText: string, agentReply?: string) => {
      const text = userText.trim();
      if (!text) return;

      cancelCurrentTurn();
      const generation = turnGenerationRef.current;
      appendTurn('user', text);
      processTranscript(text, generation, agentReply);
    },
    [appendTurn, cancelCurrentTurn, processTranscript]
  );

  const selectTheme = useCallback((theme: VisualTheme) => {
    setVisualTheme(theme);
  }, []);

  const toggleSpeechOutput = useCallback(() => {
    const nextEnabled = toggleSpeech();
    if (!nextEnabled && phaseRef.current === 'speaking') setPhase('idle');
  }, [setPhase, toggleSpeech]);

  const replayLastResponse = useCallback(() => {
    if (!canSpeak()) return;

    const lastResponse = [...transcript]
      .reverse()
      .find(turn => turn.sender === 'agent' && turn.text.trim().length > 0);
    if (!lastResponse) return;

    cancelCurrentTurn();
    const generation = turnGenerationRef.current;
    setPhase('speaking');
    const speechStarted = speak(lastResponse.text, {
      onComplete: () => {
        if (generation === turnGenerationRef.current) setPhase('idle');
      }
    });
    if (!speechStarted) setPhase('idle');
  }, [canSpeak, cancelCurrentTurn, setPhase, speak, transcript]);

  useEffect(
    () => () => {
      turnGenerationRef.current += 1;
      captureStartupAbortRef.current?.abort();
      transcriptionAbortRef.current?.abort();
      transcriptionAbortRef.current = null;
      captureRef.current?.dispose();
      captureRef.current = null;
      cancelSpeech();
    },
    [cancelSpeech]
  );

  return {
    state,
    visualTheme,
    transcript,
    speechOutputEnabled,
    canReplayResponse: transcript.some(
      turn => turn.sender === 'agent' && turn.text.trim().length > 0
    ),
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
