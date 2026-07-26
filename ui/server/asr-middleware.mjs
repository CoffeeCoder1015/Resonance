import { createWhisperProvider } from './asr-provider.mjs';

const ASR_ROUTE = '/api/asr/transcriptions';
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(body));
}

function getFilename(contentType) {
  const normalizedType = contentType.split(';', 1)[0].trim();
  const extension =
    normalizedType === 'audio/webm'
      ? 'webm'
      : normalizedType === 'audio/ogg'
        ? 'ogg'
        : normalizedType === 'audio/mp4'
          ? 'm4a'
          : normalizedType === 'audio/wav'
            ? 'wav'
            : 'audio';

  return `recording.${extension}`;
}

async function readBody(request) {
  const declaredLength = Number(request.headers['content-length'] || 0);
  if (declaredLength > MAX_AUDIO_BYTES) {
    const error = new Error('Audio recording is too large.');
    error.statusCode = 413;
    throw error;
  }

  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_AUDIO_BYTES) {
      const error = new Error('Audio recording is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (totalBytes === 0) {
    const error = new Error('Audio recording is empty.');
    error.statusCode = 400;
    throw error;
  }

  return Buffer.concat(chunks, totalBytes);
}

export function createAsrMiddleware({
  provider = createWhisperProvider(),
  logger = console
} = {}) {
  return async function asrMiddleware(request, response, next) {
    const pathname = new URL(request.url || '/', 'http://resonance.local').pathname;
    if (pathname !== ASR_ROUTE) {
      next();
      return;
    }

    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      sendJson(response, 405, { error: 'Method not allowed.' });
      return;
    }

    const contentType = String(request.headers['content-type'] || '');
    if (!contentType.toLowerCase().startsWith('audio/')) {
      sendJson(response, 415, { error: 'An audio content type is required.' });
      return;
    }

    try {
      const audio = await readBody(request);
      const abortController = new AbortController();
      request.once('aborted', () => abortController.abort());

      const result = await provider.transcribe({
        audio,
        contentType,
        filename: getFilename(contentType),
        signal: abortController.signal
      });

      sendJson(response, 200, result);
    } catch (error) {
      const statusCode =
        typeof error?.statusCode === 'number' && error.statusCode < 500 ? error.statusCode : 502;
      logger.error('[asr]', error);
      sendJson(response, statusCode, {
        error: statusCode === 502 ? 'Transcription service unavailable.' : error.message
      });
    }
  };
}
