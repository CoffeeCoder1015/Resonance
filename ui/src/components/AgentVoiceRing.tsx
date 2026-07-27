import { useEffect, useRef } from 'react';

interface AgentVoiceRingProps {
  active: boolean;
  voiceLevel: number;
  frequencies: Uint8Array;
}

interface Point {
  x: number;
  y: number;
}

const CENTER = 32;
const INNER_RADIUS = 20.5;
const BASE_OUTER_RADIUS = 22.9;
const POINT_COUNT = 64;
const DISPLAY_BAND_COUNT = 24;

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function sampleFrequencyBand(frequencies: Uint8Array, bandIndex: number) {
  if (frequencies.length === 0) return 0;

  const usableBinCount = Math.max(1, Math.min(frequencies.length, 96));
  const normalizedBand = bandIndex / Math.max(1, DISPLAY_BAND_COUNT - 1);
  const curvedPosition = normalizedBand ** 1.65;
  const sourceIndex = Math.min(
    frequencies.length - 1,
    Math.floor(curvedPosition * (usableBinCount - 1))
  );
  return frequencies[sourceIndex] / 255;
}

function buildSpectrumValues(
  timeSeconds: number,
  voiceLevel: number,
  frequencies: Uint8Array
) {
  const rawValues = Array.from({ length: POINT_COUNT }, (_, index) => {
    const angleProgress = index / POINT_COUNT;
    const bandPosition = angleProgress * DISPLAY_BAND_COUNT;
    const lowerBand = Math.floor(bandPosition) % DISPLAY_BAND_COUNT;
    const upperBand = (lowerBand + 1) % DISPLAY_BAND_COUNT;
    const bandMix = bandPosition - Math.floor(bandPosition);
    const bandEnergy =
      sampleFrequencyBand(frequencies, lowerBand) * (1 - bandMix) +
      sampleFrequencyBand(frequencies, upperBand) * bandMix;

    const idleField =
      0.52 +
      Math.sin(timeSeconds * 0.52 + angleProgress * Math.PI * 4.0) * 0.27 +
      Math.sin(timeSeconds * 0.29 - angleProgress * Math.PI * 6.0 + 1.4) * 0.18 +
      Math.sin(timeSeconds * 0.17 + angleProgress * Math.PI * 10.0 + 3.1) * 0.1;

    return clamp(idleField) * 0.9 + bandEnergy * voiceLevel * 0.95;
  });

  return rawValues.map((_, index) => {
    let weightedTotal = 0;
    let weightTotal = 0;

    for (let offset = -3; offset <= 3; offset += 1) {
      const weight = 4 - Math.abs(offset);
      const wrappedIndex = (index + offset + POINT_COUNT) % POINT_COUNT;
      weightedTotal += rawValues[wrappedIndex] * weight;
      weightTotal += weight;
    }

    return weightedTotal / weightTotal;
  });
}

function buildClosedSpline(points: Point[]) {
  if (points.length < 2) return '';

  const commands = [`M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`];
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const nextNext = points[(index + 2) % points.length];
    const controlOne = {
      x: current.x + (next.x - points[(index - 1 + points.length) % points.length].x) / 6,
      y: current.y + (next.y - points[(index - 1 + points.length) % points.length].y) / 6
    };
    const controlTwo = {
      x: next.x - (nextNext.x - current.x) / 6,
      y: next.y - (nextNext.y - current.y) / 6
    };
    commands.push(
      `C${controlOne.x.toFixed(2)} ${controlOne.y.toFixed(2)} ` +
        `${controlTwo.x.toFixed(2)} ${controlTwo.y.toFixed(2)} ` +
        `${next.x.toFixed(2)} ${next.y.toFixed(2)}`
    );
  }

  return `${commands.join(' ')} Z`;
}

function buildSpectrumPaths(
  timeSeconds: number,
  voiceLevel: number,
  frequencies: Uint8Array
) {
  const spectrumValues = buildSpectrumValues(timeSeconds, voiceLevel, frequencies);
  const outerPoints = spectrumValues.map((value, index) => {
    const angle = -Math.PI / 2 + (index / POINT_COUNT) * Math.PI * 2;
    const radius = BASE_OUTER_RADIUS + value * (2.5 + voiceLevel * 2.1);
    return {
      x: CENTER + Math.cos(angle) * radius,
      y: CENTER + Math.sin(angle) * radius
    };
  });
  const outerPath = buildClosedSpline(outerPoints);
  const innerPath =
    `M${CENTER + INNER_RADIUS} ${CENTER} ` +
    `A${INNER_RADIUS} ${INNER_RADIUS} 0 1 0 ${CENTER - INNER_RADIUS} ${CENTER} ` +
    `A${INNER_RADIUS} ${INNER_RADIUS} 0 1 0 ${CENTER + INNER_RADIUS} ${CENTER} Z`;

  return {
    areaPath: `${outerPath} ${innerPath}`,
    outerPath
  };
}

export function AgentVoiceRing({
  active,
  voiceLevel,
  frequencies
}: AgentVoiceRingProps) {
  const areaPathRef = useRef<SVGPathElement | null>(null);
  const glowPathRef = useRef<SVGPathElement | null>(null);
  const edgePathRef = useRef<SVGPathElement | null>(null);
  const voiceLevelRef = useRef(voiceLevel);
  const frequenciesRef = useRef(frequencies);

  useEffect(() => {
    voiceLevelRef.current = clamp(voiceLevel);
    frequenciesRef.current = frequencies;
  }, [frequencies, voiceLevel]);

  useEffect(() => {
    const areaPath = areaPathRef.current;
    const glowPath = glowPathRef.current;
    const edgePath = edgePathRef.current;
    if (!areaPath || !glowPath || !edgePath) return;

    const setPaths = (timeSeconds: number, level: number) => {
      const paths = buildSpectrumPaths(timeSeconds, level, frequenciesRef.current);
      areaPath.setAttribute('d', paths.areaPath);
      glowPath.setAttribute('d', paths.outerPath);
      edgePath.setAttribute('d', paths.outerPath);
      areaPath.style.opacity = `${0.76 + level * 0.12}`;
      glowPath.style.opacity = `${0.42 + level * 0.2}`;
      glowPath.style.strokeWidth = `${2.5 + level * 0.65}`;
      edgePath.style.opacity = `${0.78 + level * 0.16}`;
    };

    if (!active) {
      setPaths(0, 0);
      return;
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const startedAt = performance.now();
    let smoothedLevel = reduceMotion ? 0.12 : voiceLevelRef.current;
    let animationFrame = 0;

    const renderFrame = (now: number) => {
      const targetLevel = reduceMotion ? 0.12 : voiceLevelRef.current;
      smoothedLevel += (targetLevel - smoothedLevel) * 0.09;
      const elapsedSeconds = reduceMotion ? 0 : (now - startedAt) / 1_000;
      setPaths(elapsedSeconds, smoothedLevel);

      if (!reduceMotion) {
        animationFrame = requestAnimationFrame(renderFrame);
      }
    };

    renderFrame(startedAt);
    return () => cancelAnimationFrame(animationFrame);
  }, [active]);

  return (
    <span className="agent-mode-edge-light" aria-hidden="true">
      <svg
        className="agent-mode-wave-ring"
        viewBox="0 0 64 64"
        preserveAspectRatio="xMidYMid meet"
        focusable="false"
      >
        <path ref={areaPathRef} className="agent-mode-spectrum-fill" fillRule="evenodd" />
        <path ref={glowPathRef} className="agent-mode-spectrum-glow" />
        <path ref={edgePathRef} className="agent-mode-spectrum-edge" />
      </svg>
    </span>
  );
}
