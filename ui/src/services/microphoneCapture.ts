import { MicVAD } from '@ricky0123/vad-web';
import type { VoiceInputMode } from '../types/voice';
import { SpeechSegmentBuffer } from './speechSegmentBuffer';

const VAD_ASSET_PATH = '/vad/';

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

export class MicrophoneCapture {
  private readonly segments = new SpeechSegmentBuffer();
  private mode: VoiceInputMode = 'tap';
  private onUtterance: () => void = () => undefined;
  private disposed = false;
  private finishing = false;
  private readyNotified = false;

  private constructor(
    private readonly stream: MediaStream,
    private readonly context: AudioContext,
    private readonly microphone: MediaStreamAudioSourceNode,
    readonly analyser: AnalyserNode,
    private readonly vad: MicVAD
  ) {}

  static async open(signal?: AbortSignal): Promise<MicrophoneCapture> {
    if (signal?.aborted) {
      throw new DOMException('Microphone acquisition was cancelled.', 'AbortError');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        autoGainControl: true,
        noiseSuppression: true
      },
      video: false
    });
    if (signal?.aborted) {
      stream.getTracks().forEach(track => track.stop());
      throw new DOMException('Microphone acquisition was cancelled.', 'AbortError');
    }

    let context: AudioContext | null = null;
    let microphone: MediaStreamAudioSourceNode | null = null;
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

      microphone = context.createMediaStreamSource(stream);
      microphone.connect(analyser);

      vad = await MicVAD.new({
        model: 'v5',
        startOnLoad: true,
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
        getStream: async () => stream,
        pauseStream: async () => undefined,
        resumeStream: async () => stream,
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

      capture = new MicrophoneCapture(stream, context, microphone, analyser, vad);
      return capture;
    } catch (error) {
      if (vad) await vad.destroy().catch(() => undefined);
      microphone?.disconnect();
      stream.getTracks().forEach(track => track.stop());
      if (context) closeAudioContext(context);
      throw error;
    }
  }

  async start({ mode, onUtterance }: StartCaptureOptions) {
    this.assertActive();
    if (!this.stream.getAudioTracks().some(track => track.readyState === 'live')) {
      throw new Error('The microphone stream is no longer available.');
    }
    this.mode = mode;
    this.onUtterance = onUtterance;
    this.finishing = false;
    this.readyNotified = false;

    this.setStreamEnabled(true);
    if (this.context.state === 'suspended') await this.context.resume();
    if (!this.vad.listening) await this.vad.start();
    this.assertActive();
  }

  async finish(): Promise<Blob | null> {
    this.assertActive();
    this.finishing = true;

    try {
      if (this.vad.listening) await this.vad.pause();
      return this.segments.drainWav();
    } finally {
      this.setStreamEnabled(false);
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
      this.setStreamEnabled(false);
      this.finishing = false;
    }
  }

  async resume() {
    this.assertActive();
    this.segments.clear();
    this.readyNotified = false;
    this.finishing = false;
    this.setStreamEnabled(true);
    if (this.context.state === 'suspended') await this.context.resume();
    if (!this.vad.listening) await this.vad.start();
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stream.getTracks().forEach(track => track.stop());
    await this.vad.destroy().catch(() => undefined);
    this.microphone.disconnect();
    this.segments.clear();
    closeAudioContext(this.context);
  }

  private handleSpeechEnd(audio: Float32Array) {
    if (this.disposed) return;
    this.segments.append(audio);

    if (
      !this.finishing &&
      !this.readyNotified &&
      (this.mode === 'tap' || this.mode === 'agent')
    ) {
      this.readyNotified = true;
      queueMicrotask(this.onUtterance);
    }
  }

  private setStreamEnabled(enabled: boolean) {
    this.stream.getAudioTracks().forEach(track => {
      track.enabled = enabled;
    });
  }

  private assertActive() {
    if (this.disposed) throw new Error('Microphone capture is closed.');
  }
}
