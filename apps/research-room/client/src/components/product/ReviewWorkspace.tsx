import { useRef, useState, type ChangeEvent, type SyntheticEvent } from "react";
import type {
  AnalyzedReviewDto,
  AppLanguage,
  DispositionKind,
  EvidenceClass,
  PreparedReviewDto,
  ResearchRoomReceiptDto,
} from "../../api/dto.js";
import { Button } from "../primitives/Button.js";
import { StatusBadge } from "../primitives/StatusBadge.js";
import { localizedError, t } from "../../i18n/copy.js";
import type { InspectorSelection } from "./ContextInspector.js";
import { StateNotice } from "./StateNotice.js";
import { WorkspaceHeader } from "./WorkspaceHeader.js";

interface ReviewWorkspaceProps {
  readonly language: AppLanguage;
  readonly projectId: string;
  readonly providerMode: "configured" | "ledger_only";
  readonly busy: boolean;
  readonly prepared?: PreparedReviewDto;
  readonly analyzed?: AnalyzedReviewDto;
  readonly onPrepared: (prepared?: PreparedReviewDto) => void;
  readonly onAnalyzed: (analyzed?: AnalyzedReviewDto) => void;
  readonly onPrepare: (suggestion: string, evidenceClass: EvidenceClass) => Promise<PreparedReviewDto>;
  readonly onAnalyze: (prepared: PreparedReviewDto, signal: AbortSignal) => Promise<AnalyzedReviewDto>;
  readonly onCancel: (prepared: PreparedReviewDto) => Promise<void>;
  readonly onCommit: (input: {
    readonly projectId: string;
    readonly reviewId: string;
    readonly authorityNonce: string;
    readonly expectedStateBinding: Readonly<Record<string, unknown>>;
    readonly disposition: DispositionKind;
    readonly reason: string;
    readonly modifiedProposal?: string;
    readonly redirectQuestion?: string;
  }) => Promise<ResearchRoomReceiptDto>;
  readonly onCommitted: (receipt: ResearchRoomReceiptDto) => Promise<void>;
  readonly onInspect: (selection: InspectorSelection) => void;
  readonly onRuntime: (runtime: "ready" | "analyzing" | "cancel_requested" | "degraded" | "invalid_response" | "offline" | "committed") => void;
  readonly onNotice: (message: string, tone?: "ready" | "warning" | "danger") => void;
}

const DISPOSITIONS: readonly { readonly kind: DispositionKind; readonly key: "accept" | "reject" | "modify_accept" | "defer" | "direction_change"; readonly variant: "primary" | "secondary" | "danger" }[] = [
  { kind: "accepted", key: "accept", variant: "primary" },
  { kind: "rejected", key: "reject", variant: "secondary" },
  { kind: "modified_accepted", key: "modify_accept", variant: "primary" },
  { kind: "deferred", key: "defer", variant: "secondary" },
  { kind: "direction_changed", key: "direction_change", variant: "danger" },
];

export function ReviewWorkspace(props: ReviewWorkspaceProps) {
  const [suggestion, setSuggestion] = useState("");
  const [evidenceClass, setEvidenceClass] = useState<EvidenceClass>("owner_scenario");
  const [fileName, setFileName] = useState("");
  const [reason, setReason] = useState("");
  const [modified, setModified] = useState("");
  const [redirect, setRedirect] = useState("");
  const [selectedDisposition, setSelectedDisposition] = useState<DispositionKind>();
  const analysisAbort = useRef<AbortController | undefined>(undefined);

  async function prepare(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const value = await props.onPrepare(suggestion, evidenceClass);
      props.onPrepared(value);
      props.onAnalyzed(undefined);
      props.onInspect({ kind: "manifest", value });
      props.onNotice(t(props.language, "manifest_ready"), "ready");
    } catch (error) { handleError(error); }
  }

  async function analyze() {
    if (!props.prepared) return;
    const controller = new AbortController();
    analysisAbort.current = controller;
    props.onRuntime("analyzing");
    try {
      const value = await props.onAnalyze(props.prepared, controller.signal);
      if (controller.signal.aborted) return;
      props.onAnalyzed(value);
      props.onInspect({ kind: "analysis", value });
      props.onRuntime(value.providerStatus === "semantic_ready" ? "ready" : "degraded");
      props.onNotice(t(props.language, "analysis_ready"), value.providerStatus === "semantic_ready" ? "ready" : "warning");
    } catch (error) {
      if (!controller.signal.aborted) handleError(error);
    } finally { if (analysisAbort.current === controller) analysisAbort.current = undefined; }
  }

  async function cancelReview() {
    if (!props.prepared) return;
    const wasAnalyzing = analysisAbort.current !== undefined;
    if (wasAnalyzing) {
      props.onRuntime("cancel_requested");
      analysisAbort.current?.abort();
    }
    try {
      await props.onCancel(props.prepared);
      props.onPrepared(undefined);
      props.onAnalyzed(undefined);
      props.onRuntime("ready");
      props.onNotice(t(props.language, "review_cancelled"), "ready");
    } catch (error) { handleError(error); }
  }

  function handleError(error: unknown) {
    const message = localizedError(props.language, error);
    const code = typeof error === "object" && error !== null && "code" in error ? String((error).code) : "";
    props.onRuntime(code === "offline" ? "offline" : code === "invalid_payload" ? "invalid_response" : "degraded");
    props.onInspect({ kind: "error", title: code || t(props.language, "degraded"), message, recovery: t(props.language, "recovery_hint") });
    props.onNotice(message, "danger");
  }

  async function fileChanged(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setFileName(file?.name ?? "");
    if (!file) return;
    if (file.size > 16_384) { props.onNotice(props.language === "en" ? "The selected file exceeds 16 KiB." : "所选文件超过 16 KiB。", "danger"); return; }
    setSuggestion(await file.text());
  }

  async function disposition(kind: DispositionKind) {
    if (!props.analyzed || !reason.trim()) { props.onNotice(t(props.language, "reason_required"), "danger"); return; }
    if (kind === "modified_accepted" && !modified.trim()) { setSelectedDisposition(kind); props.onNotice(t(props.language, "modified_required"), "warning"); return; }
    if (kind === "direction_changed" && !redirect.trim()) { setSelectedDisposition(kind); props.onNotice(t(props.language, "redirect_required"), "warning"); return; }
    try {
      const receipt = await props.onCommit({ projectId: props.projectId, reviewId: props.analyzed.reviewId, authorityNonce: props.analyzed.authorityNonce, expectedStateBinding: props.analyzed.stateBinding, disposition: kind, reason: reason.trim(), ...(kind === "modified_accepted" ? { modifiedProposal: modified.trim() } : {}), ...(kind === "direction_changed" ? { redirectQuestion: redirect.trim() } : {}) });
      props.onPrepared(undefined); props.onAnalyzed(undefined); setSuggestion(""); setReason(""); setModified(""); setRedirect(""); setSelectedDisposition(undefined); setFileName("");
      props.onRuntime("committed");
      await props.onCommitted(receipt);
      props.onNotice(t(props.language, "disposition_committed"), "ready");
    } catch (error) { handleError(error); }
  }

  const prepared = props.prepared;
  const analyzed = props.analyzed;
  const canSemanticDisposition = analyzed?.providerStatus === "semantic_ready";
  return <section className="review-workspace" aria-labelledby="review-heading">
    <WorkspaceHeader id="review-heading" eyebrow="REVIEW / SEMANTIC JUDGE" title={t(props.language, "research_room")} description={t(props.language, "room_deck")} status={<StatusBadge tone="neutral">{t(props.language, "proposal_only")}</StatusBadge>} />
    <StateNotice
      ariaLabel={t(props.language, "runtime_boundary")}
      eyebrow={t(props.language, "runtime_boundary")}
      title={t(props.language, props.providerMode === "configured" ? "semantic_boundary_title" : "ledger_boundary_title")}
      description={t(props.language, props.providerMode === "configured" ? "semantic_boundary_deck" : "ledger_boundary_deck")}
      status={t(props.language, props.providerMode === "configured" ? "semantic_ready" : "ledger_only")}
      tone={props.providerMode === "configured" ? "ready" : "warning"}
    />
    <div className="thread">
      <article className="thread-event thread-event--brief"><span className="thread-event__index">01</span><div><h2>{t(props.language, "current_brief")}</h2><p>{props.language === "en" ? "The active question and task in the left navigation remain the binding frame for this review." : "左侧导航中的当前问题和任务仍是本次审议的约束框架。"}</p></div></article>
      <article className="thread-event thread-event--proposal"><span className="thread-event__index">02</span><div className="thread-event__body"><h2>{t(props.language, "suggestion")}</h2>
        <form onSubmit={(event) => void prepare(event)}>
          <label htmlFor="suggestion">{t(props.language, "suggestion")}</label>
          <textarea id="suggestion" maxLength={16384} required value={suggestion} placeholder={t(props.language, "suggestion_placeholder")} onChange={(event) => { setSuggestion(event.target.value); }} />
          <div className="review-fields"><div><label htmlFor="evidence-class">{t(props.language, "evidence_class")}</label><select id="evidence-class" value={evidenceClass} onChange={(event) => { setEvidenceClass(event.target.value as EvidenceClass); }}><option value="owner_scenario">owner_scenario</option><option value="synthetic_fixture">synthetic_fixture</option><option value="synthetic_adversarial_fixture">synthetic_adversarial_fixture</option></select></div><div className="file-field"><label htmlFor="suggestion-file">{t(props.language, "text_file")}</label><input id="suggestion-file" type="file" accept=".txt,.md,text/plain,text/markdown" onChange={(event) => void fileChanged(event)} /><span>{fileName || t(props.language, "no_file")}</span></div></div>
          <p className="muted">{t(props.language, "file_hint")}</p>
          <Button type="submit" variant="primary" disabled={props.busy || !suggestion.trim()}>{t(props.language, "prepare_manifest")}</Button>
        </form>
      </div></article>
      {prepared ? <article className="thread-event thread-event--manifest"><span className="thread-event__index">03</span><div className="thread-event__body"><div className="event-title"><h2>{t(props.language, "manifest_title")}</h2><StatusBadge tone="warning">{t(props.language, "manifest_unsent")}</StatusBadge></div><p>{prepared.manifest.semanticJudge ? `${prepared.manifest.semanticJudge.provider.id} / ${prepared.manifest.semanticJudge.provider.model} · ${prepared.manifest.semanticJudge.request.requestBodyBytes} bytes` : t(props.language, "ledger_only")}</p><div className="button-row"><Button data-inspector-return="manifest" aria-label={props.language === "en" ? "Inspect Context Manifest" : "检查 Context Manifest"} type="button" variant="quiet" onClick={() => { props.onInspect({ kind: "manifest", value: prepared }); }}>{t(props.language, "open_inspector")}</Button>{!analyzed ? <Button type="button" variant="primary" disabled={props.busy} onClick={() => void analyze()}>{t(props.language, "confirm_analyze")}</Button> : null}<Button type="button" variant="secondary" disabled={props.busy && analysisAbort.current === undefined} onClick={() => void cancelReview()}>{analysisAbort.current ? t(props.language, "cancel_analysis") : t(props.language, "cancel_review")}</Button></div></div></article> : null}
      {analyzed ? <article className="thread-event thread-event--analysis"><span className="thread-event__index">04</span><div className="thread-event__body"><div className="event-title"><h2>{t(props.language, "analysis_title")}</h2><StatusBadge tone={analyzed.providerStatus === "semantic_ready" ? "ready" : "warning"}>{analyzed.providerStatus}</StatusBadge></div><div id="findings" className="finding-summary">{analyzed.analysis.findings.map((finding, index) => <p key={`${finding.kind}-${index}`}><strong>{finding.kind}</strong> — {finding.summary}</p>)}</div><p id="delta"><strong>{t(props.language, "argument_delta")}:</strong> {analyzed.analysis.argumentDelta.genuineAdditions.length > 0 ? analyzed.analysis.argumentDelta.genuineAdditions.join(" · ") : analyzed.analysis.argumentDelta.summary}</p><Button data-inspector-return="analysis" type="button" variant="quiet" onClick={() => { props.onInspect({ kind: "analysis", value: analyzed }); }}>{t(props.language, "open_inspector")}</Button>
        <section className="authority-gate" aria-labelledby="authority-heading"><h2 id="authority-heading">{t(props.language, "authority_title")}</h2><p>{t(props.language, "authority_deck")}</p>{!canSemanticDisposition ? <aside className="action-availability" role="note" aria-label={t(props.language, "disabled_reason")}><strong>{t(props.language, "disabled_reason")}</strong><p>{t(props.language, "semantic_disposition_required")}</p></aside> : null}<label htmlFor="reason">{t(props.language, "disposition_reason")}</label><textarea id="reason" maxLength={4096} required value={reason} onChange={(event) => { setReason(event.target.value); }} />{selectedDisposition === "modified_accepted" ? <><label htmlFor="modified">{t(props.language, "modified_proposal")}</label><textarea id="modified" maxLength={16384} required value={modified} onChange={(event) => { setModified(event.target.value); }} /></> : null}{selectedDisposition === "direction_changed" ? <><label htmlFor="redirect">{t(props.language, "redirect_question")}</label><textarea id="redirect" maxLength={4096} required value={redirect} onChange={(event) => { setRedirect(event.target.value); }} /></> : null}<div className="disposition-grid">{DISPOSITIONS.map((item) => <Button key={item.kind} type="button" variant={item.variant} disabled={props.busy || (!canSemanticDisposition && !["rejected", "deferred"].includes(item.kind))} aria-pressed={selectedDisposition === item.kind} onClick={() => void disposition(item.kind)}>{t(props.language, item.key)}</Button>)}</div></section>
      </div></article> : null}
    </div>
  </section>;
}
