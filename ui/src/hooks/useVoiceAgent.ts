import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentState,
  DialogueTurn,
  VisualTheme,
  VoiceInputMode,
  VoicePhase
} from '../types/voice';
import {
  createTextTurn,
  createVoiceTurn,
  type PipelineMode,
  waitForTurn
} from '../services/backend';
import { MicrophoneCapture } from '../services/microphoneCapture';
import { formatTimestamp } from '../utils/dialogueEngine';
import { useAudioVisualization } from './useAudioVisualization';
import { useSpeechOutput } from './useSpeechOutput';
import type { PillStatus } from '../components/transcription-pill/pillPresentation';

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
  const [transcriptionPillStatus, setTranscriptionPillStatus] =
    useState<PillStatus>('idle');
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
  const activePipelineModeRef = useRef<PipelineMode | null>(null);
  const insertionSessionRef = useRef<string | null>(null);
  const holdReleasePendingRef = useRef(false);
  const transcriptionHoldRequestedRef = useRef(false);
  const turnGenerationRef = useRef(0);
  const captureStartupRef = useRef<Promise<void> | null>(null);
  const captureStartupAbortRef = useRef<AbortController | null>(null);
  const captureRef = useRef<MicrophoneCapture | null>(null);
  const finishingCaptureRef = useRef<MicrophoneCapture | null>(null);
  const turnAbortRef = useRef<AbortController | null>(null);
  const pillStatusTimerRef = useRef<number | null>(null);

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

  const setTerminalPillStatus = useCallback((status: 'success' | 'error') => {
    if (pillStatusTimerRef.current !== null) {
      window.clearTimeout(pillStatusTimerRef.current);
    }
    setTranscriptionPillStatus(status);
    pillStatusTimerRef.current = window.setTimeout(() => {
      pillStatusTimerRef.current = null;
      setTranscriptionPillStatus('idle');
    }, 1800);
  }, []);

  const prepareForTurn = useCallback(async () => {
    const generation = ++turnGenerationRef.current;
    holdReleasePendingRef.current = false;

    captureStartupAbortRef.current?.abort();
    turnAbortRef.current?.abort();
    turnAbortRef.current = null;
    insertionSessionRef.current = null;
    if (pillStatusTimerRef.current !== null) {
      window.clearTimeout(pillStatusTimerRef.current);
      pillStatusTimerRef.current = null;
    }
    setTranscriptionPillStatus('idle');
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
        activePipelineModeRef.current = null;
        await capture.dispose();
      }
    } else if (!agentModeEnabledRef.current) {
      activeInputModeRef.current = null;
      activePipelineModeRef.current = null;
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

  const receiveAgentResponse = useCallback(
    async (turnId: string, generation: number, signal: AbortSignal) => {
      if (generation !== turnGenerationRef.current) return;

      setPhase('responding');
      const turn = await waitForTurn(turnId, signal);
      if (generation !== turnGenerationRef.current) return;
      startResponseOutput(turn.response!, generation);
    },
    [setPhase, startResponseOutput]
  );

  const transcribeRecording = useCallback(
    async (audio: Blob, generation: number, pipelineMode: PipelineMode) => {
      if (generation !== turnGenerationRef.current) return;

      setPhase('transcribing');
      const abortController = new AbortController();
      turnAbortRef.current = abortController;

      try {
        const turn = await createVoiceTurn(audio, pipelineMode, abortController.signal);
        if (generation !== turnGenerationRef.current) return;
        if (!turn.transcript) throw new Error('No speech was detected.');

        if (pipelineMode === 'agent') {
          appendTurn('user', turn.transcript);
          await receiveAgentResponse(turn.id, generation, abortController.signal);
        } else {
          setPhase('responding');
          const completedTurn = await waitForTurn(turn.id, abortController.signal);
          if (generation !== turnGenerationRef.current) return;
          const sessionId = insertionSessionRef.current;
          insertionSessionRef.current = null;
          const bridge = window.resonanceDesktop;
          if (!bridge || !sessionId) {
            throw new Error('The transcription target is unavailable.');
          }
          const insertion = await bridge.insertTextAtCaret(
            sessionId,
            completedTurn.response!
          );
          if (insertion.status !== 'inserted') {
            throw new Error(insertion.reason || 'Text could not be inserted at the caret.');
          }
          setTerminalPillStatus('success');
          settleTurn(generation);
        }
      } catch (error) {
        if (generation !== turnGenerationRef.current) return;

        console.error('Voice turn failed.', error);
        if (pipelineMode === 'transcription') {
          setTerminalPillStatus('error');
        } else {
          appendTurn('agent', getErrorMessage(error, 'Voice turn failed.'));
        }
        settleTurn(generation);
      } finally {
        if (turnAbortRef.current === abortController) {
          turnAbortRef.current = null;
        }
      }
    },
    [
      appendTurn,
      receiveAgentResponse,
      setPhase,
      setTerminalPillStatus,
      settleTurn
    ]
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
      const pipelineMode = activePipelineModeRef.current;
      setPhase('transcribing');
      if (pipelineMode === 'transcription') setTranscriptionPillStatus('processing');

      try {
        const audio = await capture.finish();
        if (generation !== turnGenerationRef.current) return;

        if (mode !== 'agent') {
          if (captureRef.current === capture) captureRef.current = null;
          activeInputModeRef.current = null;
          activePipelineModeRef.current = null;
          await capture.dispose();
        }

        if (generation !== turnGenerationRef.current) return;
        if (!audio) {
          if (pipelineMode === 'transcription') {
            setTranscriptionPillStatus('idle');
          }
          settleTurn(generation);
          return;
        }

        if (!pipelineMode) throw new Error('Voice pipeline mode is unavailable.');
        await transcribeRecording(audio, generation, pipelineMode);
      } catch (error) {
        if (generation !== turnGenerationRef.current) return;
        if (captureRef.current === capture) captureRef.current = null;
        activeInputModeRef.current = null;
        activePipelineModeRef.current = null;
        setAgentMode(false);
        await capture.dispose();
        console.error('Recording failed.', error);
        if (pipelineMode === 'transcription') {
          setTerminalPillStatus('error');
        } else {
          appendTurn('agent', getErrorMessage(error, 'Recording failed.'));
        }
        setPhase('idle');
      } finally {
        if (finishingCaptureRef.current === capture) {
          finishingCaptureRef.current = null;
        }
      }
    },
    [
      appendTurn,
      setAgentMode,
      setPhase,
      setTerminalPillStatus,
      settleTurn,
      transcribeRecording
    ]
  );

  const startCapture = useCallback(
    async (
      mode: VoiceInputMode,
      pipelineMode: PipelineMode,
      alreadyPrepared = false
    ) => {
      if (captureStartupRef.current) return captureStartupRef.current;

      let abortController: AbortController | null = null;
      const startup = (async () => {
        if (!alreadyPrepared) await prepareForTurn();
        const generation = turnGenerationRef.current;
        abortController = new AbortController();
        captureStartupAbortRef.current = abortController;
        activeInputModeRef.current = mode;
        activePipelineModeRef.current = pipelineMode;
        if (pipelineMode === 'transcription') {
          const bridge = window.resonanceDesktop;
          if (!bridge) {
            setTerminalPillStatus('error');
            activeInputModeRef.current = null;
            activePipelineModeRef.current = null;
            return;
          }
          try {
            insertionSessionRef.current = await bridge.beginTextInsertion();
          } catch (error) {
            console.error('The transcription target could not be captured.', error);
            setTerminalPillStatus('error');
            activeInputModeRef.current = null;
            activePipelineModeRef.current = null;
            return;
          }
        }
        setAgentMode(mode === 'agent');
        if (pipelineMode === 'transcription') {
          setTranscriptionPillStatus('recording');
        }
        setPhase('acquiring-microphone');

        let capture: MicrophoneCapture;
        try {
          capture = await MicrophoneCapture.open(abortController.signal);
        } catch (error) {
          if (generation !== turnGenerationRef.current) return;

          console.warn('Microphone unavailable.', error);
          activeInputModeRef.current = null;
          activePipelineModeRef.current = null;
          setAgentMode(false);
          if (pipelineMode === 'transcription') {
            setTerminalPillStatus('error');
          } else {
            appendTurn('agent', 'Microphone access is unavailable.');
          }
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
          activePipelineModeRef.current = null;
          await capture.dispose();
          if (generation !== turnGenerationRef.current) return;

          console.error('Recording failed.', error);
          setAgentMode(false);
          if (pipelineMode === 'transcription') {
            setTerminalPillStatus('error');
          } else {
            appendTurn('agent', getErrorMessage(error, 'Recording failed.'));
          }
          setPhase('idle');
          return;
        }

        if (
          generation !== turnGenerationRef.current ||
          captureRef.current !== capture
        ) {
          if (captureRef.current === capture) captureRef.current = null;
          activeInputModeRef.current = null;
          activePipelineModeRef.current = null;
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
      setPhase,
      setTerminalPillStatus
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

    await startCapture('tap', 'agent');
  }, [finishCaptureAndTranscribe, prepareForTurn, setAgentMode, startCapture]);

  const beginHoldToTalk = useCallback(async () => {
    if (agentModeEnabledRef.current || phaseRef.current !== 'idle') return;
    holdReleasePendingRef.current = false;
    await startCapture('hold', 'agent');
  }, [startCapture]);

  const endHoldToTalk = useCallback(async () => {
    if (
      activeInputModeRef.current !== 'hold' &&
      !transcriptionHoldRequestedRef.current
    ) {
      return;
    }
    holdReleasePendingRef.current = true;

    const capture = captureRef.current;
    if (phaseRef.current === 'listening' && capture) {
      await finishCaptureAndTranscribe(capture, turnGenerationRef.current);
    }
  }, [finishCaptureAndTranscribe]);

  const enableAgentMode = useCallback(async () => {
    if (agentModeEnabledRef.current) return;
    await startCapture('agent', 'agent');
  }, [startCapture]);

  const disableAgentMode = useCallback(async () => {
    if (!agentModeEnabledRef.current && activeInputModeRef.current !== 'agent') return;
    setAgentMode(false);
    await prepareForTurn();
  }, [prepareForTurn, setAgentMode]);

  const toggleTranscription = useCallback(async () => {
    if (
      phaseRef.current === 'listening' &&
      activeInputModeRef.current === 'tap' &&
      activePipelineModeRef.current === 'transcription' &&
      captureRef.current
    ) {
      await finishCaptureAndTranscribe(
        captureRef.current,
        turnGenerationRef.current
      );
      return;
    }
    if (agentModeEnabledRef.current) {
      setAgentMode(false);
    }
    let alreadyPrepared = false;
    if (captureStartupRef.current !== null) {
      const pendingStartup = captureStartupRef.current;
      await prepareForTurn();
      await pendingStartup.catch(() => undefined);
      alreadyPrepared = true;
    }
    await startCapture('tap', 'transcription', alreadyPrepared);
  }, [
    finishCaptureAndTranscribe,
    prepareForTurn,
    setAgentMode,
    startCapture
  ]);

  const beginTranscription = useCallback(async () => {
    if (activePipelineModeRef.current === 'transcription') {
      return;
    }
    transcriptionHoldRequestedRef.current = true;
    holdReleasePendingRef.current = false;
    try {
      if (agentModeEnabledRef.current) {
        setAgentMode(false);
      }
      let alreadyPrepared = false;
      if (captureStartupRef.current !== null) {
        const pendingStartup = captureStartupRef.current;
        await prepareForTurn();
        await pendingStartup.catch(() => undefined);
        alreadyPrepared = true;
      }
      await startCapture('hold', 'transcription', alreadyPrepared);
    } finally {
      transcriptionHoldRequestedRef.current = false;
    }
  }, [prepareForTurn, setAgentMode, startCapture]);

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
          const turn = await createTextTurn(text, 'agent', abortController.signal);
          await receiveAgentResponse(turn.id, generation, abortController.signal);
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
      receiveAgentResponse,
      setPhase,
      settleTurn
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

  useEffect(
    () => () => {
      turnGenerationRef.current += 1;
      captureStartupAbortRef.current?.abort();
      turnAbortRef.current?.abort();
      turnAbortRef.current = null;
      insertionSessionRef.current = null;
      if (pillStatusTimerRef.current !== null) {
        window.clearTimeout(pillStatusTimerRef.current);
      }
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
    transcriptionPillStatus,
    toggleListening,
    beginHoldToTalk,
    endHoldToTalk,
    enableAgentMode,
    disableAgentMode,
    toggleTranscription,
    beginTranscription,
    submitTextTurn,
    toggleSpeechOutput,
    selectTheme,
    stopAgentSpeech: cancelCurrentTurn,
    setVisualTheme
  };
}
