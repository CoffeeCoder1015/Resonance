import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPillElapsed, voicePhaseToPillStatus } from './pillPresentation.ts';
import {
  clampMicrophoneLevel,
  smoothMicrophoneEnergy
} from './pillWaveformSignal.ts';

test('maps the voice lifecycle to pill presentation states', () => {
  assert.equal(voicePhaseToPillStatus('idle'), 'idle');
  assert.equal(voicePhaseToPillStatus('acquiring-microphone'), 'recording');
  assert.equal(voicePhaseToPillStatus('listening'), 'recording');
  assert.equal(voicePhaseToPillStatus('transcribing'), 'processing');
  assert.equal(voicePhaseToPillStatus('responding'), 'processing');
  assert.equal(voicePhaseToPillStatus('speaking'), 'idle');
});

test('formats bounded elapsed time', () => {
  assert.equal(formatPillElapsed(-1), '0:00');
  assert.equal(formatPillElapsed(5.9), '0:05');
  assert.equal(formatPillElapsed(125), '2:05');
});

test('clamps microphone levels at the renderer boundary', () => {
  assert.equal(clampMicrophoneLevel(Number.NaN), 0);
  assert.equal(clampMicrophoneLevel(-0.5), 0);
  assert.equal(clampMicrophoneLevel(0.4), 0.4);
  assert.equal(clampMicrophoneLevel(2), 1);
});

test('uses a faster attack than release for microphone energy', () => {
  const attacked = smoothMicrophoneEnergy(0, 1);
  const released = smoothMicrophoneEnergy(1, 0);

  assert.equal(attacked, 0.34);
  assert.equal(released, 0.92);
  assert.ok(attacked > 1 - released);
});
