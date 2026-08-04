export interface PipelineResult {
  transcript: string;
  text: string;
  mode: string;
  downstream: {
    provider: string;
    status: 'completed' | 'failed';
    error?: string;
  };
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

export function processVoice(
  audio: Blob,
  mode: PipelineMode,
  signal?: AbortSignal
): Promise<PipelineResult> {
  return requestJson<PipelineResult>(
    `/api/voice/process?mode=${encodeURIComponent(mode)}`,
    {
    method: 'POST',
    headers: {
      'Content-Type': audio.type || 'application/octet-stream'
    },
    body: audio,
    signal
    }
  );
}

export async function transcribeAudio(
  audio: Blob,
  signal?: AbortSignal
): Promise<string> {
  const result = await requestJson<{ transcript: string }>('/api/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Content-Type': audio.type || 'application/octet-stream'
    },
    body: audio,
    signal
  });
  return result.transcript;
}

export function processText(
  text: string,
  mode: PipelineMode,
  signal?: AbortSignal
): Promise<PipelineResult> {
  return requestJson<PipelineResult>('/api/text/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, mode }),
    signal
  });
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
