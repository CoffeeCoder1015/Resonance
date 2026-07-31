const ATTACK = 0.34;
const RELEASE = 0.08;

export function clampMicrophoneLevel(level: number) {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(1, level));
}

export function smoothMicrophoneEnergy(current: number, input: number) {
  const safeCurrent = clampMicrophoneLevel(current);
  const safeInput = clampMicrophoneLevel(input);
  const response = safeInput > safeCurrent ? ATTACK : RELEASE;
  return safeCurrent + (safeInput - safeCurrent) * response;
}
