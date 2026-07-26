import React, { useCallback, useEffect, useRef } from 'react';
import { AgentState, DialogueTurn } from '../types/voice';

interface TranscriptLogProps {
  transcript: DialogueTurn[];
  agentState: AgentState;
}

const Caret = () => (
  <span className="inline-block w-[3px] h-[1em] ml-1 bg-current align-[-0.12em] animate-pulse rounded-[1px]" />
);

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
    const edgeFadeZone = Math.min(84, Math.max(48, viewport.height * 0.2));
    const maximumAngleDegrees = 56;
    const maximumAngleRadians = (maximumAngleDegrees * Math.PI) / 180;
    const cylinderRadius = wheelHalfHeight / Math.sin(maximumAngleRadians);

    scrollArea.querySelectorAll<HTMLElement>('[data-transcript-turn]').forEach(slot => {
      const turn = slot.querySelector<HTMLElement>('[data-transcript-visual]');
      if (!turn) return;

      if (!wheelIsActive) {
        turn.style.setProperty('--wheel-opacity', '1');
        turn.style.setProperty('--wheel-angle', '0deg');
        turn.style.setProperty('--wheel-y', '0px');
        turn.style.setProperty('--wheel-z', '0px');
        turn.style.setProperty('--wheel-blur', '0px');
        turn.style.setProperty('--wheel-brightness', '1');
        return;
      }

      const bounds = slot.getBoundingClientRect();
      const turnCenter = bounds.top + bounds.height / 2;
      const linearOffset = turnCenter - viewportCenter;
      const rawPosition = linearOffset / wheelHalfHeight;
      const normalizedPosition = Math.max(-1, Math.min(1, rawPosition));

      if (Math.abs(rawPosition) > 1) {
        turn.style.setProperty('--wheel-opacity', '0');
        turn.style.setProperty('--wheel-angle', '0deg');
        turn.style.setProperty('--wheel-y', '0px');
        turn.style.setProperty('--wheel-z', '0px');
        turn.style.setProperty('--wheel-blur', '0px');
        turn.style.setProperty('--wheel-brightness', '1');
        return;
      }

      const absolutePosition = Math.abs(normalizedPosition);
      const angleRadians = normalizedPosition * maximumAngleRadians;
      const desiredOffset = Math.sin(angleRadians) * cylinderRadius;
      const cylinderShift = desiredOffset - linearOffset;
      const depth = cylinderRadius * (Math.cos(angleRadians) - 1);
      const edgeProgress = Math.max(0, Math.min(1, (absolutePosition - 0.34) / 0.66));
      const centerEdgeAmount = Math.pow(edgeProgress, 1.45);
      const distanceFromNearestEdge = Math.max(
        0,
        Math.min(turnCenter - viewport.top, viewport.bottom - turnCenter)
      );
      const edgeApproach = Math.max(
        0,
        Math.min(1, (bounds.height / 2 + edgeFadeZone - distanceFromNearestEdge) / edgeFadeZone)
      );
      const edgeAmount = Math.max(centerEdgeAmount, edgeApproach * edgeProgress * 0.82);

      turn.style.setProperty('--wheel-opacity', String(1 - edgeAmount * 0.96));
      turn.style.setProperty('--wheel-angle', `${normalizedPosition * -maximumAngleDegrees}deg`);
      turn.style.setProperty('--wheel-y', `${cylinderShift}px`);
      turn.style.setProperty('--wheel-z', `${depth}px`);
      turn.style.setProperty('--wheel-blur', `${Math.pow(edgeAmount, 1.55) * 5.5}px`);
      turn.style.setProperty('--wheel-brightness', String(1 - edgeAmount * 0.14));
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
                    <p className={`leading-snug tracking-tight ${isLatest ? 'text-base sm:text-xl' : 'text-sm sm:text-base'}`}>
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
