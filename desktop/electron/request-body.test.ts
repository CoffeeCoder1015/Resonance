import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RequestBodyTooLargeError,
  readRequestBodyWithinLimit,
} from './request-body.js';

function requestFromChunks(
  chunks: Uint8Array[],
  contentLength?: number,
): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const headers = new Headers();
  if (contentLength !== undefined) headers.set('content-length', String(contentLength));
  return new Request('https://resonance.local/audio', {
    method: 'POST',
    headers,
    body: stream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

test('rejects a declared audio body that exceeds the desktop protocol limit', async () => {
  const request = requestFromChunks([], 11);

  await assert.rejects(
    readRequestBodyWithinLimit(request, 10),
    RequestBodyTooLargeError,
  );
});

test('rejects an undeclared audio body while it is buffered', async () => {
  const request = requestFromChunks([
    new Uint8Array([1, 2, 3, 4, 5, 6]),
    new Uint8Array([7, 8, 9, 10, 11]),
  ]);

  await assert.rejects(
    readRequestBodyWithinLimit(request, 10),
    RequestBodyTooLargeError,
  );
});

test('preserves audio bytes at or below the desktop protocol limit', async () => {
  const request = requestFromChunks([
    new Uint8Array([1, 2]),
    new Uint8Array([3, 4]),
  ]);

  const body = await readRequestBodyWithinLimit(request, 4);
  assert.deepEqual([...new Uint8Array(await new Blob(body).arrayBuffer())], [1, 2, 3, 4]);
});
