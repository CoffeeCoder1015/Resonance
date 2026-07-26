import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { afterEach, test } from 'node:test';
import { createAsrMiddleware } from './asr-middleware.mjs';

const servers = new Set();

afterEach(async () => {
  await Promise.all(
    [...servers].map(server => new Promise(resolve => server.close(resolve)))
  );
  servers.clear();
});

async function startServer(options) {
  const middleware = createAsrMiddleware({
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

test('aborts provider work when the client disconnects', async () => {
  let providerStarted;
  const started = new Promise(resolve => {
    providerStarted = resolve;
  });
  let providerAborted;
  const aborted = new Promise(resolve => {
    providerAborted = resolve;
  });
  const provider = {
    transcribe({ signal }) {
      providerStarted();
      return new Promise((resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            providerAborted(signal.reason);
            reject(signal.reason);
          },
          { once: true }
        );
      });
    }
  };
  const origin = await startServer({ provider, timeoutMs: 5_000 });
  const controller = new AbortController();
  const request = fetch(`${origin}/api/asr/transcriptions`, {
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

test('times out provider work and returns a gateway timeout', async () => {
  let providerSignal;
  const provider = {
    transcribe({ signal }) {
      providerSignal = signal;
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
  };
  const origin = await startServer({ provider, timeoutMs: 20 });

  const response = await fetch(`${origin}/api/asr/transcriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: new Uint8Array([1, 2, 3])
  });

  assert.equal(response.status, 504);
  assert.equal(providerSignal.aborted, true);
  assert.deepEqual(await response.json(), { error: 'Transcription timed out.' });
});
