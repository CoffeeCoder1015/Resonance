const TARGET_SAMPLE_RATE = 16_000;
const BUFFER_SIZE = 4_096;
const DEFAULT_MAX_DURATION_SECONDS = 60;

interface WavRecorderOptions {
  maxDurationSeconds?: number;
  onMaxDuration?: () => void;
}

function mergeSamples(chunks: Float32Array[], sampleCount: number): Float32Array {
  const merged = new Float32Array(sampleCount);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

function resample(samples: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === TARGET_SAMPLE_RATE) return samples;

  const ratio = sourceRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.round(samples.length / ratio));
  const output = new Float32Array(outputLength);

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const start = Math.floor(outputIndex * ratio);
    const end = Math.min(samples.length, Math.floor((outputIndex + 1) * ratio));
    let sum = 0;

    for (let inputIndex = start; inputIndex < end; inputIndex += 1) {
      sum += samples[inputIndex];
    }

    output[outputIndex] = sum / Math.max(1, end - start);
  }

  return output;
}

function encodeWav(samples: Float32Array): Blob {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export class WavRecorder {
  private chunks: Float32Array[] = [];
  private sampleCount = 0;
  private processor: ScriptProcessorNode | null = null;
  private silentOutput: GainNode | null = null;
  private readonly maxSampleCount: number;
  private readonly onMaxDuration?: () => void;
  private maxDurationSignalled = false;

  constructor(
    private readonly context: AudioContext,
    private readonly source: MediaStreamAudioSourceNode,
    {
      maxDurationSeconds = DEFAULT_MAX_DURATION_SECONDS,
      onMaxDuration
    }: WavRecorderOptions = {}
  ) {
    this.maxSampleCount = Math.max(1, Math.floor(context.sampleRate * maxDurationSeconds));
    this.onMaxDuration = onMaxDuration;
  }

  start() {
    if (this.processor) throw new Error('Recording is already active.');

    const processor = this.context.createScriptProcessor(BUFFER_SIZE, 1, 1);
    const silentOutput = this.context.createGain();
    silentOutput.gain.value = 0;

    processor.onaudioprocess = event => {
      const input = event.inputBuffer.getChannelData(0);
      const remainingSamples = this.maxSampleCount - this.sampleCount;

      if (remainingSamples > 0) {
        const samples = input.slice(0, remainingSamples);
        this.chunks.push(samples);
        this.sampleCount += samples.length;
      }

      if (this.sampleCount >= this.maxSampleCount && !this.maxDurationSignalled) {
        this.maxDurationSignalled = true;
        queueMicrotask(() => this.onMaxDuration?.());
      }
    };

    this.source.connect(processor);
    processor.connect(silentOutput);
    silentOutput.connect(this.context.destination);
    this.processor = processor;
    this.silentOutput = silentOutput;
  }

  stop(): Blob {
    this.disconnect();
    if (this.sampleCount === 0) throw new Error('No microphone audio was recorded.');

    const samples = mergeSamples(this.chunks, this.sampleCount);
    const wav = encodeWav(resample(samples, this.context.sampleRate));
    this.chunks = [];
    this.sampleCount = 0;
    this.maxDurationSignalled = false;
    return wav;
  }

  cancel() {
    this.disconnect();
    this.chunks = [];
    this.sampleCount = 0;
    this.maxDurationSignalled = false;
  }

  private disconnect() {
    if (this.processor) {
      this.processor.onaudioprocess = null;
      this.source.disconnect(this.processor);
      this.processor.disconnect();
      this.processor = null;
    }
    this.silentOutput?.disconnect();
    this.silentOutput = null;
  }
}
