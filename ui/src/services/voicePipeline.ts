import {
  createTextTurn,
  createVoiceTurn,
  transcribeAudio,
  type PipelineMode,
  type Turn
} from './backend';
import { MicrophoneCapture } from './microphoneCapture';

type CaptureStartOptions = Parameters<MicrophoneCapture['start']>[0];

export class VoicePipeline {
  private captureValue: MicrophoneCapture | null = null;
  private opening: Promise<MicrophoneCapture> | null = null;
  private openingAbort: AbortController | null = null;
  private disposed = false;

  get analyser() {
    return this.captureValue?.analyser ?? null;
  }

  get activeCapture() {
    return this.captureValue;
  }

  owns(capture: MicrophoneCapture) {
    return this.captureValue === capture;
  }

  async ensureCapture() {
    this.assertActive();
    if (this.captureValue) return this.captureValue;
    if (this.opening) return this.opening;

    const abortController = new AbortController();
    this.openingAbort = abortController;
    const opening = MicrophoneCapture.open(abortController.signal).then(async capture => {
      try {
        await capture.discardAndPause();
        if (this.disposed || abortController.signal.aborted) {
          throw new DOMException('Microphone acquisition was cancelled.', 'AbortError');
        }
        this.captureValue = capture;
        return capture;
      } catch (error) {
        await capture.dispose();
        throw error;
      }
    });
    this.opening = opening;

    try {
      return await opening;
    } finally {
      if (this.opening === opening) this.opening = null;
      if (this.openingAbort === abortController) this.openingAbort = null;
    }
  }

  async start(options: CaptureStartOptions) {
    const capture = await this.ensureCapture();
    await capture.start(options);
    return capture;
  }

  async finish(capture: MicrophoneCapture) {
    if (!this.owns(capture)) return null;
    return capture.finish();
  }

  async resume(capture: MicrophoneCapture) {
    if (!this.owns(capture)) return false;
    await capture.resume();
    return true;
  }

  async createTurn(
    audio: Blob | readonly Blob[],
    mode: PipelineMode,
    signal?: AbortSignal
  ): Promise<Turn> {
    this.assertActive();
    if (!Array.isArray(audio) || audio.length === 1) {
      return createVoiceTurn(Array.isArray(audio) ? audio[0] : audio, mode, signal);
    }

    const transcripts: string[] = [];
    for (const chunk of audio) {
      const transcript = (await transcribeAudio(chunk, signal)).trim();
      if (transcript) transcripts.push(transcript);
    }
    return createTextTurn(transcripts.join(' '), mode, signal);
  }

  async discardAndPause(capture = this.captureValue) {
    if (!capture || !this.owns(capture)) return;
    await capture.discardAndPause();
  }

  cancelPendingCapture() {
    this.openingAbort?.abort();
  }

  async pauseForHandoff() {
    this.openingAbort?.abort();
    const opening = this.opening;
    if (opening) await opening.catch(() => undefined);

    const capture = this.captureValue;
    if (capture) await capture.discardAndPause();
  }

  async disposeCapture(capture: MicrophoneCapture) {
    if (this.captureValue === capture) this.captureValue = null;
    await capture.dispose();
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.openingAbort?.abort();

    const opening = this.opening;
    if (opening) await opening.catch(() => undefined);

    const capture = this.captureValue;
    this.captureValue = null;
    if (capture) await capture.dispose();
  }

  private assertActive() {
    if (this.disposed) throw new Error('Voice pipeline has been disposed.');
  }
}
