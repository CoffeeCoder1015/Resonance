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

export interface ResponseProviderSettings {
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

export interface ModeOption {
  id: string;
  label: string;
}

export interface ModeSettings {
  current: string;
  modes: ModeOption[];
}

const TURN_POLL_INTERVAL_MS = 750;

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

export function createVoiceTurn(audio: Blob, signal?: AbortSignal): Promise<Turn> {
  return requestJson<Turn>('/api/voice/turns', {
    method: 'POST',
    headers: {
      'Content-Type': audio.type || 'application/octet-stream'
    },
    body: audio,
    signal
  });
}

export function createTextTurn(text: string, signal?: AbortSignal): Promise<Turn> {
  return requestJson<Turn>('/api/text/turns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
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

export function getResponseProviderSettings(
  signal?: AbortSignal
): Promise<ResponseProviderSettings> {
  return requestJson<ResponseProviderSettings>('/api/response/providers', { signal });
}

export async function selectResponseProvider(responseProvider: string): Promise<string> {
  const result = await requestJson<{ response_provider: string }>(
    '/api/response/providers/current',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response_provider: responseProvider })
    }
  );
  return result.response_provider;
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

export function getModeSettings(signal?: AbortSignal): Promise<ModeSettings> {
  return requestJson<ModeSettings>('/api/modes', { signal });
}

export async function selectMode(mode: string): Promise<string> {
  const result = await requestJson<{ mode: string }>('/api/modes/current', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode })
  });
  return result.mode;
}
