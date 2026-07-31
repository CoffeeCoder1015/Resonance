export type PillStatus =
  | 'idle'
  | 'recording'
  | 'processing'
  | 'error';

export interface RuntimeSnapshot {
  visualTheme:
    | 'clay-blob'
    | 'toy-collider'
    | 'memphis-bloom'
    | 'comic-burst'
    | 'superflat-bloom'
    | 'voxel-pulse';
}

export type InsertTextResult =
  | { status: 'inserted' }
  | { status: 'failed'; reason: string };

export type BeginTextInsertionResult =
  | { status: 'ready'; sessionId: string }
  | { status: 'unavailable'; reason: string };

export type RuntimeCommand =
  | 'toggle-transcription'
  | 'begin-transcription'
  | 'end-transcription'
  | 'begin-hold-to-talk'
  | 'end-hold-to-talk'
  | 'show-expanded';

export const CHANNELS = {
  getSnapshot: 'runtime:get-snapshot',
  publishSnapshot: 'runtime:publish-snapshot',
  snapshot: 'runtime:snapshot',
  command: 'runtime:command',
  pillHover: 'pill:hover',
  pillStatus: 'pill:status',
  beginTextInsertion: 'insertion:begin',
  insertTextAtCaret: 'insertion:insert-at-caret'
} as const;

export const DEFAULT_SNAPSHOT: RuntimeSnapshot = {
  visualTheme: 'clay-blob'
};
