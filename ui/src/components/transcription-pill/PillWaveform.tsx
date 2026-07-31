import { memo, useEffect, useMemo, useRef } from 'react';
import type { PillStatus } from './pillPresentation';
import {
  clampMicrophoneLevel,
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
  microphoneLevel = 0
}: {
  status: PillStatus;
  microphoneLevel?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef(status);
  const parameters = useMemo(createBars, []);
  const current = useRef<number[]>(Array(BAR_COUNT).fill(0.1));
  const microphoneLevelRef = useRef(0);
  const smoothedEnergyRef = useRef(0);
  statusRef.current = status;
  microphoneLevelRef.current = clampMicrophoneLevel(microphoneLevel);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const elements = Array.from(container.children) as HTMLDivElement[];
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      elements.forEach(element => {
        element.style.transform = 'scaleY(0.12)';
      });
      return;
    }

    let frame = 0;
    const animate = (now: number) => {
      const activeStatus = statusRef.current;
      const values = current.current;
      const inputEnergy =
        activeStatus === 'recording' ? microphoneLevelRef.current : 0;
      smoothedEnergyRef.current = smoothMicrophoneEnergy(
        smoothedEnergyRef.current,
        inputEnergy
      );

      parameters.forEach((parameter, index) => {
        let target: number;
        if (activeStatus === 'recording') {
          const burst = 0.5 + 0.5 * Math.sin(now * 0.0023 + index * 0.2);
          const wave =
            0.5 +
            0.32 * Math.sin(now * parameter.frequencyA + parameter.phaseA) +
            0.28 * Math.sin(now * parameter.frequencyB - parameter.phaseB);
          const noise =
            0.5 + 0.5 * Math.sin(now * 0.011 * parameter.jitter + index * 1.7);
          const pattern =
            (0.3 + 0.5 * burst) *
            (0.6 * wave + 0.4 * noise) *
            parameter.envelope;
          target = 0.08 + smoothedEnergyRef.current * (0.22 + 0.78 * pattern);
        } else if (activeStatus === 'processing') {
          target = 0.13 + 0.04 * Math.sin(now * 0.004 + index * 0.5);
        } else {
          target =
            0.08 +
            0.06 *
              (0.5 + 0.5 * Math.sin(now * 0.0028 + index * 0.45)) *
              parameter.envelope;
        }

        const clamped = Math.max(0.05, Math.min(1, target));
        values[index] += (clamped - values[index]) * (activeStatus === 'recording' ? 0.5 : 0.14);
        const element = elements[index];
        if (element) element.style.transform = `scaleY(${values[index].toFixed(3)})`;
      });

      frame = window.requestAnimationFrame(animate);
    };

    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [parameters]);

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
            className={`h-full w-1 origin-center rounded-[1px] transition-colors duration-300 ${color}`}
            style={{ transform: 'scaleY(0.1)' }}
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
