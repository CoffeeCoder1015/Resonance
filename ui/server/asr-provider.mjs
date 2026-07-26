const DEFAULT_WHISPER_ENDPOINT = 'http://127.0.0.1:8000/v1/audio/transcriptions';
const DEFAULT_WHISPER_MODEL = 'openai/whisper-base.en';

function normalizeContentType(contentType) {
  return contentType?.split(';', 1)[0]?.trim() || 'application/octet-stream';
}

export function createWhisperProvider({
  endpoint = process.env.WHISPER_ENDPOINT || DEFAULT_WHISPER_ENDPOINT,
  model = process.env.WHISPER_MODEL || DEFAULT_WHISPER_MODEL,
  fetchImpl = fetch
} = {}) {
  return {
    async transcribe({ audio, contentType, filename, signal }) {
      const form = new FormData();
      form.append('file', new Blob([audio], { type: normalizeContentType(contentType) }), filename);
      form.append('model', model);

      const response = await fetchImpl(endpoint, {
        method: 'POST',
        body: form,
        signal
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Whisper returned ${response.status}: ${detail.slice(0, 300)}`);
      }

      const result = await response.json();
      if (!result || typeof result.text !== 'string') {
        throw new Error('Whisper returned an invalid transcription response.');
      }

      return { text: result.text.trim() };
    }
  };
}
