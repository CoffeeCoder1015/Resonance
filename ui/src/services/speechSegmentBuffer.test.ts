import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SpeechSegmentBuffer } from './speechSegmentBuffer.ts';

test('joins detected speech with a short fixed gap and emits 16 kHz WAV', async () => {
  const buffer = new SpeechSegmentBuffer({ gapMs: 1, maxSpeechSeconds: 1 });
  buffer.append(new Float32Array([0.5, -0.5]));
  buffer.append(new Float32Array([1]));

  const wav = buffer.drainWav();
  assert.ok(wav);

  const view = new DataView(await wav.arrayBuffer());
  assert.equal(String.fromCharCode(...new Uint8Array(view.buffer, 0, 4)), 'RIFF');
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint32(40, true), (2 + 16 + 1) * 2);
  assert.equal(view.getInt16(44, true), 0x3fff);
  assert.equal(view.getInt16(46, true), -0x4000);
  assert.equal(view.getInt16(48, true), 0);
  assert.equal(view.getInt16(44 + (2 + 16) * 2, true), 0x7fff);
  assert.equal(buffer.drainWav(), null);
});

test('caps accumulated speech without manufacturing an empty recording', async () => {
  const buffer = new SpeechSegmentBuffer({ gapMs: 0, maxSpeechSeconds: 0.000125 });
  buffer.append(new Float32Array([0.1, 0.2, 0.3]));

  const wav = buffer.drainWav();
  assert.ok(wav);
  const view = new DataView(await wav.arrayBuffer());
  assert.equal(view.getUint32(40, true), 4);

  buffer.append(new Float32Array());
  assert.equal(buffer.drainWav(), null);
});
