import type { IncomingMessage, ServerResponse } from 'node:http';

type Next = () => void;

interface BackendMiddlewareOptions {
  timeoutMs?: number;
}

export function createBackendMiddleware(options?: BackendMiddlewareOptions): (
  request: IncomingMessage,
  response: ServerResponse,
  next: Next
) => Promise<void>;
