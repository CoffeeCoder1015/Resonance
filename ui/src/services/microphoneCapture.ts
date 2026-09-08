import { MicVAD } from '@ricky0123/vad-web';
import type { VoiceInputMode } from '../types/voice';
import { SpeechSegmentBuffer } from './speechSegmentBuffer';

const VAD_ASSET_PATH = '/vad/';
const MICROPHONE_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    channelCount: 1,
    echoCancellation: true,
    autoGainControl: true,
    noiseSuppression: true
  },
  video: false
};

interface VoiceWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

interface StartCaptureOptions {
  mode: VoiceInputMode;
  onUtterance: () => void;
}

function closeAudioContext(context: AudioContext) {
  if (context.state !== 'closed') {
    void context.close().catch(() => undefined);
  }
}

async function suspendAudioContext(context: AudioContext) {
  if (context.state === 'running') {
    await context.suspend().catch(() => undefined);
  }
}

async function destroyVad(vad: MicVAD) {
  try {
    await vad.destroy();
  } catch {
    // MicVAD.destroy() assumes start() has initialized its audio nodes. A
    // prewarmed model may never have started, so release that model directly.
    const warmVad = vad as unknown as {
      model?: { release: () => Promise<void> };
    };
    await warmVad.model?.release().catch(() => undefined);
  }
}

export class MicrophoneCapture {
  private readonly segments = new SpeechSegmentBuffer();
  private mode: VoiceInputMode = 'tap';
  private onUtterance: () => void = () => undefined;
  private disposed = false;
  private finishing = false;
  private readyNotified = false;
  private stream: MediaStream | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;

  private constructor(
    private readonly context: AudioContext,
    readonly analyser: AnalyserNode,
    private readonly vad: MicVAD
  ) {}

  static async open(signal?: AbortSignal): Promise<MicrophoneCapture> {
    if (signal?.aborted) {
      throw new DOMException('Microphone acquisition was cancelled.', 'AbortError');
    }

    let context: AudioContext | null = null;
    let vad: MicVAD | null = null;
    let capture: MicrophoneCapture | null = null;

    try {
      const voiceWindow = window as VoiceWindow;
      const AudioContextConstructor = window.AudioContext ?? voiceWindow.webkitAudioContext;
      if (!AudioContextConstructor) throw new Error('Web Audio is unavailable.');

      context = new AudioContextConstructor();
      const analyser = context.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.75;

      vad = await MicVAD.new({
        model: 'v5',
        // Load the ONNX model now, but do not acquire the physical microphone
        // until the user begins dictating.
        startOnLoad: false,
        processorType: 'auto',
        audioContext: context,
        baseAssetPath: VAD_ASSET_PATH,
        onnxWASMBasePath: VAD_ASSET_PATH,
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.35,
        redemptionMs: 1_200,
        preSpeechPadMs: 300,
        minSpeechMs: 250,
        submitUserSpeechOnPause: true,
        getStream: async () => {
          if (!capture) throw new Error('Microphone capture is not ready.');
          return capture.acquireStream();
        },
        pauseStream: async stream => {
          capture?.releaseStream(stream);
        },
        resumeStream: async () => {
          if (!capture) throw new Error('Microphone capture is not ready.');
          return capture.acquireStream();
        },
        ortConfig: ort => {
          ort.env.wasm.numThreads = 1;
          ort.env.wasm.proxy = false;
          ort.env.logLevel = 'error';
        },
        onSpeechEnd: audio => capture?.handleSpeechEnd(audio)
      });

      if (signal?.aborted) {
        throw new DOMException('Microphone acquisition was cancelled.', 'AbortError');
      }

      capture = new MicrophoneCapture(context, analyser, vad);
      await suspendAudioContext(context);
      return capture;
    } catch (error) {
      if (vad) await destroyVad(vad);
      if (context) closeAudioContext(context);
      throw error;
    }
  }

  async start({ mode, onUtterance }: StartCaptureOptions) {
    this.assertActive();
    this.mode = mode;
    this.onUtterance = onUtterance;
    this.finishing = false;
    this.readyNotified = false;

    try {
      if (!this.vad.listening) await this.vad.start();
      if (this.context.state === 'suspended') await this.context.resume();
      this.assertActive();
    } catch (error) {
      this.releaseStream();
      await suspendAudioContext(this.context);
      throw error;
    }
  }

  async finish(): Promise<Blob | null> {
    this.assertActive();
    this.finishing = true;

    try {
      if (this.vad.listening) await this.vad.pause();
      return this.segments.drainWav();
    } finally {
      this.releaseStream();
      await suspendAudioContext(this.context);
      this.finishing = false;
    }
  }

  async discardAndPause() {
    if (this.disposed) return;
    this.finishing = true;
    try {
      if (this.vad.listening) await this.vad.pause();
      this.segments.clear();
    } finally {
      this.releaseStream();
      await suspendAudioContext(this.context);
      this.finishing = false;
    }
  }

  async resume() {
    this.assertActive();
    this.segments.clear();
    this.readyNotified = false;
    this.finishing = false;
    try {
      if (!this.vad.listening) await this.vad.start();
      if (this.context.state === 'suspended') await this.context.resume();
    } catch (error) {
      this.releaseStream();
      await suspendAudioContext(this.context);
      throw error;
    }
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseStream();
    await destroyVad(this.vad);
    this.segments.clear();
    closeAudioContext(this.context);
  }

  private handleSpeechEnd(audio: Float32Array) {
    if (this.disposed) return;
    this.segments.append(audio);

    if (
      !this.finishing &&
      !this.readyNotified &&
      this.mode === 'tap'
    ) {
      this.readyNotified = true;
      queueMicrotask(this.onUtterance);
    }
  }

  private async acquireStream() {
    this.assertActive();
    this.releaseStream();
    const stream = await navigator.mediaDevices.getUserMedia(MICROPHONE_CONSTRAINTS);
    if (this.disposed) {
      stream.getTracks().forEach(track => track.stop());
      throw new DOMException('Microphone acquisition was cancelled.', 'AbortError');
    }

    this.stream = stream;
    this.microphone = this.context.createMediaStreamSource(stream);
    this.microphone.connect(this.analyser);
    return stream;
  }

  private releaseStream(stream = this.stream) {
    if (!stream) return;
    stream.getTracks().forEach(track => track.stop());
    if (this.stream !== stream) return;
    this.microphone?.disconnect();
    this.microphone = null;
    this.stream = null;
  }

  private assertActive() {
    if (this.disposed) throw new Error('Microphone capture is closed.');
  }
}
