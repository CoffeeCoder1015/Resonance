import { useEffect, useState } from 'react';
import {
  getProviderSettings,
  selectProvider,
  type ProviderOption
} from '../services/backend';

export function ProviderSettingsPanel() {
  const [providerOptions, setProviderOptions] = useState<ProviderOption[]>([]);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    void getProviderSettings(abortController.signal)
      .then(settings => {
        setProviderOptions(settings.providers);
        setSelectedProvider(settings.current);
      })
      .catch(error => {
        if (!abortController.signal.aborted) {
          setErrorMessage(error instanceof Error ? error.message : 'Provider settings unavailable.');
        }
      })
      .finally(() => {
        if (!abortController.signal.aborted) setLoading(false);
      });

    return () => abortController.abort();
  }, []);

  const handleProviderChange = async (provider: string) => {
    setSaving(true);
    setErrorMessage(null);
    try {
      setSelectedProvider(await selectProvider(provider));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Provider could not be changed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      id="provider-settings-panel"
      role="tabpanel"
      aria-labelledby="provider-settings-tab"
      className="min-w-0 overflow-y-auto no-scrollbar p-4 sm:p-5"
    >
      <div className="mb-5">
        <p className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-black/45">
          Agent
        </p>
        <h3 className="text-lg font-black tracking-tight sm:text-xl">Provider</h3>
        <p className="mt-0.5 text-xs font-semibold text-black/55 sm:text-sm">
          Choose which local CLI answers new turns.
        </p>
      </div>

      <div className="rounded-[1.5rem] border-[3px] border-black bg-[#e9d8fd] p-4 neo-shadow sm:p-5">
        <label htmlFor="agent-provider" className="mb-2 block text-sm font-black">
          Active provider
        </label>
        <select
          id="agent-provider"
          value={selectedProvider}
          disabled={loading || saving || providerOptions.length === 0}
          onChange={event => void handleProviderChange(event.target.value)}
          className="w-full rounded-xl border-[3px] border-black bg-white px-4 py-3 text-sm font-black outline-none neo-shadow-sm focus:ring-4 focus:ring-[#007bff]/30 disabled:opacity-60"
        >
          {providerOptions.length === 0 && (
            <option value="">
              {loading ? 'Loading providers...' : 'No providers available'}
            </option>
          )}
          {providerOptions.map(provider => (
            <option key={provider.id} value={provider.id} disabled={!provider.available}>
              {provider.label}
              {provider.available ? '' : ' — CLI not found'}
            </option>
          ))}
        </select>

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
                ? 'Saving provider...'
                : loading
                  ? 'Checking backend...'
                  : 'Saved by the Resonance backend.'}
          </span>
        </div>
      </div>

      <p className="mt-4 text-xs font-semibold leading-relaxed text-black/55">
        Provider authentication and model defaults remain managed by each CLI.
      </p>
    </div>
  );
}
