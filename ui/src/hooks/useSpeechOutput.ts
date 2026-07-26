import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeakOptions {
  onComplete?: () => void;
}

function selectPreferredVoice() {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find(
      voice =>
        voice.lang.startsWith('en') &&
        ['Natural', 'Samantha', 'Google', 'Karen'].some(name => voice.name.includes(name))
    ) ?? voices[0]
  );
}

export function useSpeechOutput() {
  const [enabled, setEnabled] = useState(true);
  const enabledRef = useRef(true);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const cancel = useCallback(() => {
    const utterance = utteranceRef.current;
    utteranceRef.current = null;
    if (utterance) {
      utterance.onend = null;
      utterance.onerror = null;
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  const canSpeak = useCallback(
    () => enabledRef.current && 'speechSynthesis' in window,
    []
  );

  const speak = useCallback(
    (text: string, { onComplete }: SpeakOptions = {}) => {
      if (!canSpeak()) return false;

      cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.02;
      utterance.pitch = 1.04;

      const preferredVoice = selectPreferredVoice();
      if (preferredVoice) utterance.voice = preferredVoice;

      const complete = () => {
        if (utteranceRef.current !== utterance) return;
        utteranceRef.current = null;
        onComplete?.();
      };
      utterance.onend = complete;
      utterance.onerror = complete;
      utteranceRef.current = utterance;

      try {
        window.speechSynthesis.speak(utterance);
        return true;
      } catch {
        utteranceRef.current = null;
        utterance.onend = null;
        utterance.onerror = null;
        return false;
      }
    },
    [canSpeak, cancel]
  );

  const toggle = useCallback(() => {
    const nextEnabled = !enabledRef.current;
    enabledRef.current = nextEnabled;
    setEnabled(nextEnabled);
    if (!nextEnabled) cancel();
    return nextEnabled;
  }, [cancel]);

  useEffect(() => cancel, [cancel]);

  return {
    enabled,
    canSpeak,
    speak,
    cancel,
    toggle
  };
}
