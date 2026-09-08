import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DialogueTurn,
  VisualTheme,
  VoiceInputMode,
  VoicePhase
} from '../types/voice';
import { processText } from '../services/backend';
import { MicrophoneCapture } from '../services/microphoneCapture';
import { VoicePipeline } from '../services/voicePipeline';
import { voicePhaseToAgentState } from '../services/voiceState';
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
  const pipelineRef = useRef<VoicePipeline | null>(null);
  if (!pipelineRef.current) pipelineRef.current = new VoicePipeline();
  const pipeline = pipelineRef.current;
  const finishingCaptureRef = useRef<MicrophoneCapture | null>(null);
  const turnAbortRef = useRef<AbortController | null>(null);

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

  const ensureCapture = useCallback(() => pipeline.ensureCapture(), [pipeline]);
  const claimVoiceInput = useCallback(async () => {
    const bridge = window.resonanceDesktop;
    return bridge ? bridge.claimVoiceInput('desktop') : true;
  }, []);
  const releaseVoiceInput = useCallback(() => {
    window.resonanceDesktop?.releaseVoiceInput('desktop');
  }, []);

  const state = voicePhaseToAgentState(phase);
  const analyser = pipeline.analyser;
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

    turnAbortRef.current?.abort();
    turnAbortRef.current = null;
    cancelSpeech();
    pipeline.cancelPendingCapture();

    const capture = pipeline.activeCapture;
    const preserveAgentCapture =
      agentModeEnabledRef.current &&
      activeInputModeRef.current === 'agent' &&
      capture !== null;

    if (capture) {
      await pipeline.discardAndPause(capture);
      if (!preserveAgentCapture) {
        activeInputModeRef.current = null;
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
  }, [cancelSpeech, pipeline, setPhase]);

  const resumeAgentListening = useCallback(
    async (generation: number) => {
      if (
        generation !== turnGenerationRef.current ||
        !agentModeEnabledRef.current ||
        activeInputModeRef.current !== 'agent'
      ) {
        return;
      }

      const capture = pipeline.activeCapture;
      if (!capture) {
        setAgentMode(false);
        setPhase('idle');
        return;
      }

      try {
        await pipeline.resume(capture);
        if (
          generation === turnGenerationRef.current &&
          agentModeEnabledRef.current &&
          pipeline.owns(capture)
        ) {
          setPhase('listening');
        }
      } catch (error) {
        if (generation !== turnGenerationRef.current) return;
        console.error('Agent-mode microphone could not resume.', error);
        activeInputModeRef.current = null;
        setAgentMode(false);
        await pipeline.disposeCapture(capture);
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

  const transcribeRecording = useCallback(
    async (audio: Blob, generation: number) => {
      if (generation !== turnGenerationRef.current) return;

      setPhase('transcribing');
      const abortController = new AbortController();
      turnAbortRef.current = abortController;

      try {
        const result = await pipeline.process(audio, 'agent', abortController.signal);
        if (generation !== turnGenerationRef.current) return;
        if (!result.transcript) throw new Error('No speech was detected.');
        appendTurn('user', result.transcript);
        setPhase('responding');
        startResponseOutput(result.text, generation);
      } catch (error) {
        if (generation !== turnGenerationRef.current) return;

        console.error('Voice turn failed.', error);
        appendTurn('agent', getErrorMessage(error, 'Voice turn failed.'));
        settleTurn(generation);
      } finally {
        if (turnAbortRef.current === abortController) {
          turnAbortRef.current = null;
        }
      }
    },
    [
      appendTurn,
      setPhase,
      settleTurn,
      startResponseOutput
    ]
  );

  const finishCaptureAndTranscribe = useCallback(
    async (capture: MicrophoneCapture, generation: number) => {
      if (
        generation !== turnGenerationRef.current ||
        !pipeline.owns(capture) ||
        finishingCaptureRef.current === capture
      ) {
        return;
      }

      finishingCaptureRef.current = capture;
      const mode = activeInputModeRef.current;
      setPhase('transcribing');

      try {
        const audio = await pipeline.finish(capture);
        if (mode !== 'agent') {
          releaseVoiceInput();
        }
        if (generation !== turnGenerationRef.current) return;

        if (mode !== 'agent') {
          activeInputModeRef.current = null;
        }

        if (generation !== turnGenerationRef.current) return;
        if (!audio) {
          settleTurn(generation);
          return;
        }

        await transcribeRecording(audio, generation);
      } catch (error) {
        if (generation !== turnGenerationRef.current) return;
        activeInputModeRef.current = null;
        setAgentMode(false);
        await pipeline.disposeCapture(capture);
        console.error('Recording failed.', error);
        appendTurn('agent', getErrorMessage(error, 'Recording failed.'));
        setPhase('idle');
      } finally {
        if (mode !== 'agent') releaseVoiceInput();
        if (finishingCaptureRef.current === capture) {
          finishingCaptureRef.current = null;
        }
      }
    },
    [
      appendTurn,
      releaseVoiceInput,
      setAgentMode,
      setPhase,
      settleTurn,
      transcribeRecording
    ]
  );

  const startCapture = useCallback(
    async (mode: VoiceInputMode) => {
      if (captureStartupRef.current) return captureStartupRef.current;

      const startup = (async () => {
        await prepareForTurn();
        const generation = turnGenerationRef.current;
        if (!(await claimVoiceInput())) return;
        if (generation !== turnGenerationRef.current) {
          releaseVoiceInput();
          return;
        }
        activeInputModeRef.current = mode;
        setAgentMode(mode === 'agent');
        setPhase('acquiring-microphone');

        let capture = pipeline.activeCapture;
        try {
          if (!capture) capture = await ensureCapture();
        } catch (error) {
          releaseVoiceInput();
          if (generation !== turnGenerationRef.current) return;

          console.warn('Microphone unavailable.', error);
          activeInputModeRef.current = null;
          setAgentMode(false);
          appendTurn('agent', 'Microphone access is unavailable.');
          setPhase('idle');
          return;
        }

        if (generation !== turnGenerationRef.current) {
          await pipeline.discardAndPause(capture);
          releaseVoiceInput();
          return;
        }

        let captureReady = false;
        let finishPending = false;
        let startedCapture = capture;
        try {
          startedCapture = await pipeline.start({
            mode,
            onUtterance: () => {
              if (captureReady) {
                void finishCaptureAndTranscribe(startedCapture, generation);
              } else {
                finishPending = true;
              }
            }
          });
          capture = startedCapture;
        } catch (error) {
          activeInputModeRef.current = null;
          await pipeline.disposeCapture(capture);
          releaseVoiceInput();
          if (generation !== turnGenerationRef.current) return;

          console.error('Recording failed.', error);
          setAgentMode(false);
          appendTurn('agent', getErrorMessage(error, 'Recording failed.'));
          setPhase('idle');
          return;
        }

        captureReady = true;

        if (
          generation !== turnGenerationRef.current ||
          !pipeline.owns(capture)
        ) {
          activeInputModeRef.current = null;
          await pipeline.discardAndPause(capture);
          releaseVoiceInput();
          return;
        }

        setPhase('listening');
        if (finishPending || (mode === 'hold' && holdReleasePendingRef.current)) {
          void finishCaptureAndTranscribe(capture, generation);
        }
      })();
      captureStartupRef.current = startup;

      try {
        await startup;
      } finally {
        if (captureStartupRef.current === startup) captureStartupRef.current = null;
      }
    },
    [
      appendTurn,
      finishCaptureAndTranscribe,
      ensureCapture,
      claimVoiceInput,
      prepareForTurn,
      releaseVoiceInput,
      setAgentMode,
      setPhase
    ]
  );

  const toggleListening = useCallback(async () => {
    if (agentModeEnabledRef.current) {
      setAgentMode(false);
      await prepareForTurn();
      releaseVoiceInput();
      return;
    }

    if (captureStartupRef.current) {
      await prepareForTurn();
      return;
    }

    const capture = pipeline.activeCapture;
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
  }, [
    finishCaptureAndTranscribe,
    prepareForTurn,
    releaseVoiceInput,
    setAgentMode,
    startCapture
  ]);

  const beginHoldToTalk = useCallback(async () => {
    if (agentModeEnabledRef.current || phaseRef.current !== 'idle') return;
    holdReleasePendingRef.current = false;
    await startCapture('hold');
  }, [startCapture]);

  const endHoldToTalk = useCallback(async () => {
    if (activeInputModeRef.current !== 'hold') return;
    holdReleasePendingRef.current = true;

    const capture = pipeline.activeCapture;
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
    releaseVoiceInput();
  }, [prepareForTurn, releaseVoiceInput, setAgentMode]);

  const cancelCurrentTurn = useCallback(() => {
    void (async () => {
      const shouldResumeAgent =
        agentModeEnabledRef.current && activeInputModeRef.current === 'agent';
      const generation = await prepareForTurn();

      if (shouldResumeAgent && pipeline.activeCapture) {
        await resumeAgentListening(generation);
      } else if (shouldResumeAgent) {
        setAgentMode(false);
      }
    })();
  }, [prepareForTurn, resumeAgentListening, setAgentMode]);

  const submitTextTurn = useCallback(
    (userText: string) => {
      const text = userText.trim();
      if (!text) return;

      void (async () => {
        const generation = await prepareForTurn();
        if (generation !== turnGenerationRef.current) return;
        appendTurn('user', text);

        const abortController = new AbortController();
        turnAbortRef.current = abortController;
        setPhase('responding');
        try {
          const result = await processText(text, 'agent', abortController.signal);
          if (generation !== turnGenerationRef.current) return;
          startResponseOutput(result.text, generation);
        } catch (error) {
          if (generation !== turnGenerationRef.current) return;
          console.error('Text turn failed.', error);
          appendTurn('agent', getErrorMessage(error, 'Response failed.'));
          settleTurn(generation);
        } finally {
          if (turnAbortRef.current === abortController) {
            turnAbortRef.current = null;
          }
        }
      })();
    },
    [
      appendTurn,
      prepareForTurn,
      setPhase,
      settleTurn,
      startResponseOutput
    ]
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

  useEffect(() => {
    const bridge = window.resonanceDesktop;
    if (!bridge) return;
    return bridge.subscribeVoiceInputRevoked(async () => {
      turnGenerationRef.current += 1;
      turnAbortRef.current?.abort();
      turnAbortRef.current = null;
      activeInputModeRef.current = null;
      setAgentMode(false);
      cancelSpeech();
      setPhase('idle');
      await pipeline.pauseForHandoff();
    });
  }, [cancelSpeech, pipeline, setAgentMode, setPhase]);

  useEffect(
    () => () => {
      turnGenerationRef.current += 1;
      turnAbortRef.current?.abort();
      turnAbortRef.current = null;
      releaseVoiceInput();
      void pipeline.dispose();
      cancelSpeech();
    },
    [cancelSpeech, releaseVoiceInput]
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
