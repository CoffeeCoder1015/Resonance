const DEFAULT_BACKEND_ORIGIN = 'http://127.0.0.1:8000';

function createBackendError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function readResponse(response) {
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      result && typeof result.detail === 'string'
        ? result.detail
        : `Backend returned ${response.status}.`;
    throw createBackendError(detail, response.status);
  }
  if (!result || typeof result !== 'object') {
    throw new Error('Backend returned an invalid response.');
  }
  return result;
}

export function createBackendClient({
  origin = process.env.RESONANCE_BACKEND_ORIGIN || DEFAULT_BACKEND_ORIGIN,
  fetchImpl = fetch
} = {}) {
  const request = async (pathname, options = {}) => {
    const response = await fetchImpl(new URL(pathname, origin), options);
    return readResponse(response);
  };

  return {
    async createVoiceTurn({ audio, contentType, filename, mode, signal }) {
      const form = new FormData();
      form.append('file', new Blob([audio], { type: contentType }), filename);
      return request(`/v1/voice/turns?mode=${encodeURIComponent(mode)}`, {
        method: 'POST',
        body: form,
        signal
      });
    },

    createTextTurn({ text, mode, signal }) {
      return request('/v1/text/turns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, mode }),
        signal
      });
    },

    getTurn({ turnId, signal }) {
      return request(`/v1/turns/${encodeURIComponent(turnId)}`, { signal });
    },

    getResponseProviders({ signal }) {
      return request('/v1/response/providers', { signal });
    },

    setResponseProvider({ responseProvider, signal }) {
      return request('/v1/response/providers/current', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response_provider: responseProvider }),
        signal
      });
    },

    getASRProviders({ signal }) {
      return request('/v1/asr/providers', { signal });
    },

    setASRProvider({ provider, signal }) {
      return request('/v1/asr/providers/current', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
        signal
      });
    }
  };
}
