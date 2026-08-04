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
    processVoice({ signal }) {
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
  const request = fetch(`${origin}/api/voice/process?mode=agent`, {
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
    processVoice({ signal }) {
      backendSignal = signal;
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
  };
  const origin = await startServer({ client, timeoutMs: 20 });

  const response = await fetch(`${origin}/api/voice/process?mode=agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: new Uint8Array([1, 2, 3])
  });

  assert.equal(response.status, 504);
  assert.equal(backendSignal.aborted, true);
  assert.deepEqual(await response.json(), { error: 'Backend request timed out.' });
});

test('routes agent and transcription provider reads and changes separately', async () => {
  const calls = [];
  const client = {
    getAgentProviders() {
      return {
        current: 'opencode',
        providers: [{ id: 'opencode', label: 'OpenCode', available: true }]
      };
    },
    setAgentProvider({ provider }) {
      calls.push(['agent', provider]);
      return { provider };
    },
    getTranscriptionProviders() {
      return {
        current: 'lfm-transcription',
        providers: [
          {
            id: 'lfm-transcription',
            label: 'LFM 2.5 Transcription',
            available: true
          },
          { id: 'passthrough', label: 'Passthrough', available: true }
        ]
      };
    },
    setTranscriptionProvider({ provider }) {
      calls.push(['transcription', provider]);
      return { provider };
    }
  };
  const origin = await startServer({ client });

  const listResponse = await fetch(`${origin}/api/agent/providers`);
  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json()).current, 'opencode');

  const changeResponse = await fetch(`${origin}/api/agent/providers/current`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'antigravity' })
  });
  assert.equal(changeResponse.status, 200);
  assert.deepEqual(await changeResponse.json(), { provider: 'antigravity' });

  const transcriptionResponse = await fetch(`${origin}/api/transcription/providers`);
  assert.equal((await transcriptionResponse.json()).current, 'lfm-transcription');
  const changeTranscription = await fetch(
    `${origin}/api/transcription/providers/current`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'lfm-transcription' })
    }
  );
  assert.deepEqual(await changeTranscription.json(), { provider: 'lfm-transcription' });
  assert.deepEqual(calls, [
    ['agent', 'antigravity'],
    ['transcription', 'lfm-transcription']
  ]);
});

test('routes keyboard text processing as one response', async () => {
  const calls = [];
  const client = {
    processText({ text, mode }) {
      calls.push({ text, mode });
      return {
        transcript: text,
        text: 'Response',
        mode,
        downstream: { provider: 'opencode', status: 'completed' }
      };
    }
  };
  const origin = await startServer({ client });

  const response = await fetch(`${origin}/api/text/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Hello', mode: 'agent' })
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).text, 'Response');
  assert.deepEqual(calls, [{ text: 'Hello', mode: 'agent' }]);
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

test('returns a completed voice pipeline response', async () => {
  const calls = [];
  const client = {
    processVoice({ mode }) {
      calls.push(mode);
      return {
        transcript: 'Hello',
        text: 'Hello',
        mode,
        downstream: { provider: 'passthrough', status: 'completed' }
      };
    }
  };
  const origin = await startServer({ client });

  const response = await fetch(`${origin}/api/voice/process?mode=transcription`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: new Uint8Array([1, 2, 3])
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).transcript, 'Hello');
  assert.deepEqual(calls, ['transcription']);
});

test('routes an audio chunk transcription without creating a turn', async () => {
  const calls = [];
  const client = {
    createAudioTranscription({ audio, contentType, filename }) {
      calls.push([[...audio], contentType, filename]);
      return { transcript: 'Chunk transcript.' };
    }
  };
  const origin = await startServer({ client });

  const response = await fetch(`${origin}/api/audio/transcriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: new Uint8Array([1, 2, 3])
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { transcript: 'Chunk transcript.' });
  assert.deepEqual(calls, [[[1, 2, 3], 'audio/wav', 'recording.wav']]);
});

test('requires voice pipeline mode on every request', async () => {
  const client = {
    processVoice() {
      throw new Error('Backend client must not be called.');
    }
  };
  const origin = await startServer({ client });

  const response = await fetch(`${origin}/api/voice/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: new Uint8Array([1, 2, 3])
  });

  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    error: 'A valid pipeline mode is required.'
  });
});
