import React, { useCallback, useEffect, useRef } from 'react';
import { AgentState, DialogueTurn } from '../types/voice';

interface TranscriptLogProps {
  transcript: DialogueTurn[];
  agentState: AgentState;
}

const Caret = () => (
  <span className="inline-block w-[3px] h-[1em] ml-1 bg-current align-[-0.12em] animate-pulse rounded-[1px]" />
);

function setNeutralWheelStyle(element: HTMLElement) {
  element.style.setProperty('--wheel-opacity', '1');
  element.style.setProperty('--wheel-angle', '0deg');
  element.style.setProperty('--wheel-y', '0px');
  element.style.setProperty('--wheel-z', '0px');
  element.style.setProperty('--wheel-blur', '0px');
  element.style.setProperty('--wheel-brightness', '1');
}

function setHiddenWheelStyle(element: HTMLElement) {
  element.style.setProperty('--wheel-opacity', '0');
  element.style.setProperty('--wheel-angle', '0deg');
  element.style.setProperty('--wheel-y', '0px');
  element.style.setProperty('--wheel-z', '0px');
  element.style.setProperty('--wheel-blur', '0px');
  element.style.setProperty('--wheel-brightness', '1');
}

function applyWheelStyle(
  element: HTMLElement,
  normalizedPosition: number,
  linearOffset: number,
  cylinderRadius: number,
  maximumAngleRadians: number,
  maximumAngleDegrees: number,
  edgeAmount: number
) {
  const angleRadians = normalizedPosition * maximumAngleRadians;
  const desiredOffset = Math.sin(angleRadians) * cylinderRadius;
  const cylinderShift = desiredOffset - linearOffset;
  const depth = cylinderRadius * (Math.cos(angleRadians) - 1);

  element.style.setProperty('--wheel-opacity', String(1 - edgeAmount * 0.96));
  element.style.setProperty('--wheel-angle', `${normalizedPosition * -maximumAngleDegrees}deg`);
  element.style.setProperty('--wheel-y', `${cylinderShift}px`);
  element.style.setProperty('--wheel-z', `${depth}px`);
  element.style.setProperty('--wheel-blur', `${Math.pow(edgeAmount, 1.55) * 5.5}px`);
  element.style.setProperty('--wheel-brightness', String(1 - edgeAmount * 0.14));
}

export const TranscriptLog: React.FC<TranscriptLogProps> = ({
  transcript,
  agentState
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const effectsFrameRef = useRef<number | null>(null);
  const lastText = transcript[transcript.length - 1]?.text;

  const updateScrollEffects = useCallback(() => {
    const scrollArea = scrollRef.current;
    if (!scrollArea) return;

    const wheelIsActive = scrollArea.classList.contains('has-history');
    const viewport = scrollArea.getBoundingClientRect();
    const viewportCenter = viewport.top + viewport.height / 2;
    const wheelHalfHeight = Math.max(viewport.height / 2, 1);
    const baseFocusHalfHeight = wheelHalfHeight * 0.34;
    const rollTravel = Math.max(wheelHalfHeight - baseFocusHalfHeight, 1);
    const edgeFadeZone = Math.min(84, Math.max(48, viewport.height * 0.2));
    const maximumAngleDegrees = 56;
    const maximumAngleRadians = (maximumAngleDegrees * Math.PI) / 180;
    const classicCylinderRadius = wheelHalfHeight / Math.sin(maximumAngleRadians);
    const scaledCylinderRadius = rollTravel / Math.sin(maximumAngleRadians);

    scrollArea.querySelectorAll<HTMLElement>('[data-transcript-turn]').forEach(slot => {
      const turn = slot.querySelector<HTMLElement>('[data-transcript-visual]');
      if (!turn) return;

      if (!wheelIsActive) {
        setNeutralWheelStyle(turn);
        return;
      }

      const bounds = slot.getBoundingClientRect();
      if (bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) {
        setHiddenWheelStyle(turn);
        return;
      }

      const turnCenter = bounds.top + bounds.height / 2;
      const centerOffset = turnCenter - viewportCenter;
      const classicPosition = Math.max(
        -1,
        Math.min(1, centerOffset / wheelHalfHeight)
      );
      const classicAbsolutePosition = Math.abs(classicPosition);
      const classicEdgeProgress = Math.max(
        0,
        Math.min(1, (classicAbsolutePosition - 0.34) / 0.66)
      );
      const classicCenterEdgeAmount = Math.pow(classicEdgeProgress, 1.45);
      const distanceFromNearestEdge = Math.max(
        0,
        Math.min(turnCenter - viewport.top, viewport.bottom - turnCenter)
      );
      const classicEdgeApproach = Math.max(
        0,
        Math.min(
          1,
          (bounds.height / 2 + edgeFadeZone - distanceFromNearestEdge) /
            edgeFadeZone
        )
      );
      const classicEdgeAmount = Math.max(
        classicCenterEdgeAmount,
        classicEdgeApproach * classicEdgeProgress * 0.82
      );

      const dynamicFocusHalfHeight = baseFocusHalfHeight + bounds.height / 2;
      const distanceBeyondFocus = Math.max(
        0,
        Math.abs(centerOffset) - dynamicFocusHalfHeight
      );
      const scaledLinearOffset = Math.sign(centerOffset) * distanceBeyondFocus;
      const scaledPosition = Math.max(
        -1,
        Math.min(1, scaledLinearOffset / rollTravel)
      );
      const scaledEdgeAmount = Math.pow(Math.abs(scaledPosition), 1.45);

      const shortPillHeight = wheelHalfHeight * 0.55;
      const longPillHeight = wheelHalfHeight * 0.95;
      const heightProgress = Math.max(
        0,
        Math.min(
          1,
          (bounds.height - shortPillHeight) /
            Math.max(longPillHeight - shortPillHeight, 1)
        )
      );
      const scaledFocusWeight =
        heightProgress * heightProgress * (3 - 2 * heightProgress);
      const classicWeight = 1 - scaledFocusWeight;
      const normalizedPosition =
        classicPosition * classicWeight + scaledPosition * scaledFocusWeight;
      const linearOffset =
        centerOffset * classicWeight + scaledLinearOffset * scaledFocusWeight;
      const cylinderRadius =
        classicCylinderRadius * classicWeight +
        scaledCylinderRadius * scaledFocusWeight;
      const edgeAmount =
        classicEdgeAmount * classicWeight +
        scaledEdgeAmount * scaledFocusWeight;

      applyWheelStyle(
        turn,
        normalizedPosition,
        linearOffset,
        cylinderRadius,
        maximumAngleRadians,
        maximumAngleDegrees,
        edgeAmount
      );
    });
  }, []);

  const queueScrollEffects = useCallback(() => {
    if (effectsFrameRef.current !== null) return;
    effectsFrameRef.current = window.requestAnimationFrame(() => {
      effectsFrameRef.current = null;
      updateScrollEffects();
    });
  }, [updateScrollEffects]);

  useEffect(() => {
    const scrollArea = scrollRef.current;
    if (!scrollArea) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scrollArea.scrollTo({
      top: scrollArea.scrollHeight,
      behavior: reduceMotion ? 'auto' : 'smooth'
    });
    const frame = window.requestAnimationFrame(updateScrollEffects);
    return () => window.cancelAnimationFrame(frame);
  }, [transcript.length, lastText, updateScrollEffects]);

  useEffect(() => {
    const scrollArea = scrollRef.current;
    if (!scrollArea) return;
    const resizeObserver = new ResizeObserver(queueScrollEffects);
    resizeObserver.observe(scrollArea);
    return () => {
      resizeObserver.disconnect();
      if (effectsFrameRef.current !== null) {
        window.cancelAnimationFrame(effectsFrameRef.current);
        effectsFrameRef.current = null;
      }
    };
  }, [queueScrollEffects]);

  const visibleTurns = transcript.filter(turn => turn.text.trim().length > 0 || turn.isStreaming);
  if (visibleTurns.length === 0) return null;
  const hasWheelHistory = visibleTurns.length > 2 || agentState === 'processing';

  return (
    <div className="relative w-full max-w-3xl mx-auto z-10">
      <div
        ref={scrollRef}
        onScroll={queueScrollEffects}
        className={`transcript-wheel no-scrollbar overflow-y-auto overscroll-contain px-4 select-text ${
          hasWheelHistory ? 'has-history' : ''
        }`}
        role="log"
        aria-label="Dialogue history"
      >
        <div className="transcript-wheel-track flex flex-col items-center gap-3 w-full">
          {visibleTurns.map((turn, index) => {
            const isLatest = index === visibleTurns.length - 1;
            const isUser = turn.sender === 'user';

            return (
              <div
                key={turn.id}
                data-transcript-turn
                className="w-full"
              >
                <div data-transcript-visual className="transcript-turn w-full flex flex-col items-center">
                  <span
                    className={`mb-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-extrabold uppercase tracking-widest border-2 border-black neo-shadow-sm ${
                      isUser ? 'bg-[#00e676] text-black' : 'bg-[#ff007f] text-white'
                    }`}
                  >
                    {isUser ? 'YOU' : 'AGENT'}
                  </span>

                  <div
                    className={`w-fit max-w-full px-5 py-3 rounded-3xl border-[3px] border-black neo-shadow text-center break-words ${
                      isUser
                        ? 'bg-white text-zinc-950 italic font-semibold'
                        : 'bg-[#111111] text-white font-bold'
                    }`}
                  >
                    <p className={`whitespace-pre-wrap leading-snug tracking-tight ${isLatest ? 'text-base sm:text-xl' : 'text-sm sm:text-base'}`}>
                      {turn.text}
                      {turn.isStreaming && <Caret />}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}

          {agentState === 'processing' && (
            <div data-transcript-turn className="w-full">
              <div data-transcript-visual className="transcript-turn w-full flex flex-col items-center">
                <span className="mb-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-extrabold uppercase tracking-widest border-2 border-black neo-shadow-sm bg-[#ffde00] text-black">
                  AGENT
                </span>
                <div className="px-5 py-3.5 rounded-3xl bg-white border-[3px] border-black neo-shadow flex items-center gap-2">
                  <span className="w-2.5 h-2.5 bg-[#ff007f] rounded-full animate-bounce" />
                  <span className="w-2.5 h-2.5 bg-[#007bff] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2.5 h-2.5 bg-[#00e676] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
