import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { researchRoomApi } from "../../api/client.js";
import type {
  AppealDetailDto,
  AppealResolutionKindDto,
  AppealStatementDto,
  AppealSummaryDto,
  AppLanguage,
  ObjectReceiptDetailDto,
  PreparedAppealSecondOpinionDto,
  ProviderStatusDto,
  WorkspacePage,
} from "../../api/dto.js";
import type { ProjectRoute } from "../../routing/project-route.js";
import { Button } from "../primitives/Button.js";
import { StatusBadge } from "../primitives/StatusBadge.js";

interface Props {
  readonly language: AppLanguage;
  readonly projectId: string;
  readonly route: ProjectRoute;
  readonly onNavigate: (href: string) => void;
  readonly onError: (error: unknown) => void;
  readonly onNotice: (message: string, tone?: "ready" | "warning" | "danger") => void;
  readonly onAuthorityChanged: () => Promise<void>;
}

const CRITERION_BY_FINDING: Readonly<Record<string, string>> = Object.freeze({
  focus_substitution: "focus-substitution",
  repeated_audit: "repeated-audit",
  audit_hijacking: "audit-hijacking",
  semantic_scope_violation: "semantic-scope",
  decision_integrity: "decision-integrity",
  argument_leap: "argument-leap",
  pseudo_depth: "pseudo-depth",
  argument_delta: "argument-delta",
});

const RESOLUTIONS: readonly AppealResolutionKindDto[] = [
  "uphold_original_finding",
  "overturn_original_finding",
  "modify_finding_interpretation",
  "defer_insufficient_evidence",
  "record_disagreement_without_resolution",
];

function c(language: AppLanguage, en: string, zh: string): string { return language === "en" ? en : zh; }
function date(language: AppLanguage, value: string): string { try { return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); } catch { return value; } }
function pretty(value: unknown): string { return JSON.stringify(value, null, 2); }
function displayScalar(value: unknown, fallback = "—"): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return fallback;
}
function statusTone(status: AppealDetailDto["status"]): "ready" | "working" | "warning" | "danger" | "neutral" {
  if (status === "resolved" || status === "second_opinion_ready") return "ready";
  if (status === "second_opinion_running" || status === "awaiting_send_confirmation") return "working";
  if (status === "provider_failed" || status === "stale_conflicted") return "danger";
  if (status === "appeal_record_only" || status === "cancelled" || status === "recorded") return "warning";
  return "neutral";
}

export function CorrectionAppealWorkspace(props: Props) {
  if (props.route.creating) return <AppealCreate {...props} />;
  if (props.route.objectId) return <AppealDetail {...props} appealId={props.route.objectId} />;
  return <AppealLedger {...props} />;
}

function AppealProviderState({ language }: { readonly language: AppLanguage }) {
  const [status, setStatus] = useState<ProviderStatusDto>();
  useEffect(() => { void researchRoomApi.secondOpinionProvider().then(setStatus).catch(() => { setStatus(undefined); }); }, []);
  const configuredDescription = status?.config
    ? `${status.config.providerId} · ${status.config.model} · ${status.config.locality}`
    : c(language, "An independent connection is bound by the current local runtime. Its credentials and private configuration are not exposed to this screen.", "当前本地运行时已绑定独立连接；其凭据与私有配置不会暴露到此界面。");
  return <aside className="appeal-provider-state" aria-label={c(language, "Independent second-opinion status", "独立第二意见状态")}>
    <StatusBadge tone={status?.mode === "configured" ? "ready" : "warning"}>{status?.mode === "configured" ? c(language, "Independent connection configured", "独立连接已配置") : c(language, "Appeal record only", "仅记录 Appeal")}</StatusBadge>
    <p>{status?.mode === "configured" ? configuredDescription : c(language, "No independent Provider is configured. The appeal remains durable and user-resolvable without a model call.", "尚未配置独立 Provider。Appeal 仍会持久保存，并可由用户直接裁决，不会伪造模型调用。")}</p>
    {status?.projectReopenRequired ? <p className="inline-warning">{c(language, "Reopen this project before requesting a second opinion so the new connection is bound to Core.", "请求第二意见前请重新打开当前项目，使新连接进入 Core 绑定。")}</p> : null}
  </aside>;
}

function AppealLedger(props: Props) {
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<WorkspacePage<AppealSummaryDto>>();
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true);
    try { setPage(await researchRoomApi.listResearchObjects("appeal", { limit: 50, ...(status ? { status } : {}), ...(query.trim() ? { query: query.trim() } : {}) }) as WorkspacePage<AppealSummaryDto>); }
    catch (error) { props.onError(error); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [props.projectId, status]);
  return <section className="object-workspace appeal-workspace" aria-labelledby="appeal-ledger-title">
    <header className="workspace-section-header appeal-hero"><div><p className="eyebrow">CORRECTION APPEALS</p><h1 id="appeal-ledger-title">{c(props.language, "Correction Appeals", "纠错申诉")}</h1><p>{c(props.language, "Challenge a specific committed Semantic Judge finding without overwriting it. One optional independent opinion may add evidence, but only you can resolve the appeal.", "针对已提交的 Semantic Judge finding 提出申诉，原记录不会被覆盖。可选的一次独立意见只能增加证据，最终裁决始终由你完成。")}</p></div><Button type="button" variant="quiet" disabled={loading} onClick={() => { void load(); }}>{c(props.language, "Refresh", "刷新")}</Button></header>
    <AppealProviderState language={props.language} />
    <form className="ledger-filters appeal-filters" onSubmit={(event) => { event.preventDefault(); void load(); }}>
      <label>{c(props.language, "Status", "状态")}<select value={status} onChange={(event) => { setStatus(event.target.value); }}><option value="">{c(props.language, "All statuses", "全部状态")}</option>{["draft", "recorded", "awaiting_send_confirmation", "second_opinion_running", "second_opinion_ready", "appeal_record_only", "provider_failed", "cancelled", "stale_conflicted", "resolved"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="filter-search">{c(props.language, "Search appeal records", "搜索 Appeal 记录")}<input value={query} onChange={(event) => { setQuery(event.target.value); }} placeholder={c(props.language, "criterion, disagreement, finding ID", "criterion、异议、finding ID")} /></label>
      <Button type="submit" variant="quiet" disabled={loading}>{c(props.language, "Apply", "应用")}</Button>
    </form>
    {loading && !page ? <p role="status" className="empty-state">{c(props.language, "Reading local appeals…", "正在读取本地 Appeal……")}</p> : null}
    {page?.items.length ? <ol className="structured-list ledger-list appeal-list">{page.items.map((item) => <li key={item.id}><button type="button" onClick={() => { props.onNavigate(`/project/appeals/${item.id}`); }}><span><strong>{item.disagreement}</strong><small>{item.criterionId} · {item.findingId} · v{item.version}<br/>{date(props.language, item.updatedAt)} · {item.attemptCount} {c(props.language, "attempts", "次尝试")}</small></span><StatusBadge tone={statusTone(item.status)}>{item.status}</StatusBadge></button></li>)}</ol> : !loading ? <div className="empty-state appeal-empty"><strong>{c(props.language, "No correction appeal is recorded.", "尚未记录纠错申诉。")}</strong><p>{c(props.language, "Open a semantic-ready Receipt and choose an eligible finding to start. Sestina will not invent an appeal source.", "请打开 semantic-ready Receipt，并从符合条件的 finding 发起。Sestina 不会虚构申诉来源。")}</p><Button type="button" variant="quiet" onClick={() => { props.onNavigate("/project/receipts"); }}>{c(props.language, "Open Receipts", "打开 Receipts")}</Button></div> : null}
  </section>;
}

function AppealCreate(props: Props) {
  const params = new URLSearchParams(window.location.search);
  const receiptId = params.get("receipt") ?? "";
  const findingId = params.get("finding") ?? "";
  const [receipt, setReceipt] = useState<ObjectReceiptDetailDto>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    void researchRoomApi.researchObject("receipt", receiptId).then((value) => { setReceipt(value as ObjectReceiptDetailDto); }).catch(props.onError).finally(() => { setLoading(false); });
  }, [props.projectId, receiptId, findingId]);
  const finding = receipt?.appealableFindings.find((item) => item.findingId === findingId);
  const criterionId = finding ? CRITERION_BY_FINDING[finding.kind] : undefined;
  async function create(statement: AppealStatementDto) {
    try {
      const created = await researchRoomApi.createCorrectionAppeal(props.projectId, receiptId, findingId, statement);
      props.onNotice(c(props.language, "Draft appeal created from the frozen finding. The original receipt was not changed.", "已从冻结 finding 创建 Appeal 草稿；原 Receipt 未被修改。"), "ready");
      props.onNavigate(`/project/appeals/${created.id}`);
    } catch (error) { props.onError(error); }
  }
  return <section className="object-workspace appeal-workspace" aria-labelledby="appeal-create-title"><header className="workspace-section-header appeal-hero"><div><p className="eyebrow">NEW CORRECTION APPEAL</p><h1 id="appeal-create-title">{c(props.language, "Challenge one finding", "申诉一条 finding")}</h1><p>{c(props.language, "Your statement is versioned. The source finding, rubric, input bindings, and research-state binding are frozen when the draft is created.", "你的陈述会被版本化；草稿创建时会冻结来源 finding、rubric、输入绑定和研究状态绑定。")}</p></div><Button type="button" variant="quiet" onClick={() => { props.onNavigate(`/project/receipts/${receiptId}`); }}>{c(props.language, "Back to Receipt", "返回 Receipt")}</Button></header>
    {loading ? <p role="status" className="empty-state">{c(props.language, "Verifying the source finding…", "正在核验来源 finding……")}</p> : finding?.action === "open_appeal" && finding.href ? <div className="inline-warning"><p>{c(props.language, "An active appeal already exists for this finding.", "该 finding 已存在未结束 Appeal。")}</p><Button type="button" onClick={() => { props.onNavigate(finding.href ?? "/project/appeals"); }}>{c(props.language, "Open existing appeal", "打开已有 Appeal")}</Button></div> : finding?.action === "create_appeal" && criterionId ? <><section className="appeal-source-card"><StatusBadge tone={finding.severity === "error" ? "danger" : "warning"}>{finding.severity}</StatusBadge><dl><dt>Receipt</dt><dd>{receiptId}</dd><dt>Finding</dt><dd>{findingId}</dd><dt>{c(props.language, "Finding kind", "Finding 类型")}</dt><dd>{finding.kind}</dd><dt>{c(props.language, "Frozen criterion", "冻结 criterion")}</dt><dd>{criterionId}</dd></dl></section><StatementForm language={props.language} criterionId={criterionId} submitLabel={c(props.language, "Create appeal draft", "创建 Appeal 草稿")} onSubmit={create} /></> : <div className="inline-error" role="alert"><strong>{c(props.language, "This source cannot create an appeal.", "该来源无法创建 Appeal。")}</strong><p>{c(props.language, "The Receipt must contain an eligible, committed Semantic Judge finding with a current criterion binding.", "Receipt 必须包含已提交、符合条件且具有当前 criterion 绑定的 Semantic Judge finding。")}</p></div>}
  </section>;
}

function StatementForm({ language, criterionId, initial, submitLabel, busy = false, onSubmit }: { readonly language: AppLanguage; readonly criterionId: string; readonly initial?: AppealStatementDto; readonly submitLabel: string; readonly busy?: boolean; readonly onSubmit: (statement: AppealStatementDto) => Promise<void> }) {
  const [error, setError] = useState<string>();
  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault(); setError(undefined); const data = new FormData(event.currentTarget);
    const read = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" ? value.trim() : "";
    };
    const statement: AppealStatementDto = { disagreement: read("disagreement"), challengedCriterionId: criterionId, claimedError: read("claimedError"), missingOrMisreadContext: read("missingOrMisreadContext"), secondOpinionQuestion: read("secondOpinionQuestion"), ...(read("desiredDisposition") ? { desiredDisposition: read("desiredDisposition") as AppealResolutionKindDto } : {}) };
    if (!statement.disagreement || !statement.claimedError || !statement.missingOrMisreadContext || !statement.secondOpinionQuestion) { setError(c(language, "Complete every public appeal field.", "请完整填写每个公开 Appeal 字段。")); return; }
    await onSubmit(statement);
  }
  return <form className="structured-editor appeal-statement-form" onSubmit={(event) => { void submit(event); }}><h2>{c(language, "Your public appeal statement", "你的公开 Appeal 陈述")}</h2><p>{c(language, "Do not paste secrets or hidden reasoning. State the observable error and the context you believe was missed.", "不要粘贴密钥或隐藏推理；请说明可观察的错误，以及你认为被漏读的上下文。")}</p><label>{c(language, "Disagreement", "异议摘要")}<textarea name="disagreement" required maxLength={8192} defaultValue={initial?.disagreement} /></label><label>{c(language, "Claimed error", "主张的错误")}<textarea name="claimedError" required maxLength={8192} defaultValue={initial?.claimedError} /></label><label>{c(language, "Missing or misread context", "遗漏或误读的上下文")}<textarea name="missingOrMisreadContext" required maxLength={8192} defaultValue={initial?.missingOrMisreadContext} /></label><label>{c(language, "One question for the independent opinion", "给独立意见的单一问题")}<textarea name="secondOpinionQuestion" required maxLength={8192} defaultValue={initial?.secondOpinionQuestion} /></label><label>{c(language, "Preferred disposition (optional)", "希望的处置（可选）")}<select name="desiredDisposition" defaultValue={initial?.desiredDisposition ?? ""}><option value="">{c(language, "No preference", "不预设")}</option>{RESOLUTIONS.map((kind) => <option key={kind}>{kind}</option>)}</select></label><p className="appeal-criterion-lock">{c(language, "Challenged criterion is locked to", "申诉 criterion 已锁定为")} <code>{criterionId}</code></p>{error ? <p className="inline-error" role="alert">{error}</p> : null}<Button type="submit" disabled={busy}>{submitLabel}</Button></form>;
}

function AppealDetail(props: Props & { readonly appealId: string }) {
  const [detail, setDetail] = useState<AppealDetailDto>();
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState<PreparedAppealSecondOpinionDto>();
  const [sendAcknowledged, setSendAcknowledged] = useState(false);
  const runController = useRef<AbortController | undefined>(undefined);
  async function load() { setLoading(true); try { setDetail(await researchRoomApi.researchObject("appeal", props.appealId) as AppealDetailDto); } catch (error) { props.onError(error); } finally { setLoading(false); } }
  useEffect(() => { setPrepared(undefined); setSendAcknowledged(false); void load(); return () => { runController.current?.abort(); }; }, [props.projectId, props.appealId]);
  async function mutate(action: () => Promise<AppealDetailDto>, success: string) { setBusy(true); try { const next = await action(); setDetail(next); setPrepared(undefined); setSendAcknowledged(false); props.onNotice(success, "ready"); await props.onAuthorityChanged(); } catch (error) { props.onError(error); } finally { setBusy(false); } }
  if (!detail) return <section className="object-workspace appeal-workspace"><p role="status" className="empty-state">{loading ? c(props.language, "Reading appeal…", "正在读取 Appeal……") : c(props.language, "Appeal not found.", "未找到 Appeal。")}</p></section>;
  const latestStatement = detail.statements.at(-1)?.statement;
  const latestAttempt = detail.attempts.at(-1);
  return <section className="object-workspace appeal-workspace" aria-labelledby="appeal-detail-title">
    <header className="workspace-section-header appeal-hero"><div><p className="eyebrow">CORRECTION APPEAL · v{detail.version}</p><h1 id="appeal-detail-title">{detail.disagreement}</h1><p>{detail.criterionId} · {detail.findingId}</p></div><div className="header-actions"><StatusBadge tone={statusTone(detail.status)}>{detail.status}</StatusBadge><Button type="button" variant="quiet" disabled={loading || busy} onClick={() => { void load(); }}>{c(props.language, "Reload", "重新加载")}</Button></div></header>
    <div className="authority-ribbon"><strong>{c(props.language, "User authority is final", "用户权威是最终权威")}</strong><span>{c(props.language, "No model, comparison, hash, or tool success can resolve this appeal.", "任何模型、比较、hash 或工具成功都不能替你裁决 Appeal。")}</span></div>
    <AppealProviderState language={props.language} />
    <section className="appeal-source-card"><h2>{c(props.language, "Frozen source", "冻结来源")}</h2><dl><dt>Appeal</dt><dd>{detail.id}</dd><dt>Receipt</dt><dd><button type="button" className="text-link" onClick={() => { props.onNavigate(detail.relatedReceiptHref); }}>{detail.sourceReceiptId}</button></dd><dt>Review</dt><dd>{detail.reviewId}</dd><dt>Finding</dt><dd>{detail.findingId}</dd><dt>Criterion</dt><dd>{detail.criterionId}</dd><dt>{c(props.language, "Finding hash", "Finding hash")}</dt><dd><code>{displayScalar(detail.source.findingHash, "")}</code></dd></dl></section>
    {latestStatement ? <section className="appeal-statement"><div className="section-heading"><h2>{c(props.language, "Current appeal statement", "当前 Appeal 陈述")}</h2>{detail.availableActions.includes("edit") ? <Button type="button" variant="quiet" onClick={() => { setEditing((value) => !value); }}>{editing ? c(props.language, "Close editor", "关闭编辑") : c(props.language, "Edit draft", "编辑草稿")}</Button> : null}</div><dl><dt>{c(props.language, "Disagreement", "异议")}</dt><dd>{latestStatement.disagreement}</dd><dt>{c(props.language, "Claimed error", "主张错误")}</dt><dd>{latestStatement.claimedError}</dd><dt>{c(props.language, "Missing / misread context", "遗漏 / 误读上下文")}</dt><dd>{latestStatement.missingOrMisreadContext}</dd><dt>{c(props.language, "Second-opinion question", "第二意见问题")}</dt><dd>{latestStatement.secondOpinionQuestion}</dd></dl></section> : null}
    {editing && latestStatement ? <StatementForm language={props.language} criterionId={detail.criterionId} initial={latestStatement} busy={busy} submitLabel={c(props.language, "Save new statement version", "保存新的陈述版本")} onSubmit={async (statement) => { await mutate(() => researchRoomApi.updateCorrectionAppeal(props.projectId, detail.id, detail.version, statement), c(props.language, "Appeal statement version saved.", "Appeal 陈述版本已保存。")); setEditing(false); }} /> : null}
    <section className="appeal-actions"><h2>{c(props.language, "Appeal path", "Appeal 路径")}</h2><div className="appeal-action-grid">
      {detail.availableActions.includes("record") ? <article><span>01</span><h3>{c(props.language, "Record the appeal", "记录 Appeal")}</h3><p>{c(props.language, "Makes the draft durable. If no independent Provider is bound, it contracts honestly to appeal_record_only.", "使草稿进入持久记录；若未绑定独立 Provider，将诚实收缩为 appeal_record_only。")}</p><Button type="button" disabled={busy} onClick={() => { void mutate(() => researchRoomApi.recordCorrectionAppeal(props.projectId, detail.id, detail.version), c(props.language, "Appeal recorded without changing the original finding.", "Appeal 已记录，原 finding 未改变。")); }}>{c(props.language, "Confirm record", "确认记录")}</Button></article> : null}
      {detail.availableActions.includes("record_only") ? <article><span>02</span><h3>{c(props.language, "Stop at record only", "停在仅记录")}</h3><p>{c(props.language, "Keep the disagreement and proceed directly to your resolution without a Provider call.", "保留异议，不调用 Provider，直接进入你的裁决。")}</p><Button type="button" variant="secondary" disabled={busy} onClick={() => { void mutate(() => researchRoomApi.markCorrectionAppealRecordOnly(props.projectId, detail.id, detail.version), c(props.language, "Appeal retained as a record-only disagreement.", "Appeal 已保留为仅记录异议。")); }}>{c(props.language, "Use record-only path", "使用仅记录路径")}</Button></article> : null}
    </div></section>
    {detail.availableActions.includes("prepare_second_opinion") || detail.availableActions.includes("retry_with_new_manifest") ? <ContextSelection language={props.language} projectId={props.projectId} busy={busy} retry={detail.availableActions.includes("retry_with_new_manifest")} onPrepare={async (allowedContext) => { setBusy(true); try { const next = await researchRoomApi.prepareCorrectionAppealSecondOpinion(props.projectId, detail.id, detail.version, allowedContext); setPrepared(next); setDetail(next.appeal); setSendAcknowledged(false); props.onNotice(c(props.language, "Exact Context Manifest prepared. Nothing has been sent.", "精确 Context Manifest 已准备；尚未发送任何内容。"), "warning"); } catch (error) { props.onError(error); } finally { setBusy(false); } }} /> : null}
    {prepared ? <ManifestConfirmation language={props.language} prepared={prepared} acknowledged={sendAcknowledged} onAcknowledged={setSendAcknowledged} busy={busy} onCancel={() => { setPrepared(undefined); setSendAcknowledged(false); }} onSend={async () => { const controller = new AbortController(); runController.current = controller; setBusy(true); try { const next = await researchRoomApi.runCorrectionAppealSecondOpinion(props.projectId, detail.id, prepared.appeal.version, prepared, controller.signal); setDetail(next); setPrepared(undefined); setSendAcknowledged(false); props.onNotice(c(props.language, "Independent result recorded for comparison. Your resolution is still required.", "独立结果已记录用于比较；仍需你作最终裁决。"), "ready"); await props.onAuthorityChanged(); } catch (error) { props.onError(error); await load(); } finally { if (runController.current === controller) runController.current = undefined; setBusy(false); } }} /> : null}
    {busy && latestAttempt?.status === "prepared" ? <section className="appeal-running" role="status"><span className="runtime-pulse" aria-hidden="true"/><div><strong>{c(props.language, "Second opinion is running", "第二意见正在运行")}</strong><p>{c(props.language, "The original verdict and rationale were excluded. You can cancel this attempt without deleting the appeal.", "原 verdict 与 rationale 已排除。你可以取消本次尝试，Appeal 不会被删除。")}</p></div><Button type="button" variant="danger" onClick={() => { void (async () => { try { const current = await researchRoomApi.researchObject("appeal", detail.id) as AppealDetailDto; const attempt = current.attempts.at(-1); if (attempt) { const cancelled = await researchRoomApi.cancelCorrectionAppealSecondOpinion(props.projectId, detail.id, current.version, attempt.id); runController.current?.abort(); setDetail(cancelled); setPrepared(undefined); } } catch (error) { props.onError(error); } })(); }}>{c(props.language, "Cancel attempt", "取消尝试")}</Button></section> : null}
    {detail.latestComparison ? <section className="appeal-comparison"><div className="section-heading"><h2>{c(props.language, "Deterministic comparison", "确定性比较")}</h2><StatusBadge tone={detail.latestComparison.nonRedundantIncrement === "present" ? "ready" : "warning"}>{displayScalar(detail.latestComparison.nonRedundantIncrement, "unproven")}</StatusBadge></div><p>{c(props.language, "This compares explicit result fields. It is evidence for your decision, not an automatic verdict.", "这里比较明确的结果字段；它是供你裁决的证据，不是自动 verdict。")}</p><div className="comparison-grid">{["relation", "newEvidence", "missingContextChange", "redundantRestatement", "alternativeExplanation", "unresolvedConflict", "insufficientForComparison"].map((key) => <div key={key}><small>{key}</small><strong>{displayScalar(detail.latestComparison?.[key])}</strong></div>)}</div><details><summary>{c(props.language, "Result, reasons, and source references", "结果、理由与来源引用")}</summary><pre className="structured-value">{pretty({ result: detail.attempts.at(-1)?.result, comparison: detail.latestComparison })}</pre></details></section> : null}
    {detail.attempts.length ? <section className="structured-section"><h2>{c(props.language, "Second-opinion attempts", "第二意见尝试")}</h2><ol className="attempt-list">{detail.attempts.map((attempt) => <li key={attempt.id}><span><strong>#{attempt.ordinal} · {attempt.status}</strong><small>{attempt.id} · {date(props.language, attempt.preparedAt)}</small></span><StatusBadge tone={attempt.status === "completed" ? "ready" : attempt.status === "failed" || attempt.status === "unknown" ? "danger" : attempt.status === "cancelled" ? "warning" : "neutral"}>{attempt.failure ?? attempt.status}</StatusBadge></li>)}</ol></section> : null}
    {detail.availableActions.includes("resolve") || detail.status === "resolved" ? <ResolutionGate language={props.language} detail={detail} busy={busy} onResolve={async (kind, reason) => { await mutate(() => researchRoomApi.resolveCorrectionAppeal(props.projectId, detail.id, detail.version, kind, reason), c(props.language, "Your appeal resolution was appended with a durable receipt.", "你的 Appeal 裁决已追加写入，并生成持久 Receipt。")); }} /> : null}
    <section className="structured-section"><h2>{c(props.language, "Append-only history", "追加式历史")}</h2><details><summary>{detail.statements.length} {c(props.language, "statement versions", "个陈述版本")}</summary><pre className="structured-value">{pretty(detail.statements)}</pre></details><details><summary>{detail.timeline.length} {c(props.language, "state transitions", "个状态迁移")}</summary><pre className="structured-value">{pretty(detail.timeline)}</pre></details></section>
  </section>;
}

function ContextSelection({ language, projectId, busy, retry, onPrepare }: { readonly language: AppLanguage; readonly projectId: string; readonly busy: boolean; readonly retry: boolean; readonly onPrepare: (selection: { readonly includeBrief: boolean; readonly decisionIds: readonly string[]; readonly issueIds: readonly string[]; readonly evidenceIds: readonly string[] }) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [includeBrief, setIncludeBrief] = useState(true);
  const [decisions, setDecisions] = useState<readonly { id: string; label: string }[]>([]);
  const [issues, setIssues] = useState<readonly { id: string; label: string }[]>([]);
  const [evidence, setEvidence] = useState<readonly { id: string; label: string }[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => { if (!open) return; void Promise.all([researchRoomApi.listResearchObjects("decision", { limit: 50 }), researchRoomApi.listResearchObjects("issue", { limit: 50 }), researchRoomApi.listResearchObjects("evidence", { limit: 50 })]).then(([decisionPage, issuePage, evidencePage]) => { setDecisions(decisionPage.items.filter((item) => item.kind === "decision").map((item) => ({ id: item.id, label: item.statement }))); setIssues(issuePage.items.filter((item) => item.kind === "issue").map((item) => ({ id: item.id, label: item.summary }))); setEvidence(evidencePage.items.filter((item) => item.kind === "evidence").map((item) => ({ id: item.id, label: item.summary }))); }); }, [open, projectId]);
  function toggle(id: string) { setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  const groups = useMemo(() => [{ kind: "decision", items: decisions }, { kind: "issue", items: issues }, { kind: "evidence", items: evidence }] as const, [decisions, issues, evidence]);
  return <section className="context-selection"><div className="section-heading"><div><h2>{retry ? c(language, "Retry with a new Manifest", "使用新 Manifest 重试") : c(language, "Optional independent second opinion", "可选的独立第二意见")}</h2><p>{c(language, "Choose only the allowed project context. The original verdict, rationale, confidence, raw response, and other agents are always excluded.", "只选择允许发送的项目上下文。原 verdict、rationale、confidence、原始响应及其他 Agent 始终被排除。")}</p></div><Button type="button" variant="quiet" onClick={() => { setOpen((value) => !value); }}>{open ? c(language, "Close selection", "关闭选择") : c(language, "Choose context", "选择上下文")}</Button></div>{open ? <div className="context-object-picker"><label className="check-line"><input type="checkbox" checked={includeBrief} onChange={(event) => { setIncludeBrief(event.target.checked); }} />{c(language, "Include the active Research Brief", "包含 Active Research Brief")}</label>{groups.map((group) => <fieldset key={group.kind}><legend>{group.kind}</legend>{group.items.length ? group.items.map((item) => <label className="check-line" key={item.id}><input type="checkbox" checked={selected.has(item.id)} onChange={() => { toggle(item.id); }} /><span><strong>{item.label}</strong><small>{item.id}</small></span></label>) : <p className="empty-state">{c(language, `No ${group.kind} objects available.`, `没有可选的 ${group.kind} 对象。`)}</p>}</fieldset>)}<Button type="button" disabled={busy} onClick={() => { void onPrepare({ includeBrief, decisionIds: decisions.filter((item) => selected.has(item.id)).map((item) => item.id), issueIds: issues.filter((item) => selected.has(item.id)).map((item) => item.id), evidenceIds: evidence.filter((item) => selected.has(item.id)).map((item) => item.id) }); }}>{c(language, "Build exact Manifest — do not send", "生成精确 Manifest — 暂不发送")}</Button></div> : null}</section>;
}

function ManifestConfirmation({ language, prepared, acknowledged, onAcknowledged, busy, onCancel, onSend }: { readonly language: AppLanguage; readonly prepared: PreparedAppealSecondOpinionDto; readonly acknowledged: boolean; readonly onAcknowledged: (value: boolean) => void; readonly busy: boolean; readonly onCancel: () => void; readonly onSend: () => Promise<void> }) {
  return <section className="manifest-confirmation" aria-labelledby="appeal-manifest-title"><header><div><p className="eyebrow">EXACT CONTEXT MANIFEST</p><h2 id="appeal-manifest-title">{c(language, "Review before any network send", "任何网络发送前先核对")}</h2></div><StatusBadge tone="warning">{c(language, "not sent", "尚未发送")}</StatusBadge></header><div className="manifest-metrics"><div><small>{c(language, "Endpoint", "端点")}</small><strong>{prepared.providerPreview.endpoint}</strong></div><div><small>{c(language, "Request bytes", "请求字节")}</small><strong>{prepared.providerPreview.requestBodyBytes}</strong></div><div><small>{c(language, "Response cap", "响应上限")}</small><strong>{prepared.providerPreview.responseLimitBytes}</strong></div><div><small>{c(language, "Retry / redirect", "重试 / 重定向")}</small><strong>0 / error</strong></div></div><div className="manifest-columns"><section><h3>{c(language, "Included fields", "包含字段")}</h3><ul>{prepared.manifest.includedFields.map((field) => <li key={field}>{field}</li>)}</ul><h3>{c(language, "Included object snapshots", "包含的对象快照")}</h3>{prepared.manifest.includedObjects.length ? <ol>{prepared.manifest.includedObjects.map((object) => <li key={`${object.kind}-${object.id}`}><strong>{object.kind} · {object.id}</strong><small>v{object.version} · {object.hash.slice(0, 16)}…</small><pre>{pretty(object.fields)}</pre></li>)}</ol> : <p className="empty-state">{c(language, "No optional project object selected.", "未选择可选项目对象。")}</p>}</section><section className="manifest-exclusions"><h3>{c(language, "Always excluded", "始终排除")}</h3><ul>{prepared.manifest.excludedFields.map((field) => <li key={field}>{field}</li>)}</ul><dl><dt>{c(language, "Token estimate", "Token 估算")}</dt><dd>{displayScalar(prepared.manifest.tokenEstimate.status, "unavailable")}</dd><dt>{c(language, "Cost estimate", "成本估算")}</dt><dd>{displayScalar(prepared.manifest.costEstimate.status, "unavailable")}</dd><dt>Manifest hash</dt><dd><code>{prepared.manifest.canonicalHash}</code></dd><dt>State binding</dt><dd><code>{prepared.manifest.stateBindingHash}</code></dd></dl></section></div><label className="check-line manifest-ack"><input type="checkbox" checked={acknowledged} onChange={(event) => { onAcknowledged(event.target.checked); }} />{c(language, "I reviewed the exact included and excluded context. Send this one bounded request to the independent connection.", "我已核对精确的包含与排除内容；同意向独立连接发送这一次受限请求。")}</label><div className="button-row"><Button type="button" disabled={busy || !acknowledged} onClick={() => { void onSend(); }}>{c(language, "Confirm and send once", "确认并发送一次")}</Button><Button type="button" variant="quiet" disabled={busy} onClick={onCancel}>{c(language, "Cancel before send", "发送前取消")}</Button></div></section>;
}

function ResolutionGate({ language, detail, busy, onResolve }: { readonly language: AppLanguage; readonly detail: AppealDetailDto; readonly busy: boolean; readonly onResolve: (kind: AppealResolutionKindDto, reason: string) => Promise<void> }) {
  const [kind, setKind] = useState<AppealResolutionKindDto>("defer_insufficient_evidence"); const [reason, setReason] = useState(""); const [acknowledged, setAcknowledged] = useState(false);
  if (detail.status === "resolved") return <section className="resolution-gate resolved"><StatusBadge tone="ready">resolved</StatusBadge><h2>{c(language, "User resolution receipt", "用户裁决 Receipt")}</h2><p>{c(language, "The resolution is append-only. A later appeal forms a new lineage record instead of overwriting this one.", "裁决为追加写入；后续申诉会形成新的 lineage 记录，而不是覆盖本条。")}</p><pre className="structured-value">{pretty(detail.resolutions.at(-1))}</pre></section>;
  return <section className="resolution-gate"><p className="eyebrow">FINAL USER AUTHORITY</p><h2>{c(language, "Resolve this appeal", "裁决此 Appeal")}</h2><p>{c(language, "Read the original record, any independent result, and the deterministic comparison. The selection below is your decision alone.", "请核对原记录、独立结果及确定性比较。下面的选择只代表你的决定。")}</p><label>{c(language, "Resolution", "裁决")}<select value={kind} onChange={(event) => { setKind(event.target.value as AppealResolutionKindDto); }}>{RESOLUTIONS.map((value) => <option key={value}>{value}</option>)}</select></label><label>{c(language, "Public reason", "公开理由")}<textarea value={reason} maxLength={8192} onChange={(event) => { setReason(event.target.value); }} /></label><label className="check-line"><input type="checkbox" checked={acknowledged} onChange={(event) => { setAcknowledged(event.target.checked); }} />{c(language, "I am resolving this appeal as the research owner; no model chose this disposition.", "我以研究所有者身份裁决此 Appeal；该处置并非由模型选择。")}</label><Button type="button" disabled={busy || !acknowledged || !reason.trim()} onClick={() => { void onResolve(kind, reason.trim()); }}>{c(language, "Confirm user resolution", "确认用户裁决")}</Button></section>;
}
