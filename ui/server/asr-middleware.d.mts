import type { IncomingMessage, ServerResponse } from 'node:http';

type Next = () => void;

interface AsrMiddlewareOptions {
  timeoutMs?: number;
}

export function createAsrMiddleware(options?: AsrMiddlewareOptions): (
  request: IncomingMessage,
  response: ServerResponse,
  next: Next
) => Promise<void>;
