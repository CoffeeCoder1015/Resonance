export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body is too large.');
  }
}

function exceedsDeclaredLimit(request: Request, maximumBytes: number): boolean {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength === null) return false;

  const byteLength = Number(declaredLength);
  return Number.isFinite(byteLength) && byteLength > maximumBytes;
}

/**
 * Buffers a request only after enforcing an upper bound while it is read.
 * The Electron protocol still needs a complete Blob to construct the backend
 * multipart body, but this prevents arbitrary renderer input from being
 * accumulated first.
 */
export async function readRequestBodyWithinLimit(
  request: Request,
  maximumBytes: number,
): Promise<BlobPart[]> {
  if (exceedsDeclaredLimit(request, maximumBytes)) {
    throw new RequestBodyTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) return [];

  const chunks: BlobPart[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return chunks;

      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }

      // Copy the view's bytes only, avoiding retention of a larger source buffer.
      chunks.push(value.slice().buffer);
    }
  } finally {
    reader.releaseLock();
  }
}
