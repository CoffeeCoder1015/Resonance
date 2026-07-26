import type { IncomingMessage, ServerResponse } from 'node:http';

type Next = () => void;

export function createAsrMiddleware(): (
  request: IncomingMessage,
  response: ServerResponse,
  next: Next
) => Promise<void>;
