import type { AgentState, VoicePhase } from '../types/voice';

export function voicePhaseToAgentState(phase: VoicePhase): AgentState {
  switch (phase) {
    case 'listening':
      return 'listening';
    case 'transcribing':
    case 'responding':
      return 'processing';
    case 'speaking':
      return 'speaking';
    case 'acquiring-microphone':
    case 'idle':
      return 'idle';
  }
}
