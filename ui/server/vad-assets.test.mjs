import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { createVadAssetMiddleware } from './vad-assets.mjs';

const servers = new Set();
const temporaryDirectories = new Set();

afterEach(async () => {
  await Promise.all(
    [...servers].map(server => new Promise(resolve => server.close(resolve)))
  );
  servers.clear();
  await Promise.all(
    [...temporaryDirectories].map(directory =>
      rm(directory, { recursive: true, force: true })
    )
  );
  temporaryDirectories.clear();
});

async function startServer(assets) {
  const middleware = createVadAssetMiddleware({ assets });
  const server = createServer((request, response) => {
    void middleware(request, response, () => {
      response.statusCode = 404;
      response.end('Not found.');
    });
  });
  servers.add(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

test('serves only explicitly registered VAD assets with their required MIME type', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'resonance-vad-assets-'));
  temporaryDirectories.add(directory);
  const wasmPath = path.join(directory, 'runtime.wasm');
  await writeFile(wasmPath, new Uint8Array([0, 97, 115, 109]));
  const origin = await startServer({ 'runtime.wasm': wasmPath });

  const response = await fetch(`${origin}/vad/runtime.wasm`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/wasm');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([0, 97, 115, 109]));

  assert.equal((await fetch(`${origin}/vad/../package.json`)).status, 404);
  assert.equal((await fetch(`${origin}/vad/not-registered.wasm`)).status, 404);
});
