import { useEffect, useRef, useState, type RefObject, type SyntheticEvent } from "react";
import type { AppLanguage, CodexHostStatusDto, ProviderSaveInput, ProviderStatusDto } from "../../api/dto.js";
import { researchRoomApi } from "../../api/client.js";
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
  readonly idPrefix?: string;
  readonly title?: string;
  readonly description?: string;
  readonly onTest?: () => Promise<void>;
}

export function ProviderDialog({ open, language, status, busy, returnFocusRef, onClose, onSave, onDeleteConfig, onDeleteSecret, onError, idPrefix = "provider", title, description, onTest }: ProviderDialogProps) {
  const [providerId, setProviderId] = useState("openai-compatible");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [timeoutMs, setTimeoutMs] = useState("15000");
  const [maxOutputTokens, setMaxOutputTokens] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [codexHost, setCodexHost] = useState<CodexHostStatusDto>();
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

  useEffect(() => {
    if (!open || idPrefix !== "provider") return undefined;
    const controller = new AbortController();
    void researchRoomApi.codexHost().then(setCodexHost).catch(() => { if (!controller.signal.aborted) setCodexHost(undefined); });
    return () => { controller.abort(); };
  }, [open, idPrefix]);

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
    <Modal open={open} title={title ?? t(language, "provider_heading")} description={description ?? t(language, "provider_deck")} closeLabel={t(language, "close")} onClose={onClose} returnFocusRef={returnFocusRef} className="provider-modal">
      <div className="provider-current" id="provider-status-box" aria-live="polite">
        <StatusBadge tone={status?.mode === "configured" ? "ready" : "warning"}>
          {status?.mode === "configured" ? t(language, "provider_configured") : t(language, "provider_not_configured")}
        </StatusBadge>
        <p>{status?.config ? `${status.config.providerId} / ${status.config.model} · ${status.config.locality}` : t(language, "ledger_only")}</p>
        <p>{status?.secretConfigured ? (language === "en" ? "Secret configured" : "密钥已配置") : (language === "en" ? "No secret configured" : "未配置密钥")}</p>
      </div>
      {idPrefix === "provider" ? <section className="codex-host-separation" aria-label={language === "en" ? "Codex Host Adapter" : "Codex Host Adapter"}>
        <div><p className="eyebrow">EXTERNAL APP HOST · SEPARATE BOUNDARY</p><h3>{language === "en" ? "Codex Host Adapter" : "Codex 宿主适配器"}</h3><p>{language === "en" ? "This is not the Sestina Provider above. Static availability does not prove a real Pilot run; the project workflow separately previews exact outbound context and requires confirmation." : "它不是上方的 Sestina Provider。静态可用不证明真实 Pilot 已运行；项目工作流会另行展示精确外发内容并要求确认。"}</p></div>
        <StatusBadge tone={codexHost?.availability === "available" ? "ready" : "warning"}>{codexHost?.availability ?? "unproven"}</StatusBadge>
        <dl><dt>{language === "en" ? "Version" : "版本"}</dt><dd>{codexHost?.supportedVersion ?? "unavailable"}</dd><dt>{language === "en" ? "Last explicit verification" : "最近显式验证"}</dt><dd>{codexHost?.verifiedAt ?? "unproven"}</dd><dt>{language === "en" ? "Authority" : "Authority"}</dt><dd>proposal_only · project write false</dd></dl>
      </section> : null}
      <form className="provider-form" onSubmit={(event) => void submit(event)}>
        <label htmlFor={`${idPrefix}-id`}>{t(language, "provider_name")}</label>
        <input id={`${idPrefix}-id`} required maxLength={128} autoComplete="off" value={providerId} onChange={(event) => { setProviderId(event.target.value); }} />
        <label htmlFor={`${idPrefix}-model`}>{t(language, "model")}</label>
        <input id={`${idPrefix}-model`} required maxLength={256} autoComplete="off" value={model} onChange={(event) => { setModel(event.target.value); }} />
        <label htmlFor={`${idPrefix}-url`}>{t(language, "base_url")}</label>
        <input id={`${idPrefix}-url`} required maxLength={2048} autoComplete="url" value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); }} />
        <div className="form-grid">
          <div><label htmlFor={`${idPrefix}-timeout`}>{t(language, "timeout")}</label><input id={`${idPrefix}-timeout`} type="number" min={100} max={120000} required value={timeoutMs} onChange={(event) => { setTimeoutMs(event.target.value); }} /></div>
          <div><label htmlFor={`${idPrefix}-max-tokens`}>{t(language, "max_tokens")}</label><input id={`${idPrefix}-max-tokens`} type="number" min={1} max={65536} value={maxOutputTokens} onChange={(event) => { setMaxOutputTokens(event.target.value); }} /></div>
        </div>
        <label htmlFor={`${idPrefix}-key`}>{t(language, "api_key")}</label>
        <input ref={keyRef} id={`${idPrefix}-key`} type="password" maxLength={8192} autoComplete="new-password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); }} />
        <p className="muted">{t(language, "api_key_hint")}</p>
        <div className="button-row">
          <Button type="submit" variant="primary" disabled={busy}>{t(language, "save_provider")}</Button>
          {onTest ? <Button type="button" variant="secondary" disabled={busy || status?.mode !== "configured"} onClick={() => { void onTest().catch((error: unknown) => { onError(localizedError(language, error)); }); }}>{language === "en" ? "Test metadata connection" : "测试元数据连接"}</Button> : null}
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void onDeleteConfig()}>{t(language, "delete_config")}</Button>
          <Button type="button" variant="danger" disabled={busy} onClick={() => void onDeleteSecret()}>{t(language, "delete_key")}</Button>
        </div>
        {status?.projectReopenRequired ? <p className="inline-warning">{t(language, "provider_reopen")}</p> : null}
      </form>
    </Modal>
  );
}
