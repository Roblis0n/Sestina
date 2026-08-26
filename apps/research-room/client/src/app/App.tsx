import { useCallback, useEffect, useRef, useState } from "react";
import { researchRoomApi, ResearchRoomApiError } from "../api/client.js";
import type {
  AnalyzedReviewDto,
  AppLanguage,
  CommitDispositionInput,
  EvidenceClass,
  PreparedReviewDto,
  ProjectOpenResultDto,
  ProviderSaveInput,
  ProviderStatusDto,
  ResearchRoomReceiptDto,
  ResearchRoomStateDto,
  SelectedDirectoryPreviewDto,
  StatusDto,
} from "../api/dto.js";
import { AppChrome } from "../components/product/AppChrome.js";
import type { InspectorSelection } from "../components/product/ContextInspector.js";
import { StatusBadge } from "../components/primitives/StatusBadge.js";
import { localizedError, t } from "../i18n/copy.js";
import { applyAppearanceToDocument, readAppearancePreferences, writeAppearancePreferences, type AppearancePreferences } from "../preferences/appearance.js";
import { BriefSetup } from "../screens/BriefSetup.js";
import { LanguageScreen } from "../screens/LanguageScreen.js";
import { ProjectShell } from "../screens/ProjectShell.js";
import { StartCenter } from "../screens/StartCenter.js";

type Phase = "boot" | "language" | "start" | "brief" | "shell" | "fatal";
type RuntimeState = "ready" | "analyzing" | "cancel_requested" | "degraded" | "invalid_response" | "offline" | "committed";

interface Notice {
  readonly message: string;
  readonly tone: "ready" | "warning" | "danger";
}

export function App() {
  const [phase, setPhase] = useState<Phase>("boot");
  const [status, setStatus] = useState<StatusDto>();
  const [language, setLanguage] = useState<AppLanguage>("zh-CN");
  const [provider, setProvider] = useState<ProviderStatusDto>();
  const [secondOpinionProvider, setSecondOpinionProvider] = useState<ProviderStatusDto>();
  const [state, setState] = useState<ResearchRoomStateDto>();
  const [openedProject, setOpenedProject] = useState<{ readonly id: string; readonly title: string }>();
  const [prepared, setPrepared] = useState<PreparedReviewDto>();
  const [analyzed, setAnalyzed] = useState<AnalyzedReviewDto>();
  const [busyCount, setBusyCount] = useState(0);
  const [runtime, setRuntime] = useState<RuntimeState>("ready");
  const [notice, setNotice] = useState<Notice>();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorSelection, setInspectorSelection] = useState<InspectorSelection>();
  const [providerOpen, setProviderOpen] = useState(false);
  const [secondOpinionProviderOpen, setSecondOpinionProviderOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [appearance, setAppearance] = useState<AppearancePreferences>(() => readAppearancePreferences());
  const pickerRequest = useRef<AbortController | undefined>(undefined);
  const busy = busyCount > 0;

  const runBusy = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    setBusyCount((value) => value + 1);
    try { return await action(); }
    finally { setBusyCount((value) => Math.max(0, value - 1)); }
  }, []);

  const showNotice = useCallback((message: string, tone: Notice["tone"] = "ready") => { setNotice({ message, tone }); }, []);

  const handleFailure = useCallback((error: unknown, activeLanguage: AppLanguage = language) => {
    const apiError = error instanceof ResearchRoomApiError ? error : undefined;
    const message = localizedError(activeLanguage, error);
    const nextRuntime: RuntimeState = apiError?.code === "offline" ? "offline" : apiError?.code === "invalid_payload" ? "invalid_response" : "degraded";
    setRuntime(nextRuntime);
    showNotice(message, "danger");
    setInspectorSelection({ kind: "error", title: t(activeLanguage, nextRuntime), message, recovery: t(activeLanguage, "recovery_hint") });
    setInspectorOpen(true);
  }, [language, showNotice]);

  const restore = useCallback(async (initialStatus: StatusDto, activeLanguage: AppLanguage) => {
    setStatus(initialStatus);
    setLanguage(activeLanguage);
    const [providerStatus, secondOpinionProviderStatus] = await Promise.all([researchRoomApi.provider(), researchRoomApi.secondOpinionProvider()]);
    setProvider(providerStatus);
    setSecondOpinionProvider(secondOpinionProviderStatus);
    if (!initialStatus.projectOpen) { setPhase("start"); setRuntime("ready"); showNotice(activeLanguage === "en" ? "Local service is ready." : "本地服务已就绪。", "ready"); return; }
    if (initialStatus.projectSetupRequired) {
      setOpenedProject(initialStatus.project);
      setPhase("brief");
      setRuntime("ready");
      return;
    }
    const restored = await researchRoomApi.state();
    setState(restored);
    setOpenedProject(restored.project);
    setPhase("shell");
    setRuntime("ready");
    showNotice(t(activeLanguage, "restored"), "ready");
  }, [showNotice]);

  useEffect(() => {
    applyAppearanceToDocument(appearance);
    void runBusy(async () => {
      try {
        const initial = await researchRoomApi.status();
        setStatus(initial);
        if (initial.languagePreference === null) { setPhase("language"); return; }
        await restore(initial, initial.languagePreference);
      } catch (error) { setPhase("fatal"); handleFailure(error, "en"); }
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  async function chooseLanguage(next: AppLanguage) {
    await runBusy(async () => {
      try {
        await researchRoomApi.saveLanguage(next);
        const refreshed = await researchRoomApi.status();
        await restore(refreshed, next);
      } catch (error) { handleFailure(error, next); }
    });
  }

  async function changeLanguage(next: AppLanguage) {
    if (next === language) return;
    await runBusy(async () => {
      try { await researchRoomApi.saveLanguage(next); setLanguage(next); showNotice(next === "en" ? "Interface language saved locally." : "界面语言已在本机保存。", "ready"); }
      catch (error) { handleFailure(error); }
    });
  }

  function applyAppearance(preferences: AppearancePreferences) {
    writeAppearancePreferences(preferences);
    applyAppearanceToDocument(preferences);
    setAppearance(preferences);
  }

  async function refreshState() {
    const next = await researchRoomApi.state();
    setState(next);
    setOpenedProject(next.project);
    return next;
  }

  async function opened(openedValue: ProjectOpenResultDto) {
    setOpenedProject(openedValue.project);
    setPrepared(undefined); setAnalyzed(undefined); setInspectorOpen(false);
    if (openedValue.setupRequired) { setPhase("brief"); showNotice(t(language, "initialized"), "ready"); return; }
    await runBusy(async () => {
      try { await refreshState(); setPhase("shell"); setRuntime("ready"); showNotice(t(language, "opened"), "ready"); }
      catch (error) { handleFailure(error); }
    });
  }

  async function previewNative(): Promise<SelectedDirectoryPreviewDto> {
    const controller = new AbortController();
    pickerRequest.current = controller;
    // The native picker owns its own pending state. Keeping it outside the global
    // busy counter leaves manual path entry, cancellation, language, and appearance responsive.
    try { return await researchRoomApi.previewSelectedDirectory(controller.signal); }
    finally { if (pickerRequest.current === controller) pickerRequest.current = undefined; }
  }

  async function cancelNative() {
    pickerRequest.current?.abort();
    await researchRoomApi.cancelDirectorySelection();
  }

  async function openManual(path: string, initializeIfNeeded: boolean): Promise<ProjectOpenResultDto> {
    return runBusy(() => researchRoomApi.openProject(path, initializeIfNeeded));
  }

  async function initializeNative(nonce: string): Promise<ProjectOpenResultDto> {
    return runBusy(() => researchRoomApi.initializeSelectedDirectory(nonce));
  }

  async function activateBrief(question: string, task: string): Promise<ResearchRoomStateDto> {
    return runBusy(() => researchRoomApi.activateBrief(question, task));
  }

  function activated(next: ResearchRoomStateDto) {
    setState(next); setOpenedProject(next.project); setPhase("shell"); setRuntime("ready"); showNotice(t(language, "opened"), "ready");
  }

  async function saveProvider(input: ProviderSaveInput) {
    await runBusy(async () => { const next = await researchRoomApi.saveProvider(input); setProvider(next); showNotice(language === "en" ? "Provider configuration saved locally; no network request was made." : "Provider 配置已在本机保存；没有发出网络请求。", "ready"); });
  }

  async function deleteProviderConfig() {
    await runBusy(async () => { setProvider(await researchRoomApi.deleteProviderConfig()); showNotice(language === "en" ? "Provider configuration deleted." : "Provider 配置已删除。", "ready"); });
  }

  async function deleteProviderSecret() {
    await runBusy(async () => { setProvider(await researchRoomApi.deleteProviderSecret()); showNotice(language === "en" ? "Provider secret deleted." : "Provider 密钥已删除。", "ready"); });
  }

  async function saveSecondOpinionProvider(input: ProviderSaveInput) {
    await runBusy(async () => { const next = await researchRoomApi.saveSecondOpinionProvider(input); setSecondOpinionProvider(next); showNotice(language === "en" ? "Independent second-opinion configuration saved locally; no research data was sent." : "独立第二意见配置已保存在本机；没有发送任何研究数据。", "ready"); });
  }

  async function deleteSecondOpinionProviderConfig() {
    await runBusy(async () => { setSecondOpinionProvider(await researchRoomApi.deleteSecondOpinionProviderConfig()); showNotice(language === "en" ? "Independent second-opinion configuration deleted." : "独立第二意见配置已删除。", "ready"); });
  }

  async function deleteSecondOpinionProviderSecret() {
    await runBusy(async () => { setSecondOpinionProvider(await researchRoomApi.deleteSecondOpinionProviderSecret()); showNotice(language === "en" ? "Independent second-opinion secret deleted." : "独立第二意见密钥已删除。", "ready"); });
  }

  async function testSecondOpinionProvider() {
    await runBusy(async () => { const result = await researchRoomApi.testSecondOpinionProvider(); showNotice(language === "en" ? `Independent metadata connection reached ${result.providerId} (${result.httpStatus}); no research context was sent.` : `独立元数据连接已到达 ${result.providerId}（${result.httpStatus}）；未发送研究上下文。`, "ready"); });
  }

  async function prepareReview(suggestion: string, evidenceClass: EvidenceClass) { return runBusy(() => researchRoomApi.prepareReview(suggestion, evidenceClass)); }
  async function analyzeReview(value: PreparedReviewDto, signal: AbortSignal) { return runBusy(() => researchRoomApi.analyzeReview(value, signal)); }
  async function cancelReview(value: PreparedReviewDto) { await runBusy(() => researchRoomApi.cancelReview(value).then(() => undefined)); }
  async function commitDisposition(input: CommitDispositionInput) { return runBusy(() => researchRoomApi.commitDisposition(input)); }
  async function committed(receipt: ResearchRoomReceiptDto) { await refreshState(); setInspectorSelection({ kind: "receipt", value: receipt }); setInspectorOpen(true); }
  async function downloadReceipt(receipt: ResearchRoomReceiptDto) {
    await runBusy(async () => {
      const blob = await researchRoomApi.downloadReceipt(receipt.id);
      const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${receipt.id}.json`; link.click(); URL.revokeObjectURL(url); showNotice(t(language, "downloaded"), "ready");
    });
  }
  async function rollbackReceipt(receipt: ResearchRoomReceiptDto, reason: string) {
    await runBusy(async () => { const result = await researchRoomApi.rollbackReceipt(state?.project.id ?? "", receipt.id, receipt.version, reason); await refreshState(); setInspectorSelection({ kind: "research_object", title: `Receipt ${result.id}`, status: result.status, fields: [{ label: "ID", value: result.id }, { label: "Version", value: String(result.version) }, { label: "Hash", value: result.receiptHash }] }); setInspectorOpen(true); setRuntime("ready"); showNotice(t(language, "rolled_back"), "ready"); });
  }

  const chrome = phase !== "language" && phase !== "boot" ? <AppChrome language={language} provider={provider} secondOpinionProvider={secondOpinionProvider} runtime={runtime} busy={busy} providerOpen={providerOpen} secondOpinionProviderOpen={secondOpinionProviderOpen} appearanceOpen={appearanceOpen} appearance={appearance} onLanguage={(next) => void changeLanguage(next)} onProviderOpen={setProviderOpen} onSecondOpinionProviderOpen={setSecondOpinionProviderOpen} onAppearanceOpen={setAppearanceOpen} onAppearance={applyAppearance} onSaveProvider={saveProvider} onDeleteProviderConfig={deleteProviderConfig} onDeleteProviderSecret={deleteProviderSecret} onSaveSecondOpinionProvider={saveSecondOpinionProvider} onDeleteSecondOpinionProviderConfig={deleteSecondOpinionProviderConfig} onDeleteSecondOpinionProviderSecret={deleteSecondOpinionProviderSecret} onTestSecondOpinionProvider={testSecondOpinionProvider} onError={(message) => { showNotice(message, "danger"); }} /> : null;

  return <div className="app-root" aria-busy={busy}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      {chrome}
      <div className="live-region" role="status" aria-live="polite" data-tone={notice?.tone ?? "ready"}>{notice?.message ?? ""}</div>
      {phase === "boot" ? <main className="boot-screen"><div className="boot-mark">S</div><p>Starting the local Research Room…</p></main> : null}
    {phase === "language" ? <LanguageScreen busy={busy} onChoose={(next) => void chooseLanguage(next)} /> : null}
    {phase === "start" && status ? <StartCenter language={language} directoryPickerAvailable={status.directoryPickerAvailable} busy={busy} onPreviewNative={previewNative} onCancelNative={cancelNative} onOpenManual={openManual} onInitializeNative={initializeNative} onOpened={(value) => void opened(value)} onNotice={showNotice} /> : null}
    {phase === "brief" && openedProject ? <BriefSetup language={language} projectTitle={openedProject.title} busy={busy} onActivate={activateBrief} onActivated={activated} onError={(message) => { showNotice(message, "danger"); }} /> : null}
    {phase === "shell" && state ? <ProjectShell language={language} state={state} busy={busy} prepared={prepared} analyzed={analyzed} inspectorOpen={inspectorOpen} inspectorSelection={inspectorSelection} onInspector={(open, selection) => { setInspectorOpen(open); if (selection) setInspectorSelection(selection); }} onSwitchProject={() => { setPrepared(undefined); setAnalyzed(undefined); setInspectorOpen(false); setInspectorSelection(undefined); setState(undefined); window.history.replaceState({}, "", "/"); setPhase("start"); }} onPrepared={setPrepared} onAnalyzed={setAnalyzed} onPrepare={prepareReview} onAnalyze={analyzeReview} onCancel={cancelReview} onCommit={commitDisposition} onCommitted={committed} onDownload={downloadReceipt} onRollback={rollbackReceipt} onRuntime={setRuntime} onNotice={showNotice} onError={handleFailure} onAuthorityChanged={async () => { await refreshState(); }} /> : null}
    {phase === "fatal" ? <main id="main-content" className="fatal-screen"><StatusBadge tone="danger">{t(language, "offline")}</StatusBadge><h1>{t(language, "service_unavailable")}</h1><p>{t(language, "recovery_hint")}</p><button type="button" onClick={() => { window.location.reload(); }}>{t(language, "retry")}</button></main> : null}
    </div>;
}
