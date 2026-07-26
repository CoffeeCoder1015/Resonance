interface TranscriptionResponse {
  text: string;
}

export async function transcribeAudio(audio: Blob, signal?: AbortSignal): Promise<string> {
  const response = await fetch('/api/asr/transcriptions', {
    method: 'POST',
    headers: {
      'Content-Type': audio.type || 'application/octet-stream'
    },
    body: audio,
    signal
  });

  const result = (await response.json().catch(() => null)) as
    | TranscriptionResponse
    | { error?: string }
    | null;

  if (!response.ok) {
    throw new Error(result && 'error' in result && result.error ? result.error : 'Transcription failed.');
  }

  if (!result || !('text' in result) || typeof result.text !== 'string') {
    throw new Error('Transcription returned an invalid response.');
  }

  return result.text.trim();
}
