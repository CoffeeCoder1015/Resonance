import { encodePcm16Wav, VAD_SAMPLE_RATE } from './audioEncoding.ts';

const DEFAULT_CHUNK_SECONDS = 60;

interface SpeechSegmentBufferOptions {
  chunkSeconds?: number;
}

export class SpeechSegmentBuffer {
  private readonly segments: Float32Array[] = [];
  private readonly chunkSamples: number;
  private speechSamples = 0;

  constructor({
    chunkSeconds = DEFAULT_CHUNK_SECONDS
  }: SpeechSegmentBufferOptions = {}) {
    this.chunkSamples = Math.max(1, Math.round(chunkSeconds * VAD_SAMPLE_RATE));
  }

  get hasSpeech() {
    return this.speechSamples > 0;
  }

  append(segment: Float32Array) {
    if (segment.length === 0) return;

    const retained = segment.slice();
    this.segments.push(retained);
    this.speechSamples += retained.length;
  }

  drainWavChunks(): Blob[] {
    if (!this.hasSpeech) return [];

    const chunks: Blob[] = [];
    let parts: Float32Array[] = [];
    let partSamples = 0;

    const flush = () => {
      if (partSamples === 0) return;
      const output = new Float32Array(partSamples);
      let offset = 0;
      for (const part of parts) {
        output.set(part, offset);
        offset += part.length;
      }
      chunks.push(encodePcm16Wav(output));
      parts = [];
      partSamples = 0;
    };

    const appendSamples = (samples: Float32Array) => {
      let offset = 0;
      while (offset < samples.length) {
        const length = Math.min(
          samples.length - offset,
          this.chunkSamples - partSamples
        );
        parts.push(samples.subarray(offset, offset + length));
        partSamples += length;
        offset += length;
        if (partSamples === this.chunkSamples) flush();
      }
    };

    this.segments.forEach(segment => {
      if (
        partSamples > 0 &&
        partSamples + segment.length > this.chunkSamples
      ) {
        flush();
      }
      appendSamples(segment);
    });
    flush();

    this.clear();
    return chunks;
  }

  clear() {
    this.segments.length = 0;
    this.speechSamples = 0;
  }
}
