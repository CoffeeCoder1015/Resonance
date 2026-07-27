import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const uiDirectory = path.resolve(serverDirectory, '..');

export const VAD_ASSET_NAMES = [
  'vad.worklet.bundle.min.js',
  'silero_vad_v5.onnx',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm'
];

export const VAD_SOURCE_ASSETS = {
  'vad.worklet.bundle.min.js': path.join(
    uiDirectory,
    'node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js'
  ),
  'silero_vad_v5.onnx': path.join(
    uiDirectory,
    'node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx'
  ),
  'ort-wasm-simd-threaded.mjs': path.join(
    uiDirectory,
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs'
  ),
  'ort-wasm-simd-threaded.wasm': path.join(
    uiDirectory,
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm'
  )
};

const CONTENT_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.onnx': 'application/octet-stream',
  '.wasm': 'application/wasm'
};

export function createVadAssetMap(directory) {
  return Object.fromEntries(
    VAD_ASSET_NAMES.map(name => [name, path.join(directory, name)])
  );
}

export function createVadAssetMiddleware({ assets = VAD_SOURCE_ASSETS } = {}) {
  return async (request, response, next) => {
    const pathname = new URL(request.url || '/', 'http://resonance.local').pathname;
    const name = pathname.startsWith('/vad/') ? pathname.slice('/vad/'.length) : '';
    const assetPath = assets[name];

    if (
      (request.method !== 'GET' && request.method !== 'HEAD') ||
      !assetPath ||
      name.includes('/')
    ) {
      next();
      return;
    }

    try {
      const contents = await readFile(assetPath);
      response.statusCode = 200;
      response.setHeader(
        'Content-Type',
        CONTENT_TYPES[path.extname(name)] || 'application/octet-stream'
      );
      response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.end(request.method === 'HEAD' ? undefined : contents);
    } catch (error) {
      console.error('[vad-assets]', error);
      response.statusCode = 503;
      response.end('VAD asset is unavailable.');
    }
  };
}

export async function copyVadAssets(outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(
    Object.entries(VAD_SOURCE_ASSETS).map(([name, source]) =>
      copyFile(source, path.join(outputDirectory, name))
    )
  );
}
