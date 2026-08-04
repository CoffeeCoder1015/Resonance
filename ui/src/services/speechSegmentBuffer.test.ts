import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SpeechSegmentBuffer } from './speechSegmentBuffer.ts';

test('concatenates all VAD speech into one 16 kHz WAV without synthetic silence', async () => {
  const buffer = new SpeechSegmentBuffer();
  buffer.append(new Float32Array([0.5, -0.5]));
  buffer.append(new Float32Array([1]));

  const wav = buffer.drainWav();
  assert.ok(wav);

  const view = new DataView(await wav.arrayBuffer());
  assert.equal(String.fromCharCode(...new Uint8Array(view.buffer, 0, 4)), 'RIFF');
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint32(40, true), 3 * 2);
  assert.equal(view.getInt16(44, true), 0x3fff);
  assert.equal(view.getInt16(46, true), -0x4000);
  assert.equal(view.getInt16(48, true), 0x7fff);
  assert.equal(buffer.drainWav(), null);
});

test('ignores empty VAD segments and clears after draining', async () => {
  const buffer = new SpeechSegmentBuffer();
  buffer.append(new Float32Array());
  assert.equal(buffer.drainWav(), null);

  buffer.append(new Float32Array([0.1, 0.2]));
  const wav = buffer.drainWav();
  assert.ok(wav);
  assert.equal(new DataView(await wav.arrayBuffer()).getUint32(40, true), 4);
  assert.equal(buffer.drainWav(), null);
});
