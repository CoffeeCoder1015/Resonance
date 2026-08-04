import { encodePcm16Wav } from './audioEncoding.ts';

export class SpeechSegmentBuffer {
  private readonly segments: Float32Array[] = [];
  private speechSamples = 0;

  get hasSpeech() {
    return this.speechSamples > 0;
  }

  append(segment: Float32Array) {
    if (segment.length === 0) return;

    const retained = segment.slice();
    this.segments.push(retained);
    this.speechSamples += retained.length;
  }

  drainWav(): Blob | null {
    if (!this.hasSpeech) return null;
    const output = new Float32Array(this.speechSamples);
    let offset = 0;
    for (const segment of this.segments) {
      output.set(segment, offset);
      offset += segment.length;
    }
    this.clear();
    return encodePcm16Wav(output);
  }

  clear() {
    this.segments.length = 0;
    this.speechSamples = 0;
  }
}
