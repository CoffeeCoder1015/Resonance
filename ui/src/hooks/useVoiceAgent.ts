import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentState,
  DialogueTurn,
  VisualTheme,
  VoiceInputMode,
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
  const [agentModeEnabled, setAgentModeEnabled] = useState(false);
  const [transcript, setTranscript] = useState<DialogueTurn[]>([
    {
      id: createTurnId('system'),
      sender: 'agent',
      text: 'Vibrant acoustic UI online! Feel free to talk or use the keyboard button for an upbeat conversation!',
      timestamp: formatTimestamp()
    }
  ]);

  const phaseRef = useRef<VoicePhase>('idle');
  const agentModeEnabledRef = useRef(false);
  const activeInputModeRef = useRef<VoiceInputMode | null>(null);
  const holdReleasePendingRef = useRef(false);
  const turnGenerationRef = useRef(0);
  const captureStartupRef = useRef<Promise<void> | null>(null);
  const captureStartupAbortRef = useRef<AbortController | null>(null);
  const captureRef = useRef<MicrophoneCapture | null>(null);
  const finishingCaptureRef = useRef<MicrophoneCapture | null>(null);
  const transcriptionAbortRef = useRef<AbortController | null>(null);

  const {
    enabled: speechOutputEnabled,
    speak,
    cancel: cancelSpeech,
    toggle: toggleSpeech
  } = useSpeechOutput();

  const setPhase = useCallback((nextPhase: VoicePhase) => {
    phaseRef.current = nextPhase;
    setPhaseValue(nextPhase);
  }, []);

  const setAgentMode = useCallback((enabled: boolean) => {
    agentModeEnabledRef.current = enabled;
    setAgentModeEnabled(enabled);
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

  const prepareForTurn = useCallback(async () => {
    const generation = ++turnGenerationRef.current;
    holdReleasePendingRef.current = false;

    captureStartupAbortRef.current?.abort();
    transcriptionAbortRef.current?.abort();
    transcriptionAbortRef.current = null;
    cancelSpeech();

    const capture = captureRef.current;
    const preserveAgentCapture =
      agentModeEnabledRef.current &&
      activeInputModeRef.current === 'agent' &&
      capture !== null;

    if (capture) {
      if (preserveAgentCapture) {
        await capture.discardAndPause();
      } else {
        captureRef.current = null;
        activeInputModeRef.current = null;
        await capture.dispose();
      }
    } else if (!agentModeEnabledRef.current) {
      activeInputModeRef.current = null;
    }

    finishingCaptureRef.current = null;
    setPhase('idle');
    setTranscript(turns =>
      turns.map(turn => (turn.isStreaming ? { ...turn, isStreaming: false } : turn))
    );
    return generation;
  }, [cancelSpeech, setPhase]);

  const resumeAgentListening = useCallback(
    async (generation: number) => {
      if (
        generation !== turnGenerationRef.current ||
        !agentModeEnabledRef.current ||
        activeInputModeRef.current !== 'agent'
      ) {
        return;
      }

      const capture = captureRef.current;
      if (!capture) {
        setAgentMode(false);
        setPhase('idle');
        return;
      }

      try {
        await capture.resume();
        if (
          generation === turnGenerationRef.current &&
          agentModeEnabledRef.current &&
          captureRef.current === capture
        ) {
          setPhase('listening');
        }
      } catch (error) {
        if (generation !== turnGenerationRef.current) return;
        console.error('Agent-mode microphone could not resume.', error);
        captureRef.current = null;
        activeInputModeRef.current = null;
        setAgentMode(false);
        await capture.dispose();
        appendTurn('agent', 'Microphone access is unavailable.');
        setPhase('idle');
      }
    },
    [appendTurn, setAgentMode, setPhase]
  );

  const settleTurn = useCallback(
    (generation: number) => {
      if (generation !== turnGenerationRef.current) return;
      if (
        agentModeEnabledRef.current &&
        activeInputModeRef.current === 'agent'
      ) {
        void resumeAgentListening(generation);
      } else {
        setPhase('idle');
      }
    },
    [resumeAgentListening, setPhase]
  );

  const startResponseOutput = useCallback(
    (replyText: string, generation: number) => {
      if (generation !== turnGenerationRef.current) return;

      appendTurn('agent', replyText);
      setPhase('speaking');

      const speechStarted = speak(replyText, {
        onComplete: () => settleTurn(generation)
      });
      if (!speechStarted) settleTurn(generation);
    },
    [appendTurn, setPhase, settleTurn, speak]
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
        settleTurn(generation);
      }
    },
    [appendTurn, processTranscript, setPhase, settleTurn]
  );

  const finishCaptureAndTranscribe = useCallback(
    async (capture: MicrophoneCapture, generation: number) => {
      if (
        generation !== turnGenerationRef.current ||
        captureRef.current !== capture ||
        finishingCaptureRef.current === capture
      ) {
        return;
      }

      finishingCaptureRef.current = capture;
      const mode = activeInputModeRef.current;
      setPhase('transcribing');

      try {
        const audio = await capture.finish();
        if (generation !== turnGenerationRef.current) return;

        if (mode !== 'agent') {
          if (captureRef.current === capture) captureRef.current = null;
          activeInputModeRef.current = null;
          await capture.dispose();
        }

        if (generation !== turnGenerationRef.current) return;
        if (!audio) {
          settleTurn(generation);
          return;
        }

        await transcribeRecording(audio, generation);
      } catch (error) {
        if (generation !== turnGenerationRef.current) return;
        if (captureRef.current === capture) captureRef.current = null;
        activeInputModeRef.current = null;
        setAgentMode(false);
        await capture.dispose();
        console.error('Recording failed.', error);
        appendTurn('agent', getErrorMessage(error, 'Recording failed.'));
        setPhase('idle');
      } finally {
        if (finishingCaptureRef.current === capture) {
          finishingCaptureRef.current = null;
        }
      }
    },
    [appendTurn, setAgentMode, setPhase, settleTurn, transcribeRecording]
  );

  const startCapture = useCallback(
    async (mode: VoiceInputMode) => {
      if (captureStartupRef.current) return captureStartupRef.current;

      let abortController: AbortController | null = null;
      const startup = (async () => {
        await prepareForTurn();
        const generation = turnGenerationRef.current;
        abortController = new AbortController();
        captureStartupAbortRef.current = abortController;
        activeInputModeRef.current = mode;
        setAgentMode(mode === 'agent');
        setPhase('acquiring-microphone');

        let capture: MicrophoneCapture;
        try {
          capture = await MicrophoneCapture.open(abortController.signal);
        } catch (error) {
          if (generation !== turnGenerationRef.current) return;

          console.warn('Microphone unavailable.', error);
          activeInputModeRef.current = null;
          setAgentMode(false);
          appendTurn('agent', 'Microphone access is unavailable.');
          setPhase('idle');
          return;
        }

        if (generation !== turnGenerationRef.current) {
          await capture.dispose();
          return;
        }

        captureRef.current = capture;
        try {
          await capture.start({
            mode,
            onUtterance: () => {
              void finishCaptureAndTranscribe(capture, generation);
            },
            onMaxDuration: () => {
              if (
                generation === turnGenerationRef.current &&
                captureRef.current === capture
              ) {
                void finishCaptureAndTranscribe(capture, generation);
              }
            }
          });
        } catch (error) {
          if (captureRef.current === capture) captureRef.current = null;
          activeInputModeRef.current = null;
          await capture.dispose();
          if (generation !== turnGenerationRef.current) return;

          console.error('Recording failed.', error);
          setAgentMode(false);
          appendTurn('agent', getErrorMessage(error, 'Recording failed.'));
          setPhase('idle');
          return;
        }

        if (
          generation !== turnGenerationRef.current ||
          captureRef.current !== capture
        ) {
          if (captureRef.current === capture) captureRef.current = null;
          activeInputModeRef.current = null;
          await capture.dispose();
          return;
        }

        setPhase('listening');
        if (mode === 'hold' && holdReleasePendingRef.current) {
          void finishCaptureAndTranscribe(capture, generation);
        }
      })();
      captureStartupRef.current = startup;

      try {
        await startup;
      } finally {
        if (captureStartupRef.current === startup) captureStartupRef.current = null;
        if (abortController && captureStartupAbortRef.current === abortController) {
          captureStartupAbortRef.current = null;
        }
      }
    },
    [
      appendTurn,
      finishCaptureAndTranscribe,
      prepareForTurn,
      setAgentMode,
      setPhase
    ]
  );

  const toggleListening = useCallback(async () => {
    if (agentModeEnabledRef.current) {
      setAgentMode(false);
      await prepareForTurn();
      return;
    }

    if (captureStartupRef.current) {
      await prepareForTurn();
      return;
    }

    const capture = captureRef.current;
    if (
      phaseRef.current === 'listening' &&
      activeInputModeRef.current === 'tap' &&
      capture
    ) {
      await finishCaptureAndTranscribe(capture, turnGenerationRef.current);
      return;
    }

    if (phaseRef.current !== 'idle') {
      await prepareForTurn();
      return;
    }

    await startCapture('tap');
  }, [finishCaptureAndTranscribe, prepareForTurn, setAgentMode, startCapture]);

  const beginHoldToTalk = useCallback(async () => {
    if (agentModeEnabledRef.current || phaseRef.current !== 'idle') return;
    holdReleasePendingRef.current = false;
    await startCapture('hold');
  }, [startCapture]);

  const endHoldToTalk = useCallback(async () => {
    if (activeInputModeRef.current !== 'hold') return;
    holdReleasePendingRef.current = true;

    const capture = captureRef.current;
    if (phaseRef.current === 'listening' && capture) {
      await finishCaptureAndTranscribe(capture, turnGenerationRef.current);
    }
  }, [finishCaptureAndTranscribe]);

  const enableAgentMode = useCallback(async () => {
    if (agentModeEnabledRef.current) return;
    await startCapture('agent');
  }, [startCapture]);

  const disableAgentMode = useCallback(async () => {
    if (!agentModeEnabledRef.current && activeInputModeRef.current !== 'agent') return;
    setAgentMode(false);
    await prepareForTurn();
  }, [prepareForTurn, setAgentMode]);

  const cancelCurrentTurn = useCallback(() => {
    void (async () => {
      const shouldResumeAgent =
        agentModeEnabledRef.current && activeInputModeRef.current === 'agent';
      const generation = await prepareForTurn();

      if (shouldResumeAgent && captureRef.current) {
        await resumeAgentListening(generation);
      } else if (shouldResumeAgent) {
        setAgentMode(false);
      }
    })();
  }, [prepareForTurn, resumeAgentListening, setAgentMode]);

  const submitTextTurn = useCallback(
    (userText: string, agentReply?: string) => {
      const text = userText.trim();
      if (!text) return;

      void (async () => {
        const generation = await prepareForTurn();
        if (generation !== turnGenerationRef.current) return;
        appendTurn('user', text);
        processTranscript(text, generation, agentReply);
      })();
    },
    [appendTurn, prepareForTurn, processTranscript]
  );

  const selectTheme = useCallback((theme: VisualTheme) => {
    setVisualTheme(theme);
  }, []);

  const toggleSpeechOutput = useCallback(() => {
    const nextEnabled = toggleSpeech();
    if (!nextEnabled && phaseRef.current === 'speaking') {
      settleTurn(turnGenerationRef.current);
    }
  }, [settleTurn, toggleSpeech]);

  useEffect(
    () => () => {
      turnGenerationRef.current += 1;
      captureStartupAbortRef.current?.abort();
      transcriptionAbortRef.current?.abort();
      transcriptionAbortRef.current = null;
      const capture = captureRef.current;
      captureRef.current = null;
      if (capture) void capture.dispose();
      cancelSpeech();
    },
    [cancelSpeech]
  );

  return {
    state,
    phase,
    visualTheme,
    transcript,
    speechOutputEnabled,
    agentModeEnabled,
    currentSpeechVolume,
    audioFrequencies,
    toggleListening,
    beginHoldToTalk,
    endHoldToTalk,
    enableAgentMode,
    disableAgentMode,
    submitTextTurn,
    toggleSpeechOutput,
    selectTheme,
    stopAgentSpeech: cancelCurrentTurn,
    setVisualTheme
  };
}
