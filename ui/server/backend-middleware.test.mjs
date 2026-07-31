import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { afterEach, test } from 'node:test';
import { createBackendMiddleware } from './backend-middleware.mjs';

const servers = new Set();

afterEach(async () => {
  await Promise.all([...servers].map(server => new Promise(resolve => server.close(resolve))));
  servers.clear();
});

async function startServer(options) {
  const middleware = createBackendMiddleware({
    logger: { error() {} },
    ...options
  });
  const server = createServer((request, response) => {
    void middleware(request, response, () => {
      response.statusCode = 404;
      response.end();
    });
  });
  servers.add(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

test('aborts backend work when the client disconnects', async () => {
  let backendStarted;
  const started = new Promise(resolve => {
    backendStarted = resolve;
  });
  let backendAborted;
  const aborted = new Promise(resolve => {
    backendAborted = resolve;
  });
  const client = {
    createVoiceTurn({ signal }) {
      backendStarted();
      return new Promise((resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            backendAborted(signal.reason);
            reject(signal.reason);
          },
          { once: true }
        );
      });
    }
  };
  const origin = await startServer({ client, timeoutMs: 5_000 });
  const controller = new AbortController();
  const request = fetch(`${origin}/api/voice/turns`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: new Uint8Array([1, 2, 3]),
    signal: controller.signal
  }).catch(() => undefined);

  await started;
  controller.abort();
  await request;

  const reason = await aborted;
  assert.equal(reason.statusCode, 499);
});

test('times out backend work and returns a gateway timeout', async () => {
  let backendSignal;
  const client = {
    createVoiceTurn({ signal }) {
      backendSignal = signal;
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
  };
  const origin = await startServer({ client, timeoutMs: 20 });

  const response = await fetch(`${origin}/api/voice/turns`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: new Uint8Array([1, 2, 3])
  });

  assert.equal(response.status, 504);
  assert.equal(backendSignal.aborted, true);
  assert.deepEqual(await response.json(), { error: 'Backend request timed out.' });
});

test('routes response provider reads and changes', async () => {
  const calls = [];
  const client = {
    getResponseProviders() {
      return {
        current: 'opencode',
        providers: [{ id: 'opencode', label: 'OpenCode', available: true }]
      };
    },
    setResponseProvider({ responseProvider }) {
      calls.push(responseProvider);
      return { response_provider: responseProvider };
    }
  };
  const origin = await startServer({ client });

  const listResponse = await fetch(`${origin}/api/response/providers`);
  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json()).current, 'opencode');

  const changeResponse = await fetch(`${origin}/api/response/providers/current`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response_provider: 'antigravity' })
  });
  assert.equal(changeResponse.status, 200);
  assert.deepEqual(await changeResponse.json(), { response_provider: 'antigravity' });
  assert.deepEqual(calls, ['antigravity']);
});

test('routes keyboard text turns', async () => {
  const calls = [];
  const client = {
    createTextTurn({ text }) {
      calls.push(text);
      return {
        id: 'turn_text',
        status: 'responding',
        transcript: text,
        response_provider: 'opencode',
        mode: 'voice'
      };
    }
  };
  const origin = await startServer({ client });

  const response = await fetch(`${origin}/api/text/turns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Hello' })
  });

  assert.equal(response.status, 202);
  assert.equal(response.headers.get('location'), '/api/turns/turn_text');
  assert.deepEqual(calls, ['Hello']);
});

test('routes ASR provider reads and changes', async () => {
  const calls = [];
  const client = {
    getASRProviders() {
      return {
        current: 'whisper',
        providers: [
          { id: 'whisper', label: 'Whisper' },
          { id: 'whisper', label: 'Whisper' }
        ]
      };
    },
    setASRProvider({ provider }) {
      calls.push(provider);
      return { provider };
    }
  };
  const origin = await startServer({ client });

  const listResponse = await fetch(`${origin}/api/asr/providers`);
  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json()).current, 'whisper');

  const changeResponse = await fetch(`${origin}/api/asr/providers/current`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'whisper' })
  });
  assert.equal(changeResponse.status, 200);
  assert.deepEqual(await changeResponse.json(), { provider: 'whisper' });
  assert.deepEqual(calls, ['whisper']);
});

test('routes mode reads and changes', async () => {
  const calls = [];
  const client = {
    getModes() {
      return {
        current: 'voice',
        modes: [
          { id: 'voice', label: 'Voice' },
          { id: 'transcription', label: 'Transcription' }
        ]
      };
    },
    setMode({ mode }) {
      calls.push(mode);
      return { mode };
    }
  };
  const origin = await startServer({ client });

  const listResponse = await fetch(`${origin}/api/modes`);
  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json()).current, 'voice');

  const changeResponse = await fetch(`${origin}/api/modes/current`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'transcription' })
  });
  assert.equal(changeResponse.status, 200);
  assert.deepEqual(await changeResponse.json(), { mode: 'transcription' });
  assert.deepEqual(calls, ['transcription']);
});

test('returns an addressable voice turn', async () => {
  const client = {
    createVoiceTurn() {
      return {
        id: 'turn_123',
        status: 'responding',
        transcript: 'Hello',
        response_provider: 'opencode'
      };
    }
  };
  const origin = await startServer({ client });

  const response = await fetch(`${origin}/api/voice/turns`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: new Uint8Array([1, 2, 3])
  });

  assert.equal(response.status, 202);
  assert.equal(response.headers.get('location'), '/api/turns/turn_123');
  assert.equal(response.headers.get('retry-after'), '1');
  assert.equal((await response.json()).transcript, 'Hello');
});
