import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createAsrMiddleware } from './asr-middleware.mjs';
import { createVadAssetMap, createVadAssetMiddleware } from './vad-assets.mjs';

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.resolve(serverDirectory, '../dist/index.html');
const vadAssetDirectory = path.resolve(serverDirectory, '../dist/vad');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const handleAsr = createAsrMiddleware();
const handleVadAssets = createVadAssetMiddleware({
  assets: createVadAssetMap(vadAssetDirectory)
});

const server = createServer((request, response) => {
  void handleAsr(request, response, async () => {
    void handleVadAssets(request, response, async () => {
      const pathname = new URL(request.url || '/', 'http://resonance.local').pathname;
      if (request.method !== 'GET' || (pathname !== '/' && pathname !== '/index.html')) {
        response.statusCode = 404;
        response.end('Not found.');
        return;
      }

      try {
        const index = await readFile(indexPath);
        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader('Cache-Control', 'no-cache');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.end(index);
      } catch (error) {
        console.error('[server]', error);
        response.statusCode = 503;
        response.end('UI build is unavailable. Run npm run build first.');
      }
    });
  });
});

server.listen(port, host, () => {
  console.log(`Resonance website server listening on http://${host}:${port}`);
});
