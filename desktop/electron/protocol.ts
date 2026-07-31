import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { protocol } from 'electron';

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.onnx': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm'
};

const API_PREFIX = '/api/';
const BACKEND_PREFIX = '/v1/';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

async function proxyBackend(request: Request, pathname: string): Promise<Response> {
  const backendOrigin = process.env.RESONANCE_BACKEND_ORIGIN || 'http://127.0.0.1:8000';
  const backendPath = `${BACKEND_PREFIX}${pathname.slice(API_PREFIX.length)}`;
  const headers = new Headers(request.headers);
  let body: BodyInit | undefined;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    if (pathname === '/api/voice/turns') {
      const contentType = headers.get('content-type') || 'application/octet-stream';
      if (!contentType.toLowerCase().startsWith('audio/')) {
        return jsonResponse(415, { error: 'An audio content type is required.' });
      }
      const form = new FormData();
      form.append(
        'file',
        new Blob([await request.arrayBuffer()], { type: contentType }),
        `recording.${contentType.split('/')[1]?.split(';')[0] || 'audio'}`
      );
      headers.delete('content-type');
      headers.delete('content-length');
      body = form;
    } else {
      body = await request.arrayBuffer();
    }
  }

  try {
    const response = await fetch(new URL(backendPath, backendOrigin), {
      method: request.method,
      headers,
      body,
      signal: request.signal
    });
    const responseBody = await response.arrayBuffer();
    if (!response.ok) {
      const result = JSON.parse(new TextDecoder().decode(responseBody)) as {
        detail?: string;
      };
      return jsonResponse(response.status, {
        error: result.detail || `Backend returned ${response.status}.`
      });
    }
    return new Response(responseBody, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/json',
        'Cache-Control': 'no-store'
      }
    });
  } catch (error) {
    console.error('[desktop-backend]', error);
    return jsonResponse(502, { error: 'Resonance backend is unavailable.' });
  }
}

function resolveAsset(pathname: string, mainRoot: string, pillRoot: string): string | null {
  if (pathname === '/' || pathname === '/index.html') {
    return path.join(mainRoot, 'index.html');
  }
  if (pathname === '/pill.html') {
    return path.join(pillRoot, 'pill.html');
  }
  if (pathname.startsWith('/assets/') || pathname.startsWith('/src/')) {
    return path.join(pillRoot, pathname);
  }
  if (pathname.startsWith('/vad/')) {
    return path.join(mainRoot, pathname);
  }
  return null;
}

export function installAppProtocol(mainRoot: string, pillRoot: string) {
  protocol.handle('resonance', async request => {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response('Not found.', { status: 404 });
    if (url.pathname.startsWith(API_PREFIX)) return proxyBackend(request, url.pathname);

    const assetPath = resolveAsset(decodeURIComponent(url.pathname), mainRoot, pillRoot);
    if (!assetPath) return new Response('Not found.', { status: 404 });

    const resolved = path.resolve(assetPath);
    const allowedRoots = [path.resolve(mainRoot), path.resolve(pillRoot)];
    if (!allowedRoots.some(root => resolved === root || resolved.startsWith(`${root}${path.sep}`))) {
      return new Response('Not found.', { status: 404 });
    }

    try {
      return new Response(await readFile(resolved), {
        headers: {
          'Content-Type': CONTENT_TYPES[path.extname(resolved)] || 'application/octet-stream',
          'Content-Security-Policy':
            "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none';",
          'X-Content-Type-Options': 'nosniff'
        }
      });
    } catch {
      return new Response('Asset unavailable.', { status: 404 });
    }
  });
}
