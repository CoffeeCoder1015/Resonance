export type VoicePhase =
  | 'idle'
  | 'acquiring-microphone'
  | 'listening'
  | 'transcribing'
  | 'responding'
  | 'speaking';

export type PillStatus =
  | 'idle'
  | 'recording'
  | 'processing'
  | 'success'
  | 'error';

export interface RuntimeSnapshot {
  phase: VoicePhase;
  pillStatus: PillStatus;
  elapsedSeconds: number;
  visualTheme:
    | 'clay-blob'
    | 'toy-collider'
    | 'memphis-bloom'
    | 'comic-burst'
    | 'superflat-bloom'
    | 'voxel-pulse';
}

export interface AudioLevel {
  active: boolean;
  level: number;
}

export type RuntimeCommand =
  | 'toggle-recording'
  | 'begin-hold-to-talk'
  | 'end-hold-to-talk'
  | 'show-expanded';

export const CHANNELS = {
  getSnapshot: 'runtime:get-snapshot',
  publishSnapshot: 'runtime:publish-snapshot',
  snapshot: 'runtime:snapshot',
  audioLevel: 'runtime:audio-level',
  command: 'runtime:command',
  pillHover: 'pill:hover'
} as const;

export const DEFAULT_SNAPSHOT: RuntimeSnapshot = {
  phase: 'idle',
  pillStatus: 'idle',
  elapsedSeconds: 0,
  visualTheme: 'clay-blob'
};
