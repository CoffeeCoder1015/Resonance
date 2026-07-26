import { WavRecorder } from './wavRecorder';

interface VoiceWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

interface StartCaptureOptions {
  onMaxDuration?: () => void;
}

function closeAudioContext(context: AudioContext) {
  if (context.state !== 'closed') {
    void context.close().catch(() => undefined);
  }
}

export class MicrophoneCapture {
  private recorder: WavRecorder | null = null;
  private disposed = false;

  private constructor(
    private readonly stream: MediaStream,
    private readonly context: AudioContext,
    private readonly microphone: MediaStreamAudioSourceNode,
    readonly analyser: AnalyserNode
  ) {}

  static async open(signal?: AbortSignal): Promise<MicrophoneCapture> {
    if (signal?.aborted) {
      throw new DOMException('Microphone acquisition was cancelled.', 'AbortError');
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    if (signal?.aborted) {
      stream.getTracks().forEach(track => track.stop());
      throw new DOMException('Microphone acquisition was cancelled.', 'AbortError');
    }

    let context: AudioContext | null = null;
    let microphone: MediaStreamAudioSourceNode | null = null;

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

      return new MicrophoneCapture(stream, context, microphone, analyser);
    } catch (error) {
      microphone?.disconnect();
      stream.getTracks().forEach(track => track.stop());
      if (context) closeAudioContext(context);
      throw error;
    }
  }

  async start({ onMaxDuration }: StartCaptureOptions = {}) {
    this.assertActive();
    if (this.recorder) throw new Error('Recording is already active.');
    if (this.context.state === 'suspended') await this.context.resume();
    this.assertActive();

    const recorder = new WavRecorder(this.context, this.microphone, { onMaxDuration });
    try {
      recorder.start();
      this.recorder = recorder;
    } catch (error) {
      recorder.cancel();
      throw error;
    }
  }

  stop(): Blob {
    this.assertActive();
    const recorder = this.recorder;
    if (!recorder) throw new Error('Recording is not active.');

    this.recorder = null;
    return recorder.stop();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    this.recorder?.cancel();
    this.recorder = null;
    this.microphone.disconnect();
    this.stream.getTracks().forEach(track => track.stop());
    closeAudioContext(this.context);
  }

  private assertActive() {
    if (this.disposed) throw new Error('Microphone capture is closed.');
  }
}
