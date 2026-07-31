import { useCallback, useEffect, useRef, useState } from 'react';
import type { PillStatus } from '../components/transcription-pill/pillPresentation';
import { useAudioVisualization } from '../hooks/useAudioVisualization';
import { waitForTurn } from '../services/backend';
import { MicrophoneCapture } from '../services/microphoneCapture';
import { VoicePipeline } from '../services/voicePipeline';
import { voicePhaseToAgentState } from '../services/voiceState';
import type { VoiceInputMode, VoicePhase } from '../types/voice';

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

type InsertionTargetResult =
  | { sessionId: string; error?: never }
  | { sessionId?: never; error: unknown };
type InsertionTargetPromise = Promise<InsertionTargetResult>;

export function useTranscriptionPillRuntime() {
  const [phase, setPhaseValue] = useState<VoicePhase>('idle');
  const [status, setStatus] = useState<PillStatus>('idle');

  const pipelineRef = useRef<VoicePipeline | null>(null);
  if (!pipelineRef.current) pipelineRef.current = new VoicePipeline();
  const pipeline = pipelineRef.current;

  const phaseRef = useRef<VoicePhase>('idle');
  const activeInputModeRef = useRef<VoiceInputMode | null>(null);
  const generationRef = useRef(0);
  const startupRef = useRef<Promise<void> | null>(null);
  const finishingRef = useRef<MicrophoneCapture | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);
  const insertionTargetRef = useRef<InsertionTargetPromise | null>(null);
  const holdReleasePendingRef = useRef(false);
  const holdRequestedRef = useRef(false);
  const errorTimerRef = useRef<number | null>(null);

  const setPhase = useCallback((nextPhase: VoicePhase) => {
    phaseRef.current = nextPhase;
    setPhaseValue(nextPhase);
  }, []);

  const state = voicePhaseToAgentState(phase);
  const { currentSpeechVolume, audioFrequencies } = useAudioVisualization(
    state,
    pipeline.analyser
  );

  const showError = useCallback((error: unknown) => {
    console.error(
      'Transcription pill pipeline failed.',
      errorMessage(error, 'Transcription failed.')
    );
    if (errorTimerRef.current !== null) window.clearTimeout(errorTimerRef.current);
    setStatus('error');
    errorTimerRef.current = window.setTimeout(() => {
      errorTimerRef.current = null;
      setStatus('idle');
    }, 1800);
  }, []);

  const prepare = useCallback(async () => {
    const generation = ++generationRef.current;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    insertionTargetRef.current = null;
    holdReleasePendingRef.current = false;
    finishingRef.current = null;
    activeInputModeRef.current = null;
    if (errorTimerRef.current !== null) {
      window.clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
    setStatus('idle');
    await pipeline.discardAndPause();
    setPhase('idle');
    return generation;
  }, [pipeline, setPhase]);

  const finishAndTranscribe = useCallback(
    async (
      capture: MicrophoneCapture,
      generation: number,
      insertionTarget: InsertionTargetPromise | null
    ) => {
      if (
        generation !== generationRef.current ||
        !pipeline.owns(capture) ||
        finishingRef.current === capture
      ) {
        return;
      }

      finishingRef.current = capture;
      setPhase('transcribing');
      setStatus('processing');
      let abortController: AbortController | null = null;

      try {
        const audio = await pipeline.finish(capture);
        if (generation !== generationRef.current) return;
        activeInputModeRef.current = null;
        if (!audio) {
          setStatus('idle');
          setPhase('idle');
          return;
        }

        abortController = new AbortController();
        requestAbortRef.current = abortController;
        const turn = await pipeline.createTurn(
          audio,
          'transcription',
          abortController.signal
        );
        if (generation !== generationRef.current) return;
        if (!turn.transcript) throw new Error('No speech was detected.');

        setPhase('responding');
        const completedTurn = await waitForTurn(turn.id, abortController.signal);
        if (generation !== generationRef.current) return;

        const target = await insertionTarget;
        if (generation !== generationRef.current) return;
        const bridge = window.resonanceDesktop;
        if (!bridge || !target || 'error' in target) {
          if (target && 'error' in target) throw target.error;
          throw new Error('The transcription target is unavailable.');
        }
        const insertion = await bridge.insertTextAtCaret(
          target.sessionId,
          completedTurn.response!
        );
        if (insertion.status !== 'inserted') {
          throw new Error(insertion.reason || 'Text could not be inserted at the caret.');
        }

        setStatus('idle');
        setPhase('idle');
      } catch (error) {
        if (generation !== generationRef.current) return;
        showError(error);
        setPhase('idle');
      } finally {
        if (requestAbortRef.current === abortController) {
          requestAbortRef.current = null;
        }
        if (insertionTargetRef.current === insertionTarget) {
          insertionTargetRef.current = null;
        }
        if (finishingRef.current === capture) finishingRef.current = null;
      }
    },
    [pipeline, setPhase, showError]
  );

  const start = useCallback(
    async (mode: Extract<VoiceInputMode, 'tap' | 'hold'>, alreadyPrepared = false) => {
      if (startupRef.current) return startupRef.current;

      const startup = (async () => {
        const generation = alreadyPrepared ? generationRef.current : await prepare();
        activeInputModeRef.current = mode;
        const bridge = window.resonanceDesktop;
        if (!bridge) {
          showError(new Error('Desktop integration is unavailable.'));
          return;
        }

        const insertionTarget = bridge.beginTextInsertion().then(
          result =>
            result.status === 'ready'
              ? { sessionId: result.sessionId }
              : { error: new Error(result.reason) },
          error => ({ error })
        );
        insertionTargetRef.current = insertionTarget;
        setStatus('recording');
        setPhase('acquiring-microphone');

        let captureReady = false;
        let finishPending = false;
        let capture: MicrophoneCapture;
        try {
          capture = await pipeline.start({
            mode,
            onUtterance: () => {
              if (captureReady) {
                void finishAndTranscribe(capture, generation, insertionTarget);
              }
              else finishPending = true;
            },
            onMaxDuration: () => {
              if (captureReady) {
                void finishAndTranscribe(capture, generation, insertionTarget);
              }
              else finishPending = true;
            }
          });
        } catch (error) {
          if (generation !== generationRef.current) return;
          activeInputModeRef.current = null;
          showError(error);
          setPhase('idle');
          return;
        }

        captureReady = true;

        if (generation !== generationRef.current || !pipeline.owns(capture)) {
          await pipeline.discardAndPause(capture);
          return;
        }

        setPhase('listening');
        if (finishPending || (mode === 'hold' && holdReleasePendingRef.current)) {
          void finishAndTranscribe(capture, generation, insertionTarget);
        }
      })();
      startupRef.current = startup;
      try {
        await startup;
      } finally {
        if (startupRef.current === startup) startupRef.current = null;
      }
    },
    [finishAndTranscribe, pipeline, prepare, setPhase, showError]
  );

  const toggleTranscription = useCallback(async () => {
    const capture = pipeline.activeCapture;
    if (
      phaseRef.current === 'listening' &&
      activeInputModeRef.current === 'tap' &&
      capture
    ) {
      await finishAndTranscribe(
        capture,
        generationRef.current,
        insertionTargetRef.current
      );
      return;
    }
    if (startupRef.current) {
      const pending = startupRef.current;
      await prepare();
      await pending.catch(() => undefined);
      await start('tap', true);
      return;
    }
    await start('tap');
  }, [finishAndTranscribe, pipeline, prepare, start]);

  const beginTranscription = useCallback(async () => {
    if (activeInputModeRef.current) return;
    holdRequestedRef.current = true;
    holdReleasePendingRef.current = false;
    try {
      await start('hold');
    } finally {
      holdRequestedRef.current = false;
    }
  }, [start]);

  const endTranscription = useCallback(async () => {
    if (activeInputModeRef.current !== 'hold' && !holdRequestedRef.current) return;
    holdReleasePendingRef.current = true;
    const capture = pipeline.activeCapture;
    if (phaseRef.current === 'listening' && capture) {
      await finishAndTranscribe(
        capture,
        generationRef.current,
        insertionTargetRef.current
      );
    }
  }, [finishAndTranscribe, pipeline]);

  useEffect(() => {
    void pipeline.ensureCapture().catch(error => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.warn('Pill microphone warmup failed; the next action will retry.', error);
    });
  }, [pipeline]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      requestAbortRef.current?.abort();
      if (errorTimerRef.current !== null) window.clearTimeout(errorTimerRef.current);
      void pipeline.dispose();
    },
    [pipeline]
  );

  return {
    state,
    status,
    volume: currentSpeechVolume,
    frequencies: audioFrequencies,
    toggleTranscription,
    beginTranscription,
    endTranscription
  };
}
