import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cancelTranscription,
  processTranscription
} from './transcription.js';

test('sends a job ID with the transcription request', async () => {
  const previousFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestedOptions: RequestInit | undefined;
  globalThis.fetch = (async (input, options) => {
    requestedUrl = String(input);
    requestedOptions = options;
    return new Response(
      JSON.stringify({
        transcript: 'Raw text',
        text: 'Final text',
        mode: 'transcription',
        downstream: { provider: 'lfm-transcription', status: 'completed' }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    const controller = new AbortController();
    const audio = new Uint8Array([1, 2, 3, 4]);
    const result = await processTranscription(
      audio.buffer,
      'audio/wav',
      'job-123',
      controller.signal
    );

    assert.equal(result.text, 'Final text');
    const upload = (requestedOptions?.body as FormData).get('file') as File;
    assert.equal(upload.type, 'audio/wav');
    assert.deepEqual(new Uint8Array(await upload.arrayBuffer()), audio);
    assert.equal(
      requestedUrl,
      'http://127.0.0.1:8000/v1/voice/process?mode=transcription'
    );
    assert.equal(
      new Headers(requestedOptions?.headers).get('X-Resonance-Job-Id'),
      'job-123'
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('propagates backend failures without returning insertable text', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ detail: 'Transcription was cancelled.' }),
    { status: 409 }
  )) as typeof fetch;
  try {
    await assert.rejects(
      processTranscription(new ArrayBuffer(4), 'audio/wav', 'cancelled-job', new AbortController().signal),
      /Transcription was cancelled/
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('caller cancellation aborts an in-flight upload', async () => {
  const previousFetch = globalThis.fetch;
  const controller = new AbortController();
  const reason = new Error('User cancelled dictation');
  globalThis.fetch = ((_input, options) => new Promise((_resolve, reject) => {
    options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true });
    controller.abort(reason);
  })) as typeof fetch;
  try {
    await assert.rejects(
      processTranscription(new ArrayBuffer(4), 'audio/wav', 'active-job', controller.signal),
      error => error === reason
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('sends cancellation to the job-specific backend endpoint', async () => {
  const previousFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestedMethod = '';
  globalThis.fetch = (async (input, options) => {
    requestedUrl = String(input);
    requestedMethod = options?.method || '';
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  try {
    await cancelTranscription('job/with spaces');
    assert.equal(
      requestedUrl,
      'http://127.0.0.1:8000/v1/transcriptions/job%2Fwith%20spaces/cancel'
    );
    assert.equal(requestedMethod, 'POST');
  } finally {
    globalThis.fetch = previousFetch;
  }
});
