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
    const result = await processTranscription(
      new ArrayBuffer(4),
      'audio/wav',
      'job-123',
      new AbortController().signal
    );

    assert.equal(result.text, 'Final text');
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
