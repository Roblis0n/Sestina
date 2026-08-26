import { useRef } from "react";
import type { AppLanguage, ProviderSaveInput, ProviderStatusDto } from "../../api/dto.js";
import type { AppearancePreferences } from "../../preferences/appearance.js";
import { t } from "../../i18n/copy.js";
import { Button } from "../primitives/Button.js";
import { StatusBadge } from "../primitives/StatusBadge.js";
import { AppearanceDialog } from "./AppearanceDialog.js";
import { ProviderDialog } from "./ProviderDialog.js";

interface AppChromeProps {
  readonly language: AppLanguage;
  readonly provider?: ProviderStatusDto;
  readonly secondOpinionProvider?: ProviderStatusDto;
  readonly runtime: "ready" | "analyzing" | "cancel_requested" | "degraded" | "invalid_response" | "offline" | "committed";
  readonly busy: boolean;
  readonly providerOpen: boolean;
  readonly secondOpinionProviderOpen: boolean;
  readonly appearanceOpen: boolean;
  readonly appearance: AppearancePreferences;
  readonly onLanguage: (language: AppLanguage) => void;
  readonly onProviderOpen: (open: boolean) => void;
  readonly onSecondOpinionProviderOpen: (open: boolean) => void;
  readonly onAppearanceOpen: (open: boolean) => void;
  readonly onAppearance: (preferences: AppearancePreferences) => void;
  readonly onSaveProvider: (input: ProviderSaveInput) => Promise<void>;
  readonly onDeleteProviderConfig: () => Promise<void>;
  readonly onDeleteProviderSecret: () => Promise<void>;
  readonly onSaveSecondOpinionProvider: (input: ProviderSaveInput) => Promise<void>;
  readonly onDeleteSecondOpinionProviderConfig: () => Promise<void>;
  readonly onDeleteSecondOpinionProviderSecret: () => Promise<void>;
  readonly onTestSecondOpinionProvider: () => Promise<void>;
  readonly onError: (message: string) => void;
}
export function AppChrome(props: AppChromeProps) {
  const providerButtonRef = useRef<HTMLButtonElement>(null);
  const secondOpinionProviderButtonRef = useRef<HTMLButtonElement>(null);
  const appearanceButtonRef = useRef<HTMLButtonElement>(null);
  const tone = props.runtime === "ready" || props.runtime === "committed" ? "ready" : props.runtime === "analyzing" || props.runtime === "cancel_requested" ? "working" : props.runtime === "degraded" ? "warning" : "danger";
  const runtimeLabel = t(props.language, props.runtime === "ready" ? "runtime_ready" : props.runtime);
  return (
    <>
      <header className="app-chrome">
        <a className="brand" href="#main-content" aria-label={`${t(props.language, "app_name")} — ${t(props.language, "app_subtitle")}`}>
          <span className="brand__mark" aria-hidden="true">S</span>
          <span><strong>{t(props.language, "app_name")}</strong><small>{t(props.language, "app_subtitle")}</small></span>
        </a>
        <div className="app-chrome__status" aria-label="Runtime status">
          <StatusBadge tone="neutral">{t(props.language, "local_only")}</StatusBadge>
          <StatusBadge tone={props.provider?.mode === "configured" ? "ready" : "warning"}>{props.provider?.mode === "configured" ? t(props.language, "provider_configured") : t(props.language, "ledger_only")}</StatusBadge>
          <StatusBadge tone={props.secondOpinionProvider?.mode === "configured" ? "ready" : "neutral"}>{props.language === "en" ? `2nd opinion: ${props.secondOpinionProvider?.mode === "configured" ? "ready" : "off"}` : `第二意见：${props.secondOpinionProvider?.mode === "configured" ? "就绪" : "未配置"}`}</StatusBadge>
          <StatusBadge tone={tone}>{runtimeLabel}</StatusBadge>
        </div>
        <div className="app-chrome__actions">
          <div className="language-switch" aria-label={t(props.language, "language")}>
            <button type="button" aria-pressed={props.language === "zh-CN"} onClick={() => { props.onLanguage("zh-CN"); }}>中文</button>
            <span aria-hidden="true">/</span>
            <button type="button" aria-pressed={props.language === "en"} onClick={() => { props.onLanguage("en"); }}>EN</button>
          </div>
          <Button ref={appearanceButtonRef} type="button" variant="quiet" onClick={() => { props.onAppearanceOpen(true); }}>{t(props.language, "appearance")}</Button>
          <Button ref={providerButtonRef} type="button" variant="quiet" onClick={() => { props.onProviderOpen(true); }}>{t(props.language, "provider_settings")}</Button>
          <Button ref={secondOpinionProviderButtonRef} type="button" variant="quiet" onClick={() => { props.onSecondOpinionProviderOpen(true); }}>{props.language === "en" ? "Second opinion" : "第二意见"}</Button>
        </div>
      </header>
      <ProviderDialog open={props.providerOpen} language={props.language} status={props.provider} busy={props.busy} returnFocusRef={providerButtonRef} onClose={() => { props.onProviderOpen(false); }} onSave={props.onSaveProvider} onDeleteConfig={props.onDeleteProviderConfig} onDeleteSecret={props.onDeleteProviderSecret} onError={props.onError} />
      <ProviderDialog idPrefix="second-opinion-provider" title={props.language === "en" ? "Independent second-opinion Provider" : "独立第二意见 Provider"} description={props.language === "en" ? "This separate connection is used only after an appeal Manifest is shown and you explicitly confirm sending it. It cannot reuse the original judge runtime." : "这条独立连接只会在 Appeal Manifest 已展示且你明确确认后使用；它不能复用原主审运行时。"} open={props.secondOpinionProviderOpen} language={props.language} status={props.secondOpinionProvider} busy={props.busy} returnFocusRef={secondOpinionProviderButtonRef} onClose={() => { props.onSecondOpinionProviderOpen(false); }} onSave={props.onSaveSecondOpinionProvider} onDeleteConfig={props.onDeleteSecondOpinionProviderConfig} onDeleteSecret={props.onDeleteSecondOpinionProviderSecret} onTest={props.onTestSecondOpinionProvider} onError={props.onError} />
      <AppearanceDialog open={props.appearanceOpen} language={props.language} preferences={props.appearance} returnFocusRef={appearanceButtonRef} onClose={() => { props.onAppearanceOpen(false); }} onApply={props.onAppearance} />
    </>
  );
}
