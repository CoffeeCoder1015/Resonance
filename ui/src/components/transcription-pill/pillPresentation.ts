import type { VoicePhase } from '../../types/voice';

export type PillStatus =
  | 'idle'
  | 'recording'
  | 'processing'
  | 'error';

export interface PillPresentation {
  status: PillStatus;
  label: string;
  accent: string;
  animated: boolean;
}

const PRESENTATIONS: Record<PillStatus, PillPresentation> = {
  idle: {
    status: 'idle',
    label: 'Ready',
    accent: '#C7C7CC',
    animated: false
  },
  recording: {
    status: 'recording',
    label: 'Listening',
    accent: '#FF3D7F',
    animated: true
  },
  processing: {
    status: 'processing',
    label: 'Processing',
    accent: '#7C5CFF',
    animated: true
  },
  error: {
    status: 'error',
    label: 'Error',
    accent: '#FF453A',
    animated: false
  }
};

export function getPillPresentation(status: PillStatus): PillPresentation {
  return PRESENTATIONS[status];
}

export function voicePhaseToPillStatus(phase: VoicePhase): PillStatus {
  switch (phase) {
    case 'acquiring-microphone':
    case 'listening':
      return 'recording';
    case 'transcribing':
    case 'responding':
      return 'processing';
    case 'idle':
    case 'speaking':
      return 'idle';
  }
}

export function formatPillElapsed(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
