import { encodePcm16Wav, VAD_SAMPLE_RATE } from './audioEncoding.ts';

const DEFAULT_GAP_MS = 160;
const DEFAULT_MAX_SPEECH_SECONDS = 60;

interface SpeechSegmentBufferOptions {
  gapMs?: number;
  maxSpeechSeconds?: number;
}

export class SpeechSegmentBuffer {
  private readonly segments: Float32Array[] = [];
  private readonly gapSamples: number;
  private readonly maxSpeechSamples: number;
  private speechSamples = 0;

  constructor({
    gapMs = DEFAULT_GAP_MS,
    maxSpeechSeconds = DEFAULT_MAX_SPEECH_SECONDS
  }: SpeechSegmentBufferOptions = {}) {
    this.gapSamples = Math.max(0, Math.round((gapMs / 1_000) * VAD_SAMPLE_RATE));
    this.maxSpeechSamples = Math.max(1, Math.round(maxSpeechSeconds * VAD_SAMPLE_RATE));
  }

  get hasSpeech() {
    return this.speechSamples > 0;
  }

  append(segment: Float32Array) {
    const remaining = this.maxSpeechSamples - this.speechSamples;
    if (remaining <= 0 || segment.length === 0) return;

    const accepted = segment.slice(0, remaining);
    this.segments.push(accepted);
    this.speechSamples += accepted.length;
  }

  drainWav(): Blob | null {
    if (!this.hasSpeech) return null;

    const gapCount = Math.max(0, this.segments.length - 1);
    const output = new Float32Array(this.speechSamples + gapCount * this.gapSamples);
    let offset = 0;

    for (const segment of this.segments) {
      output.set(segment, offset);
      offset += segment.length + this.gapSamples;
    }

    this.clear();
    return encodePcm16Wav(output);
  }

  clear() {
    this.segments.length = 0;
    this.speechSamples = 0;
  }
}
