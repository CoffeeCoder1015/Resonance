import type { VoiceState, VoicePhase } from '../types/voice';

export function voicePhaseToVoiceState(phase: VoicePhase): VoiceState {
  switch (phase) {
    case 'listening':
      return 'listening';
    case 'transcribing':
    case 'responding':
      return 'processing';
    case 'acquiring-microphone':
    case 'idle':
      return 'idle';
  }
}
