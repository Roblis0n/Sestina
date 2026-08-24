import { useEffect, useRef, useState, type RefObject, type SyntheticEvent } from "react";
import type { AppLanguage, ProviderSaveInput, ProviderStatusDto } from "../../api/dto.js";
import { Button } from "../primitives/Button.js";
import { Modal } from "../primitives/Modal.js";
import { StatusBadge } from "../primitives/StatusBadge.js";
import { localizedError, t } from "../../i18n/copy.js";

interface ProviderDialogProps {
  readonly open: boolean;
  readonly language: AppLanguage;
  readonly status?: ProviderStatusDto;
  readonly busy: boolean;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
  readonly onClose: () => void;
  readonly onSave: (input: ProviderSaveInput) => Promise<void>;
  readonly onDeleteConfig: () => Promise<void>;
  readonly onDeleteSecret: () => Promise<void>;
  readonly onError: (message: string) => void;
}

export function ProviderDialog({ open, language, status, busy, returnFocusRef, onClose, onSave, onDeleteConfig, onDeleteSecret, onError }: ProviderDialogProps) {
  const [providerId, setProviderId] = useState("openai-compatible");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [timeoutMs, setTimeoutMs] = useState("15000");
  const [maxOutputTokens, setMaxOutputTokens] = useState("");
  const [apiKey, setApiKey] = useState("");
  const keyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !status?.config) return;
    setProviderId(status.config.providerId);
    setModel(status.config.model);
    setBaseUrl(status.config.baseUrl);
    setTimeoutMs(String(status.config.timeoutMs));
    setMaxOutputTokens(status.config.maxOutputTokens ? String(status.config.maxOutputTokens) : "");
    setApiKey("");
  }, [open, status]);

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const tokens = maxOutputTokens.trim();
      await onSave({ providerId, model, baseUrl, timeoutMs: Number(timeoutMs), ...(tokens ? { maxOutputTokens: Number(tokens) } : {}), ...(apiKey ? { apiKey } : {}) });
      setApiKey("");
      keyRef.current?.focus();
    } catch (error) { onError(localizedError(language, error)); }
  }

  return (
    <Modal open={open} title={t(language, "provider_heading")} description={t(language, "provider_deck")} closeLabel={t(language, "close")} onClose={onClose} returnFocusRef={returnFocusRef} className="provider-modal">
      <div className="provider-current" id="provider-status-box" aria-live="polite">
        <StatusBadge tone={status?.mode === "configured" ? "ready" : "warning"}>
          {status?.mode === "configured" ? t(language, "provider_configured") : t(language, "provider_not_configured")}
        </StatusBadge>
        <p>{status?.config ? `${status.config.providerId} / ${status.config.model} · ${status.config.locality}` : t(language, "ledger_only")}</p>
        <p>{status?.secretConfigured ? (language === "en" ? "Secret configured" : "密钥已配置") : (language === "en" ? "No secret configured" : "未配置密钥")}</p>
      </div>
      <form className="provider-form" onSubmit={(event) => void submit(event)}>
        <label htmlFor="provider-id">{t(language, "provider_name")}</label>
        <input id="provider-id" required maxLength={128} autoComplete="off" value={providerId} onChange={(event) => { setProviderId(event.target.value); }} />
        <label htmlFor="provider-model">{t(language, "model")}</label>
        <input id="provider-model" required maxLength={256} autoComplete="off" value={model} onChange={(event) => { setModel(event.target.value); }} />
        <label htmlFor="provider-url">{t(language, "base_url")}</label>
        <input id="provider-url" required maxLength={2048} autoComplete="url" value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); }} />
        <div className="form-grid">
          <div><label htmlFor="provider-timeout">{t(language, "timeout")}</label><input id="provider-timeout" type="number" min={100} max={120000} required value={timeoutMs} onChange={(event) => { setTimeoutMs(event.target.value); }} /></div>
          <div><label htmlFor="provider-max-tokens">{t(language, "max_tokens")}</label><input id="provider-max-tokens" type="number" min={1} max={65536} value={maxOutputTokens} onChange={(event) => { setMaxOutputTokens(event.target.value); }} /></div>
        </div>
        <label htmlFor="provider-key">{t(language, "api_key")}</label>
        <input ref={keyRef} id="provider-key" type="password" maxLength={8192} autoComplete="new-password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); }} />
        <p className="muted">{t(language, "api_key_hint")}</p>
        <div className="button-row">
          <Button type="submit" variant="primary" disabled={busy}>{t(language, "save_provider")}</Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void onDeleteConfig()}>{t(language, "delete_config")}</Button>
          <Button type="button" variant="danger" disabled={busy} onClick={() => void onDeleteSecret()}>{t(language, "delete_key")}</Button>
        </div>
        {status?.projectReopenRequired ? <p className="inline-warning">{t(language, "provider_reopen")}</p> : null}
      </form>
    </Modal>
  );
}
