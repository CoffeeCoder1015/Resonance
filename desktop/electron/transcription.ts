const BACKEND_ORIGIN = process.env.RESONANCE_BACKEND_ORIGIN || 'http://127.0.0.1:8000';
const TRANSCRIPTION_TIMEOUT_MS = 10 * 60_000;

export interface DownstreamResult {
  provider: string;
  status: 'completed' | 'failed';
  error?: string;
}

export interface TranscriptionResult {
  transcript: string;
  text: string;
  mode: 'transcription';
  downstream: DownstreamResult;
}

export async function processTranscription(
  audio: ArrayBuffer,
  contentType: string,
  jobId: string,
  signal: AbortSignal
): Promise<TranscriptionResult> {
  const abortController = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => abortController.abort(signal.reason);
  signal.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
    void cancelTranscription(jobId);
  }, TRANSCRIPTION_TIMEOUT_MS);
  const form = new FormData();
  form.append(
    'file',
    new Blob([audio], { type: contentType }),
    `recording.${contentType.split('/')[1]?.split(';')[0] || 'wav'}`
  );

  try {
    const response = await fetch(
      new URL('/v1/voice/process?mode=transcription', BACKEND_ORIGIN),
      {
        method: 'POST',
        body: form,
        headers: { 'X-Resonance-Job-Id': jobId },
        signal: abortController.signal
      }
    );
    const result = (await response.json().catch(() => null)) as
      | TranscriptionResult
      | { detail?: string }
      | null;
    if (!response.ok) {
      const detail = result && 'detail' in result ? result.detail : undefined;
      throw new Error(detail || `Backend returned ${response.status}.`);
    }
    if (
      !result ||
      !('transcript' in result) ||
      typeof result.transcript !== 'string' ||
      typeof result.text !== 'string' ||
      !result.downstream ||
      typeof result.downstream.provider !== 'string' ||
      !['completed', 'failed'].includes(result.downstream.status)
    ) {
      throw new Error('Backend returned an invalid transcription result.');
    }
    return result;
  } catch (error) {
    if (timedOut) {
      throw new Error('Transcription processing timed out.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abortFromCaller);
  }
}

export async function cancelTranscription(jobId: string): Promise<void> {
  try {
    await fetch(
      new URL(`/v1/transcriptions/${encodeURIComponent(jobId)}/cancel`, BACKEND_ORIGIN),
      { method: 'POST' }
    );
  } catch {
    // Cancellation remains best-effort if the backend has already stopped.
  }
}
