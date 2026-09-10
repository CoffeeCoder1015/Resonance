import { memo, useState } from 'react';
import { AvatarCanvas } from '../AvatarCanvas';
import { cn } from '../../utils/cn';
import { DESIGN_VARIANTS, type VoiceState, type VisualTheme } from '../../types/voice';
import { PillWaveform } from './PillWaveform';
import { formatPillElapsed, getPillPresentation, type PillStatus } from './pillPresentation';
import './pill.css';

export interface TranscriptionPillProps {
  status: PillStatus;
  elapsedSeconds?: number;
  visualTheme: VisualTheme;
  voiceState?: VoiceState;
  volume?: number;
  frequencies?: Uint8Array;
  microphoneLevel?: number;
  hovered?: boolean;
  scale?: number;
  themeHintVisible?: boolean;
  themeHintText?: string;
  onPrimaryAction: () => void;
  onExpand?: () => void;
}

const EMPTY_FREQUENCIES = new Uint8Array(32);
const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const EASE_OUT = 'cubic-bezier(0.4, 0, 0.2, 1)';

function MicrophoneIcon() {
  return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7" /></svg>;
}

function PrimaryIcon({ status }: { status: PillStatus }) {
  if (status === 'recording') return <span className="block h-3.5 w-3.5 bg-black" />;
  if (status === 'processing') return <svg viewBox="0 0 24 24" className="h-5 w-5 animate-spin" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3.5" opacity="0.2" /><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" /></svg>;
  if (status === 'error') return <span aria-hidden="true">!</span>;
  return <MicrophoneIcon />;
}

export const TranscriptionPill = memo(function TranscriptionPill({ status, elapsedSeconds = 0, visualTheme, voiceState, volume = 0, frequencies = EMPTY_FREQUENCIES, microphoneLevel = 0, hovered, scale = .65, themeHintVisible = false, themeHintText = 'Tap the orb to switch themes', onPrimaryAction, onExpand }: TranscriptionPillProps) {
  const [focused, setFocused] = useState(false);
  const isHovered = hovered ?? focused;
  const isCompact = status === 'idle' && !isHovered;
  const presentation = getPillPresentation(status);
  const avatarTheme = DESIGN_VARIANTS.find(variant => variant.id === visualTheme) ?? DESIGN_VARIANTS[0];
  const resolvedVoiceState = voiceState ?? (status === 'recording' ? 'listening' : status === 'processing' ? 'processing' : 'idle');
  const actionLabel = status === 'recording' ? 'Stop recording' : 'Start recording';
  const showStatusBadge = status !== 'idle' && status !== 'recording';

  return (
    <section className="transcription-pill-shell pill-animate-stomp relative" aria-label="Resonance transcription controls" onPointerEnter={() => hovered === undefined && setFocused(true)} onPointerLeave={() => hovered === undefined && setFocused(false)} onFocusCapture={() => hovered === undefined && setFocused(true)} onBlurCapture={event => { if (hovered === undefined && !event.currentTarget.contains(event.relatedTarget)) setFocused(false); }} style={{ scale }}>
      <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden="true"><filter id="goo-brutal"><feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" /><feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9" result="goo" /><feComposite in="SourceGraphic" in2="goo" operator="atop" /></filter></svg>
      <div className={cn('theme-hint-layer', !themeHintVisible && 'theme-hint-layer--hidden')} aria-hidden={!themeHintVisible}>
        <div className="theme-hint-popup" style={{ backgroundColor: avatarTheme.accentHex, color: avatarTheme.accentForegroundHex }}>{themeHintText}</div>
      </div>
      <div className={cn('theme-shine-overlay', !themeHintVisible && 'theme-shine-overlay--hidden')} style={{ '--shine-color': avatarTheme.accentHex } as React.CSSProperties} aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => <span key={index} className="theme-shine-ray theme-shine-ray--outward" style={{ '--ray-angle': `${index * 45}deg` } as React.CSSProperties} />)}
      </div>
      <div className="relative flex items-center justify-center" style={{ filter: isCompact ? 'none' : 'url(#goo-brutal) drop-shadow(8px 8px 0 #000)', transition: `filter 180ms ${SPRING}` }}>
        <div className={cn('pill-no-drag isolate absolute inset-y-0 left-0 z-20 aspect-square rounded-full border-[3px] border-black transition-all duration-200', isCompact ? 'translate-x-4 scale-50 opacity-0' : '-translate-x-[calc(100%+16px)] scale-100 opacity-100')} style={{ backgroundColor: avatarTheme.bgHex, transitionProperty: 'transform, opacity, background-color', transitionDuration: '180ms', transitionTimingFunction: isCompact ? EASE_OUT : SPRING }}>
          <div className="absolute inset-0 z-[1] rounded-full" style={{ backgroundColor: avatarTheme.bgHex }} aria-hidden="true" />
          <div className="absolute inset-0 z-10 overflow-hidden rounded-full">
            <div className="absolute -inset-2"><AvatarCanvas state={resolvedVoiceState} visualTheme={visualTheme} volume={volume} frequencies={frequencies} onAvatarClick={onExpand ?? onPrimaryAction} active={!isCompact} powerPreference="default" maxFrameRate={60} /></div>
          </div>
        </div>
        <div className={cn('relative z-10 flex select-none items-center rounded-full', isCompact ? 'gap-0 border-[3px] border-black bg-white p-1.5 opacity-[0.45]' : 'gap-3 border-[3px] border-black bg-white py-1.5 pl-1.5 pr-3 opacity-100')} style={{ transitionProperty: 'opacity, padding, gap, box-shadow', transitionDuration: '180ms', transitionTimingFunction: isCompact ? EASE_OUT : SPRING, boxShadow: 'none' }}>
          <button type="button" onClick={onPrimaryAction} aria-label={actionLabel} disabled={status === 'processing'} className={cn('relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[3px] border-black text-black transition-all duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-black/20 disabled:cursor-wait', isCompact ? 'shadow-none' : 'shadow-[3px_3px_0_0_#000] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0_0_#000] active:translate-x-1 active:translate-y-1 active:shadow-none')} style={{ backgroundColor: presentation.accent }}><PrimaryIcon status={status} /></button>
          <div className={cn('overflow-hidden transition-all duration-200', isCompact ? 'w-0 opacity-0' : 'w-16 opacity-100')}><PillWaveform status={status} microphoneLevel={microphoneLevel} active={!isCompact} /></div>
          <div className="flex shrink-0 items-center justify-center gap-2" aria-live="polite">
            {showStatusBadge ? <span className="flex shrink-0 items-center gap-2 rounded-full border-2 border-black px-2 py-[2px] transition-all duration-200" style={{ backgroundColor: presentation.accent }}><span className={cn('h-2.5 w-2.5 shrink-0 border-2 border-black bg-black', presentation.animated ? 'pill-animate-blink' : '')} /><span className="whitespace-nowrap text-[10px] font-extrabold uppercase tracking-wider text-black transition-all duration-200">{presentation.label}</span></span> : null}
            {status === 'recording' && !isCompact ? <span className="font-mono text-xs font-semibold tabular-nums text-black">{formatPillElapsed(elapsedSeconds)}</span> : null}
          </div>
        </div>
      </div>
    </section>
  );
});
