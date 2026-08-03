export type TurnStatus = 'responding' | 'completed' | 'failed';

export interface Turn {
  id: string;
  status: TurnStatus;
  transcript: string;
  response_provider: string;
  mode: string;
  response?: string;
  error?: string;
}

export interface ResponseProviderOption {
  id: string;
  label: string;
  available: boolean;
}

export interface ProviderSettings {
  current: string;
  providers: ResponseProviderOption[];
}

export interface ASRProviderOption {
  id: string;
  label: string;
}

export interface ASRProviderSettings {
  current: string;
  providers: ASRProviderOption[];
}

export type PipelineMode = 'agent' | 'transcription';

const TURN_POLL_INTERVAL_MS = 100;

async function requestJson<T>(pathname: string, options?: RequestInit): Promise<T> {
  const response = await fetch(pathname, options);
  const result = (await response.json().catch(() => null)) as
    | T
    | { error?: string }
    | null;

  if (!response.ok) {
    throw new Error(
      result && typeof result === 'object' && 'error' in result && result.error
        ? result.error
        : 'Resonance backend request failed.'
    );
  }
  if (!result || typeof result !== 'object') {
    throw new Error('Resonance backend returned an invalid response.');
  }
  return result as T;
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, milliseconds);
    const handleAbort = () => {
      window.clearTimeout(timeoutId);
      reject(signal?.reason ?? new DOMException('Request aborted.', 'AbortError'));
    };

    if (signal?.aborted) {
      handleAbort();
      return;
    }
    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

export function createVoiceTurn(
  audio: Blob,
  mode: PipelineMode,
  signal?: AbortSignal
): Promise<Turn> {
  return requestJson<Turn>(`/api/voice/turns?mode=${encodeURIComponent(mode)}`, {
    method: 'POST',
    headers: {
      'Content-Type': audio.type || 'application/octet-stream'
    },
    body: audio,
    signal
  });
}

export function createTextTurn(
  text: string,
  mode: PipelineMode,
  signal?: AbortSignal
): Promise<Turn> {
  return requestJson<Turn>('/api/text/turns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, mode }),
    signal
  });
}

export async function waitForTurn(turnId: string, signal?: AbortSignal): Promise<Turn> {
  while (true) {
    const turn = await requestJson<Turn>(`/api/turns/${encodeURIComponent(turnId)}`, {
      signal
    });

    if (turn.status === 'completed') {
      if (!turn.response) throw new Error('Response provider returned empty text.');
      return turn;
    }
    if (turn.status === 'failed') {
      throw new Error(turn.error || 'Response processing failed.');
    }
    await delay(TURN_POLL_INTERVAL_MS, signal);
  }
}

export function getAgentProviderSettings(
  signal?: AbortSignal
): Promise<ProviderSettings> {
  return requestJson<ProviderSettings>('/api/agent/providers', { signal });
}

export async function selectAgentProvider(provider: string): Promise<string> {
  const result = await requestJson<{ provider: string }>(
    '/api/agent/providers/current',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider })
    }
  );
  return result.provider;
}

export function getTranscriptionProviderSettings(
  signal?: AbortSignal
): Promise<ProviderSettings> {
  return requestJson<ProviderSettings>('/api/transcription/providers', { signal });
}

export async function selectTranscriptionProvider(provider: string): Promise<string> {
  const result = await requestJson<{ provider: string }>(
    '/api/transcription/providers/current',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider })
    }
  );
  return result.provider;
}

export function getASRProviderSettings(signal?: AbortSignal): Promise<ASRProviderSettings> {
  return requestJson<ASRProviderSettings>('/api/asr/providers', { signal });
}

export async function selectASRProvider(provider: string): Promise<string> {
  const result = await requestJson<{ provider: string }>('/api/asr/providers/current', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider })
  });
  return result.provider;
}
