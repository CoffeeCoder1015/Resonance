import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPillElapsed, voicePhaseToPillStatus } from './pillPresentation.ts';
import {
  clampMicrophoneLevel,
  FLAT_WAVEFORM_SCALE,
  scaleWaveformTexture,
  shapeMicrophoneLevel,
  smoothMicrophoneEnergy
} from './pillWaveformSignal.ts';

test('maps the voice lifecycle to pill presentation states', () => {
  assert.equal(voicePhaseToPillStatus('idle'), 'idle');
  assert.equal(voicePhaseToPillStatus('acquiring-microphone'), 'recording');
  assert.equal(voicePhaseToPillStatus('listening'), 'recording');
  assert.equal(voicePhaseToPillStatus('transcribing'), 'processing');
  assert.equal(voicePhaseToPillStatus('responding'), 'processing');
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

  assert.equal(attacked, 0.65);
  assert.equal(released, 0.7);
  assert.ok(attacked > 1 - released);
});

test('keeps ambient levels flat and preserves microphone volume differences', () => {
  assert.equal(shapeMicrophoneLevel(0.05), 0);
  assert.equal(shapeMicrophoneLevel(0.075), 0);

  const quiet = shapeMicrophoneLevel(0.15);
  const medium = shapeMicrophoneLevel(0.3);
  const loud = shapeMicrophoneLevel(0.5);

  assert.ok(quiet > 0);
  assert.ok(quiet < medium);
  assert.ok(medium < loud);
  assert.ok(loud < 1);
  assert.equal(shapeMicrophoneLevel(0.6), 1);
});

test('keeps every silent bar flat and scales texture linearly with microphone input', () => {
  assert.equal(scaleWaveformTexture(1, 0), FLAT_WAVEFORM_SCALE);
  assert.equal(scaleWaveformTexture(0, 1), FLAT_WAVEFORM_SCALE);
  assert.equal(scaleWaveformTexture(1, 1), 1);
  assert.equal(
    scaleWaveformTexture(1, 0.5),
    FLAT_WAVEFORM_SCALE + (1 - FLAT_WAVEFORM_SCALE) * 0.5
  );
});
