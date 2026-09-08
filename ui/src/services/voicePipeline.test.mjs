import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('./voicePipeline.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
});

function createPipeline(captures) {
  const exports = {};
  runInNewContext(outputText, {
    exports,
    AbortController,
    DOMException,
    require(name) {
      if (name === './microphoneCapture') {
        return {
          MicrophoneCapture: {
            async open() {
              assert.ok(captures.length, 'Unexpected extra microphone acquisition');
              return captures.shift();
            }
          }
        };
      }
      if (name === './backend') return {};
      throw new Error(`Unexpected import: ${name}`);
    }
  });
  return new exports.VoicePipeline();
}

const options = { mode: 'hold', onUtterance() {} };

function recorder() {
  const audio = new Blob(['recorded audio'], { type: 'audio/wav' });
  return {
    disposed: false,
    async start() {},
    async resume() {},
    async discardAndPause() {},
    async finish() { return audio; },
    async dispose() { this.disposed = true; }
  };
}

test('failed microphone startup reports its error and the next dictation uses a fresh recorder', async () => {
  const failed = recorder();
  const failure = new DOMException('Microphone permission denied', 'NotAllowedError');
  let attempted = false;
  failed.start = async () => {
    // MicVAD rejects the first acquisition, but only logs on later starts.
    if (!attempted) {
      attempted = true;
      throw failure;
    }
  };
  failed.finish = async () => null;
  const healthy = recorder();
  const pipeline = createPipeline([failed, healthy]);

  await assert.rejects(pipeline.start(options), error => error === failure);
  const retry = await pipeline.start(options);
  assert.ok(await pipeline.finish(retry), 'Retry must produce recorded audio');
  assert.equal(failed.disposed, true);
  await pipeline.dispose();
});

test('failed microphone resume reports its error and allows a new dictation', async () => {
  const failed = recorder();
  const failure = new DOMException('Microphone unavailable', 'NotReadableError');
  failed.resume = async () => {
    // A failed reacquisition can leave MicVAD listening without a live stream.
    failed.finish = async () => null;
    throw failure;
  };
  const pipeline = createPipeline([failed, recorder()]);
  const capture = await pipeline.start(options);
  await pipeline.finish(capture);

  await assert.rejects(pipeline.resume(capture), error => error === failure);
  const retry = await pipeline.start(options);
  assert.ok(await pipeline.finish(retry), 'Retry must produce recorded audio');
  assert.equal(failed.disposed, true);
  await pipeline.dispose();
});
