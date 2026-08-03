import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SpeechSegmentBuffer } from './speechSegmentBuffer.ts';

test('concatenates VAD speech without synthetic silence and emits 16 kHz WAV', async () => {
  const buffer = new SpeechSegmentBuffer({ chunkSeconds: 1 });
  buffer.append(new Float32Array([0.5, -0.5]));
  buffer.append(new Float32Array([1]));

  const chunks = buffer.drainWavChunks();
  assert.equal(chunks.length, 1);
  const [wav] = chunks;

  const view = new DataView(await wav.arrayBuffer());
  assert.equal(String.fromCharCode(...new Uint8Array(view.buffer, 0, 4)), 'RIFF');
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint32(40, true), 3 * 2);
  assert.equal(view.getInt16(44, true), 0x3fff);
  assert.equal(view.getInt16(46, true), -0x4000);
  assert.equal(view.getInt16(48, true), 0x7fff);
  assert.deepEqual(buffer.drainWavChunks(), []);
});

test('chunks all accumulated speech without truncating it', async () => {
  const buffer = new SpeechSegmentBuffer({ chunkSeconds: 0.000125 });
  buffer.append(new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]));

  const chunks = buffer.drainWavChunks();
  assert.equal(chunks.length, 3);
  assert.deepEqual(
    await Promise.all(
      chunks.map(async wav =>
        new DataView(await wav.arrayBuffer()).getUint32(40, true)
      )
    ),
    [4, 4, 2]
  );

  buffer.append(new Float32Array());
  assert.deepEqual(buffer.drainWavChunks(), []);
});

test('prefers VAD segment boundaries without retaining the removed silence', async () => {
  const buffer = new SpeechSegmentBuffer({ chunkSeconds: 0.0001875 });
  buffer.append(new Float32Array([0.1, 0.2]));
  buffer.append(new Float32Array([0.3, 0.4]));

  const chunks = buffer.drainWavChunks();
  assert.equal(chunks.length, 2);
  assert.deepEqual(
    await Promise.all(
      chunks.map(async wav =>
        new DataView(await wav.arrayBuffer()).getUint32(40, true)
      )
    ),
    [4, 4]
  );
});
