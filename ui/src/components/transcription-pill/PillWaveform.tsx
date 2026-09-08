import { memo, useEffect, useMemo, useRef } from 'react';
import type { PillStatus } from './pillPresentation';
import {
  clampMicrophoneLevel,
  FLAT_WAVEFORM_SCALE,
  scaleWaveformTexture,
  shapeMicrophoneLevel,
  smoothMicrophoneEnergy
} from './pillWaveformSignal';

const BAR_COUNT = 9;

function createBars() {
  return Array.from({ length: BAR_COUNT }, (_, index) => {
    const fraction = index / (BAR_COUNT - 1);
    return {
      index,
      phaseA: index * 0.37,
      phaseB: index * -0.61 + 1.3,
      frequencyA: 0.0001 + ((index * 7) % 5) * 0.000012,
      frequencyB: 0.00006 + ((index * 13) % 7) * 0.000008,
      jitter: 0.6 + ((index * 9.13) % 1),
      envelope: 0.62 + 0.38 * Math.cos((fraction - 0.5) * Math.PI * 0.9)
    };
  });
}

export const PillWaveform = memo(function PillWaveform({
  status,
  microphoneLevel = 0,
  active = true
}: {
  status: PillStatus;
  microphoneLevel?: number;
  active?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef(status);
  const parameters = useMemo(createBars, []);
  const current = useRef<number[]>(
    Array(BAR_COUNT).fill(FLAT_WAVEFORM_SCALE)
  );
  const microphoneLevelRef = useRef(0);
  const smoothedEnergyRef = useRef(0);
  statusRef.current = status;
  microphoneLevelRef.current = clampMicrophoneLevel(microphoneLevel);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const elements = Array.from(container.children) as HTMLDivElement[];
    if (!active) {
      elements.forEach(element => {
        element.style.transform = `scaleY(${FLAT_WAVEFORM_SCALE})`;
      });
      return;
    }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      elements.forEach(element => {
        element.style.transform = `scaleY(${FLAT_WAVEFORM_SCALE})`;
      });
      return;
    }

    let frame = 0;
    const animate = (now: number) => {
      const activeStatus = statusRef.current;
      const values = current.current;
      const inputEnergy =
        activeStatus === 'recording'
          ? shapeMicrophoneLevel(microphoneLevelRef.current)
          : 0;
      smoothedEnergyRef.current = smoothMicrophoneEnergy(
        smoothedEnergyRef.current,
        inputEnergy
      );

      let needsSettling = false;
      parameters.forEach((parameter, index) => {
        let target = FLAT_WAVEFORM_SCALE;
        if (activeStatus === 'recording' && smoothedEnergyRef.current > 0) {
          const wave =
            0.5 +
            0.32 * Math.sin(now * parameter.frequencyA + parameter.phaseA) +
            0.28 * Math.sin(now * parameter.frequencyB - parameter.phaseB);
          const noise =
            0.5 +
            0.5 * Math.sin(now * 0.011 * parameter.jitter + index * 1.7);
          const texture =
            (0.6 * wave + 0.4 * noise) * parameter.envelope;
          target = scaleWaveformTexture(texture, smoothedEnergyRef.current);
        }

        values[index] +=
          (target - values[index]) * (activeStatus === 'recording' ? 0.5 : 0.14);
        if (Math.abs(target - values[index]) > 0.001) needsSettling = true;
        const element = elements[index];
        if (element) element.style.transform = `scaleY(${values[index].toFixed(3)})`;
      });

      if (activeStatus === 'recording' || needsSettling) {
        frame = window.requestAnimationFrame(animate);
      }
    };

    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [active, parameters, status]);

  const color =
    status === 'recording'
      ? 'bg-[#FF3D7F]'
      : status === 'processing'
        ? 'bg-[#7C5CFF]'
        : status === 'error'
          ? 'bg-[#FF453A]'
          : 'bg-black';

  return (
    <div className="relative flex h-7 w-16 items-center justify-center">
      <div
        ref={containerRef}
        className="relative flex h-full items-center justify-center gap-[3px]"
        aria-hidden="true"
      >
        {parameters.map(({ index }) => (
          <div
            key={index}
            className={`h-full w-[2px] origin-center rounded-[1px] transition-colors duration-300 ${color}`}
            style={{ transform: `scaleY(${FLAT_WAVEFORM_SCALE})` }}
          />
        ))}
      </div>
      {status === 'processing' ? (
        <div className="pointer-events-none absolute inset-y-0 -left-1 -right-1 overflow-hidden">
          <div className="pill-animate-scan absolute inset-y-0 w-1 bg-black" />
        </div>
      ) : null}
    </div>
  );
});
