import { useEffect, useState } from 'react';
import type { VoiceState } from '../types/voice';

const SIGNAL_UPDATE_INTERVAL_MS = 50;
const IDLE_VOLUME = 0.05;
const FREQUENCY_BIN_COUNT = 64;

function createIdleFrequencies() {
  return new Uint8Array(FREQUENCY_BIN_COUNT).fill(12);
}

function createProcessingSignal() {
  const time = Date.now() / 65;
  const frequencies = new Uint8Array(FREQUENCY_BIN_COUNT);
  for (let index = 0; index < frequencies.length; index += 1) {
    frequencies[index] = Math.floor((Math.sin(time + index * 0.25) + 1) * 80);
  }
  return { volume: 0.38, frequencies };
}

export function useAudioVisualization(state: VoiceState, analyser: AnalyserNode | null) {
  const [currentSpeechVolume, setCurrentSpeechVolume] = useState(IDLE_VOLUME);
  const [audioFrequencies, setAudioFrequencies] = useState<Uint8Array>(createIdleFrequencies);

  useEffect(() => {
    if (state === 'idle') {
      setCurrentSpeechVolume(IDLE_VOLUME);
      setAudioFrequencies(createIdleFrequencies());
      return;
    }

    const updateSignal = () => {
      if (state === 'listening' && analyser) {
        const frequencies = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(frequencies);
        const average =
          frequencies.reduce((sum, value) => sum + value, 0) / (frequencies.length || 1);
        setCurrentSpeechVolume(Math.min(1, (average / 128) * 1.6));
        setAudioFrequencies(frequencies);
        return;
      }

      const signal =
        state === 'processing'
            ? createProcessingSignal()
            : { volume: IDLE_VOLUME, frequencies: createIdleFrequencies() };
      setCurrentSpeechVolume(signal.volume);
      setAudioFrequencies(signal.frequencies);
    };

    updateSignal();
    const intervalId = window.setInterval(updateSignal, SIGNAL_UPDATE_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [analyser, state]);

  return {
    currentSpeechVolume,
    audioFrequencies
  };
}
