import { createWhisperProvider } from './asr-provider.mjs';

const ASR_ROUTE = '/api/asr/transcriptions';
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const DEFAULT_ASR_TIMEOUT_MS = 120_000;

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

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
    throw createHttpError('Audio recording is too large.', 413);
  }

  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_AUDIO_BYTES) {
      throw createHttpError('Audio recording is too large.', 413);
    }
    chunks.push(chunk);
  }

  if (totalBytes === 0) {
    throw createHttpError('Audio recording is empty.', 400);
  }

  return Buffer.concat(chunks, totalBytes);
}

export function createAsrMiddleware({
  provider = createWhisperProvider(),
  logger = console,
  timeoutMs = Number(process.env.ASR_TIMEOUT_MS) || DEFAULT_ASR_TIMEOUT_MS
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

    const abortController = new AbortController();
    const abortForDisconnect = () => {
      if (!response.writableFinished) {
        abortController.abort(createHttpError('Client disconnected.', 499));
      }
    };
    const abortForTimeout = () => {
      abortController.abort(createHttpError('Transcription timed out.', 504));
    };
    const timeoutId = setTimeout(abortForTimeout, timeoutMs);
    request.once('aborted', abortForDisconnect);
    response.once('close', abortForDisconnect);

    try {
      const audio = await readBody(request);
      if (abortController.signal.aborted) {
        throw abortController.signal.reason;
      }

      const result = await provider.transcribe({
        audio,
        contentType,
        filename: getFilename(contentType),
        signal: abortController.signal
      });

      if (!response.destroyed && !response.writableEnded) {
        sendJson(response, 200, result);
      }
    } catch (error) {
      if (response.destroyed || response.writableEnded) {
        return;
      }

      const errorStatus = typeof error?.statusCode === 'number' ? error.statusCode : null;
      const statusCode =
        (errorStatus !== null && errorStatus >= 400 && errorStatus < 500) || errorStatus === 504
          ? errorStatus
          : 502;
      logger.error('[asr]', error);
      sendJson(response, statusCode, {
        error:
          statusCode === 502
            ? 'Transcription service unavailable.'
            : statusCode === 504
              ? 'Transcription timed out.'
              : error.message
      });
    } finally {
      clearTimeout(timeoutId);
      request.off('aborted', abortForDisconnect);
      response.off('close', abortForDisconnect);
    }
  };
}
