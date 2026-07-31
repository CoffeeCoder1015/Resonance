import { useEffect, useState } from 'react';
import {
  getASRProviderSettings,
  getAgentProviderSettings,
  getTranscriptionProviderSettings,
  selectASRProvider,
  selectAgentProvider,
  selectTranscriptionProvider,
  type ASRProviderOption,
  type ResponseProviderOption
} from '../services/backend';
import type { HotkeySettings, UpdateHotkeysResult } from '../types/desktop';
import { HotkeySettingsPanel } from './HotkeySettingsPanel';

interface ProviderSettingsPanelProps {
  section: 'transcription' | 'agent';
  hotkeys: HotkeySettings | null;
  onUpdateHotkeys: (settings: HotkeySettings) => Promise<UpdateHotkeysResult>;
}

export function ProviderSettingsPanel({
  section,
  hotkeys,
  onUpdateHotkeys
}: ProviderSettingsPanelProps) {
  const [responseProviderOptions, setResponseProviderOptions] = useState<
    ResponseProviderOption[]
  >([]);
  const [selectedResponseProvider, setSelectedResponseProvider] = useState('');
  const [asrProviderOptions, setASRProviderOptions] = useState<ASRProviderOption[]>([]);
  const [selectedASRProvider, setSelectedASRProvider] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    void Promise.all([
      section === 'agent'
        ? getAgentProviderSettings(abortController.signal)
        : getTranscriptionProviderSettings(abortController.signal),
      section === 'transcription'
        ? getASRProviderSettings(abortController.signal)
        : Promise.resolve(null)
    ])
      .then(([responseProviderSettings, asrSettings]) => {
        setResponseProviderOptions(responseProviderSettings.providers);
        setSelectedResponseProvider(responseProviderSettings.current);
        if (asrSettings) {
          setASRProviderOptions(asrSettings.providers);
          setSelectedASRProvider(asrSettings.current);
        }
      })
      .catch(error => {
        if (!abortController.signal.aborted) {
          setErrorMessage(error instanceof Error ? error.message : 'Pipeline settings unavailable.');
        }
      })
      .finally(() => {
        if (!abortController.signal.aborted) setLoading(false);
      });

    return () => abortController.abort();
  }, [section]);

  const handleResponseProviderChange = async (responseProvider: string) => {
    setSaving(true);
    setErrorMessage(null);
    try {
      setSelectedResponseProvider(
        await (section === 'agent'
          ? selectAgentProvider(responseProvider)
          : selectTranscriptionProvider(responseProvider))
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Response provider could not be changed.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleASRProviderChange = async (provider: string) => {
    setSaving(true);
    setErrorMessage(null);
    try {
      setSelectedASRProvider(await selectASRProvider(provider));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'ASR provider could not be changed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      id="provider-settings-panel"
      role="tabpanel"
      aria-labelledby={`${section}-settings-tab`}
      className="min-w-0 overflow-y-auto no-scrollbar p-4 sm:p-5"
    >
      <div className="mb-5">
        <p className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-black/45">
          {section === 'transcription' ? 'Speech pipeline' : 'Agent pipeline'}
        </p>
        <h3 className="text-lg font-black tracking-tight sm:text-xl">
          {section === 'transcription' ? 'Transcription' : 'Agent'}
        </h3>
        <p className="mt-0.5 text-xs font-semibold text-black/55 sm:text-sm">
          {section === 'transcription'
            ? 'Choose how captured audio becomes text.'
            : 'Choose how transcribed text is processed and answered.'}
        </p>
      </div>

      <div className="rounded-[1.5rem] border-[3px] border-black bg-[#e9d8fd] p-4 neo-shadow sm:p-5">
        <label htmlFor={`${section}-provider`} className="mb-2 block text-sm font-black">
          {section === 'agent' ? 'Response provider' : 'Transcription provider'}
        </label>
        <select
          id={`${section}-provider`}
          value={selectedResponseProvider}
          disabled={loading || saving || responseProviderOptions.length === 0}
          onChange={event => void handleResponseProviderChange(event.target.value)}
          className="w-full rounded-xl border-[3px] border-black bg-white px-4 py-3 text-sm font-black outline-none neo-shadow-sm focus:ring-4 focus:ring-[#007bff]/30 disabled:opacity-60"
        >
          {responseProviderOptions.length === 0 && (
            <option value="">
              {loading ? 'Loading providers...' : 'No providers available'}
            </option>
          )}
          {responseProviderOptions.map(provider => (
            <option key={provider.id} value={provider.id} disabled={!provider.available}>
              {provider.label}
              {provider.available ? '' : ' — unavailable'}
            </option>
          ))}
        </select>
        {section === 'transcription' && (
          <p className="mt-3 text-xs font-semibold leading-relaxed text-black/55">
            Refines recognized speech before it is inserted. Passthrough keeps the ASR text unchanged.
          </p>
        )}
      </div>

      {section === 'transcription' && (
      <>
      <div className="mt-4 rounded-[1.5rem] border-[3px] border-black bg-[#fff2a8] p-4 neo-shadow sm:p-5">
        <label htmlFor="asr-provider" className="mb-2 block text-sm font-black">
          Speech recognition
        </label>
        <select
          id="asr-provider"
          value={selectedASRProvider}
          disabled={loading || saving || asrProviderOptions.length === 0}
          onChange={event => void handleASRProviderChange(event.target.value)}
          className="w-full rounded-xl border-[3px] border-black bg-white px-4 py-3 text-sm font-black outline-none neo-shadow-sm focus:ring-4 focus:ring-[#007bff]/30 disabled:opacity-60"
        >
          {asrProviderOptions.length === 0 && (
            <option value="">
              {loading ? 'Loading ASR providers...' : 'No ASR providers available'}
            </option>
          )}
          {asrProviderOptions.map(provider => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
        <p className="mt-3 text-xs font-semibold leading-relaxed text-black/55">
          Changing this unloads the active speech model and loads the selected model.
        </p>
      </div>
      <HotkeySettingsPanel hotkeys={hotkeys} onUpdateHotkeys={onUpdateHotkeys} />
      </>
      )}

      <div className="mt-4 flex items-center gap-2 text-xs font-bold" aria-live="polite">
        <span
          className={`h-3 w-3 rounded-full border-2 border-black ${
            errorMessage
              ? 'bg-[#ff3b30]'
              : saving || loading
                ? 'bg-[#ffde00] animate-pulse'
                : 'bg-[#00e676]'
          }`}
        />
        <span>
          {errorMessage
            ? errorMessage
            : saving
              ? 'Saving settings...'
              : loading
                ? 'Checking backend...'
                : 'Saved by the Resonance backend.'}
        </span>
      </div>

      <p className="mt-4 text-xs font-semibold leading-relaxed text-black/55">
        {section === 'transcription'
          ? 'Local speech-model processes remain managed by the Resonance backend.'
          : 'Response-provider authentication and local model processes remain managed outside the UI.'}
      </p>
    </div>
  );
}
