import { useEffect, useState } from 'react';
import type { AgentState } from '../types/voice';

const SIGNAL_UPDATE_INTERVAL_MS = 50;
const IDLE_VOLUME = 0.05;
const FREQUENCY_BIN_COUNT = 64;

function createIdleFrequencies() {
  return new Uint8Array(FREQUENCY_BIN_COUNT).fill(12);
}

function createSpeakingSignal() {
  const time = Date.now() / 130;
  const frequencies = new Uint8Array(FREQUENCY_BIN_COUNT);
  let sum = 0;

  for (let index = 0; index < frequencies.length; index += 1) {
    const value = Math.floor(
      (Math.sin(time * 1.7 + index * 0.28) * 0.45 +
        Math.cos(time * 0.9 - index * 0.38) * 0.45 +
        0.5) *
        235 *
        (Math.random() * 0.2 + 0.8)
    );
    frequencies[index] = Math.max(15, Math.min(255, value));
    sum += frequencies[index];
  }

  return {
    volume: Math.min(1, (sum / frequencies.length / 255) * 1.95),
    frequencies
  };
}

function createProcessingSignal() {
  const time = Date.now() / 65;
  const frequencies = new Uint8Array(FREQUENCY_BIN_COUNT);
  for (let index = 0; index < frequencies.length; index += 1) {
    frequencies[index] = Math.floor((Math.sin(time + index * 0.25) + 1) * 80);
  }
  return { volume: 0.38, frequencies };
}

export function useAudioVisualization(state: AgentState, analyser: AnalyserNode | null) {
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
        state === 'speaking'
          ? createSpeakingSignal()
          : state === 'processing'
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
