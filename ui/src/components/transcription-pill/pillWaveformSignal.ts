const ATTACK = 0.65;
const RELEASE = 0.3;
const NOISE_FLOOR = 0.075;
const REFERENCE_SPEECH_LEVEL = 0.6;

export const FLAT_WAVEFORM_SCALE = 1 / 28;

export function clampMicrophoneLevel(level: number) {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(1, level));
}

export function shapeMicrophoneLevel(level: number) {
  const clamped = clampMicrophoneLevel(level);
  if (clamped <= NOISE_FLOOR) return 0;
  return Math.min(
    1,
    (clamped - NOISE_FLOOR) / (REFERENCE_SPEECH_LEVEL - NOISE_FLOOR)
  );
}

export function scaleWaveformTexture(texture: number, magnitude: number) {
  const safeTexture = clampMicrophoneLevel(texture);
  const safeMagnitude = clampMicrophoneLevel(magnitude);
  return (
    FLAT_WAVEFORM_SCALE +
    safeMagnitude * (1 - FLAT_WAVEFORM_SCALE) * safeTexture
  );
}

export function smoothMicrophoneEnergy(current: number, input: number) {
  const safeCurrent = clampMicrophoneLevel(current);
  const safeInput = clampMicrophoneLevel(input);
  const response = safeInput > safeCurrent ? ATTACK : RELEASE;
  return safeCurrent + (safeInput - safeCurrent) * response;
}
