import { createBackendClient } from './backend-client.mjs';

const VOICE_TURNS_ROUTE = '/api/voice/turns';
const TEXT_TURNS_ROUTE = '/api/text/turns';
const RESPONSE_PROVIDERS_ROUTE = '/api/response/providers';
const CURRENT_RESPONSE_PROVIDER_ROUTE = '/api/response/providers/current';
const ASR_PROVIDERS_ROUTE = '/api/asr/providers';
const CURRENT_ASR_PROVIDER_ROUTE = '/api/asr/providers/current';
const TURN_ROUTE = /^\/api\/turns\/([^/]+)$/;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const DEFAULT_BACKEND_TIMEOUT_MS = 120_000;
const ASR_PROVIDER_SWITCH_TIMEOUT_MS = 10 * 60_000;

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

async function readBody(request, maximumBytes) {
  const declaredLength = Number(request.headers['content-length'] || 0);
  if (declaredLength > maximumBytes) {
    throw createHttpError('Request body is too large.', 413);
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > maximumBytes) {
      throw createHttpError('Request body is too large.', 413);
    }
    chunks.push(chunk);
  }

  if (totalBytes === 0) {
    throw createHttpError('Request body is empty.', 400);
  }
  return Buffer.concat(chunks, totalBytes);
}

async function readJson(request) {
  const body = await readBody(request, MAX_JSON_BYTES);
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw createHttpError('Request body must be valid JSON.', 400);
  }
}

function routeRequest(pathname, method) {
  if (pathname === VOICE_TURNS_ROUTE) {
    return method === 'POST' ? 'createVoiceTurn' : 'methodNotAllowed';
  }
  if (pathname === TEXT_TURNS_ROUTE) {
    return method === 'POST' ? 'createTextTurn' : 'methodNotAllowed';
  }
  if (pathname === RESPONSE_PROVIDERS_ROUTE) {
    return method === 'GET' ? 'getResponseProviders' : 'methodNotAllowed';
  }
  if (pathname === CURRENT_RESPONSE_PROVIDER_ROUTE) {
    return method === 'PUT' ? 'setResponseProvider' : 'methodNotAllowed';
  }
  if (pathname === ASR_PROVIDERS_ROUTE) {
    return method === 'GET' ? 'getASRProviders' : 'methodNotAllowed';
  }
  if (pathname === CURRENT_ASR_PROVIDER_ROUTE) {
    return method === 'PUT' ? 'setASRProvider' : 'methodNotAllowed';
  }
  const turnMatch = pathname.match(TURN_ROUTE);
  if (turnMatch) {
    return method === 'GET' ? { name: 'getTurn', turnId: turnMatch[1] } : 'methodNotAllowed';
  }
  return null;
}

export function createBackendMiddleware({
  client = createBackendClient(),
  logger = console,
  timeoutMs = Number(process.env.BACKEND_TIMEOUT_MS) || DEFAULT_BACKEND_TIMEOUT_MS
} = {}) {
  return async function backendMiddleware(request, response, next) {
    const requestUrl = new URL(request.url || '/', 'http://resonance.local');
    const pathname = requestUrl.pathname;
    const route = routeRequest(pathname, request.method || 'GET');
    if (route === null) {
      next();
      return;
    }
    if (route === 'methodNotAllowed') {
      sendJson(response, 405, { error: 'Method not allowed.' });
      return;
    }

    const abortController = new AbortController();
    const abortForDisconnect = () => {
      if (!response.writableFinished) {
        abortController.abort(createHttpError('Client disconnected.', 499));
      }
    };
    const requestTimeoutMs =
      route === 'setASRProvider'
        ? Math.max(timeoutMs, ASR_PROVIDER_SWITCH_TIMEOUT_MS)
        : timeoutMs;
    const timeoutId = setTimeout(() => {
      abortController.abort(createHttpError('Backend request timed out.', 504));
    }, requestTimeoutMs);
    request.once('aborted', abortForDisconnect);
    response.once('close', abortForDisconnect);

    try {
      let result;
      if (route === 'createVoiceTurn') {
        const mode = requestUrl.searchParams.get('mode');
        if (mode !== 'agent' && mode !== 'transcription') {
          throw createHttpError('A valid pipeline mode is required.', 422);
        }
        const contentType = String(request.headers['content-type'] || '');
        if (!contentType.toLowerCase().startsWith('audio/')) {
          throw createHttpError('An audio content type is required.', 415);
        }
        result = await client.createVoiceTurn({
          audio: await readBody(request, MAX_AUDIO_BYTES),
          contentType,
          filename: getFilename(contentType),
          mode,
          signal: abortController.signal
        });
      } else if (route === 'createTextTurn') {
        const body = await readJson(request);
        result = await client.createTextTurn({
          text: body.text,
          mode: body.mode,
          signal: abortController.signal
        });
      } else if (route === 'getResponseProviders') {
        result = await client.getResponseProviders({ signal: abortController.signal });
      } else if (route === 'setResponseProvider') {
        const body = await readJson(request);
        result = await client.setResponseProvider({
          responseProvider: body.response_provider,
          signal: abortController.signal
        });
      } else if (route === 'getASRProviders') {
        result = await client.getASRProviders({ signal: abortController.signal });
      } else if (route === 'setASRProvider') {
        const body = await readJson(request);
        result = await client.setASRProvider({
          provider: body.provider,
          signal: abortController.signal
        });
      } else {
        result = await client.getTurn({
          turnId: route.turnId,
          signal: abortController.signal
        });
      }

      if (!response.destroyed && !response.writableEnded) {
        if (route === 'createVoiceTurn' || route === 'createTextTurn') {
          response.setHeader('Location', `/api/turns/${result.id}`);
          response.setHeader('Retry-After', '1');
        }
        sendJson(
          response,
          route === 'createVoiceTurn' || route === 'createTextTurn' ? 202 : 200,
          result
        );
      }
    } catch (error) {
      if (response.destroyed || response.writableEnded) return;

      const errorStatus = typeof error?.statusCode === 'number' ? error.statusCode : null;
      const statusCode =
        errorStatus !== null && errorStatus >= 400 && errorStatus < 600 ? errorStatus : 502;
      logger.error('[backend]', error);
      sendJson(response, statusCode, {
        error: statusCode === 502 ? 'Resonance backend is unavailable.' : error.message
      });
    } finally {
      clearTimeout(timeoutId);
      request.off('aborted', abortForDisconnect);
      response.off('close', abortForDisconnect);
    }
  };
}
