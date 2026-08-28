import { useEffect, useMemo, useRef, useState } from "react";
import { researchRoomApi } from "../../api/client.js";
import type {
  AnalyzedReviewDto,
  AppLanguage,
  ClosedExternalAppPilotDto,
  ClosedExternalAppPilotStatusDto,
  ClosedPilotEvidenceDto,
  ClosedPilotManifestDto,
  CodexHostStatusDto,
  DispositionKind,
  PreparedReviewDto,
  ProjectMemoryItemDto,
} from "../../api/dto.js";
import { localizedError } from "../../i18n/copy.js";
import { Button } from "../primitives/Button.js";
import { StatusBadge } from "../primitives/StatusBadge.js";
import type { InspectorSelection } from "./ContextInspector.js";
import { StateNotice } from "./StateNotice.js";
import { WorkspaceHeader } from "./WorkspaceHeader.js";

interface ExternalAppPilotWorkspaceProps {
  readonly language: AppLanguage;
  readonly projectId: string;
  readonly pilotId?: string;
  readonly onNavigate: (href: string) => void;
  readonly onInspect: (selection: InspectorSelection) => void;
  readonly onError: (error: unknown) => void;
  readonly onNotice: (message: string, tone?: "ready" | "warning" | "danger") => void;
  readonly onAuthorityChanged: () => Promise<void>;
}

type PilotPurpose = "candidate_generation" | "continuity_check";
type NoticeTone = "neutral" | "ready" | "working" | "warning" | "danger";

const RUNNING = new Set<ClosedExternalAppPilotStatusDto>(["launching", "running", "continuity_check_running"]);
const STOPPED = new Set<ClosedExternalAppPilotStatusDto>(["stale", "expired", "cancelled", "failed", "interrupted_unknown"]);
const FEEDBACK_CODES = ["useful", "not useful", "too much setup", "context incorrect", "context disclosure unclear", "candidate redundant", "candidate unsafe or misleading", "stopped before completion"] as const;
const CAPABILITY_LABELS = Object.freeze({
  start: Object.freeze({ en: "Start", "zh-CN": "启动" }),
  structuredOutput: Object.freeze({ en: "Structured output", "zh-CN": "结构化输出" }),
  mcp: Object.freeze({ en: "Read-only MCP", "zh-CN": "只读 MCP" }),
  readOnlySandbox: Object.freeze({ en: "Read-only sandbox", "zh-CN": "只读 Sandbox" }),
  cancellation: Object.freeze({ en: "Cancellation", "zh-CN": "取消" }),
  contextIsolation: Object.freeze({ en: "Context isolation", "zh-CN": "Context 隔离" }),
}) satisfies Readonly<Record<keyof CodexHostStatusDto["capabilities"], Readonly<Record<AppLanguage, string>>>>;

function words(language: AppLanguage) {
  return language === "en" ? {
    eyebrow: "EXTERNAL APP / CODEX", title: "Closed Codex External App Pilot", description: "Hand one exact, disclosed project context to a temporary read-only Codex task, then bring one proposal back through Sestina Review and the user Authority Gate.",
    boundaryTitle: "A bounded host handoff, not a second source of truth", boundaryBody: "Codex may read only this confirmed frozen context and propose one candidate. It cannot write the project, accept its own output, change Authority, or reuse hidden state in the continuity check.",
    providerDifference: "Codex Host is separate from the Sestina Provider connection. Configuration, host verification, and a real Pilot run are three different facts.",
    create: "Start a closed Pilot", newPilot: "Start another Pilot", refresh: "Refresh", loading: "Loading the current Pilot…", retryLoad: "Retry loading", history: "Recent Pilots", open: "Open",
    preflight: "1 · Host preflight", host: "Codex Host", available: "available", unavailable: "unavailable", supported: "Supported version", verified: "Last explicit verification", never: "not verified", capabilities: "Observed capability matrix", configSeparate: "Static configuration does not prove a real host run.",
    task: "Current research task", project: "Current project", brief: "Current Brief", episode: "Current Episode", calls: "Call budget", sandbox: "Sandbox", projectWrite: "Project write", externalCall: "External model service", cancelScope: "Cancellation", failureContraction: "Failure contraction", preflightBody: "The host is ephemeral, read-only, invocation-bound and explicitly confirmed. No daemon, fallback, global Codex configuration change, or Sestina Provider call is part of this Pilot.",
    manifest: "2 · Exact Context Manifest", manifestBody: "What leaves this device is the UTF-8 payload below—no other project context is authorized. Working Memory remains zero unless you select an eligible item for this attempt.", prepare: "Prepare exact Manifest", prepareContinuity: "Prepare fresh-session Manifest", included: "Included", excluded: "Excluded", source: "Source", sensitivity: "Sensitivity", bytes: "Actual UTF-8 bytes", hash: "Payload hash", expires: "Confirmation expires", exactPayload: "Exact bytes that will be sent", selectedMemory: "Working Memory selected for this invocation", zeroMemory: "Zero items selected by default", memoryEmpty: "No active explicit-manifest-only memory item is eligible.", confirmContext: "Confirm this exact payload", staleWarning: "Any project, source, host, or payload change invalidates this confirmation.",
    runtime: "3 · Bounded runtime", runtimeBody: "A confirmed attempt launches one official Codex executable with --ephemeral, read-only sandbox, invocation-only MCP, bounded output and timeout. No retries are automatic.", launch: "Launch confirmed Codex task", cancel: "Cancel running task", running: "Codex is running", resultPending: "The process is bounded and can be cancelled. No candidate is committed until validation completes.", callsObserved: "MCP calls observed", usage: "Usage", unavailableUsage: "unavailable", remaining: "remaining",
    candidate: "4 · Candidate", noCandidate: "No candidate has been committed.", candidateBody: "The result is model_proposed and cannot mutate Authority. Import is not acceptance: it only binds this content to the existing Sestina Review.", materialDelta: "Material delta", preserved: "Preserved Decisions", affected: "Affected Issues", unknowns: "Unknowns", evidence: "Evidence used", reject: "Reject and close", import: "Import as non-authoritative candidate", staleCandidate: "This candidate is stale and cannot be imported.",
    review: "5 · Sestina Review and user disposition", reviewBody: "The existing Review computes deterministic findings and remains ledger_only without a configured Sestina Provider. Only the user can commit a legal disposition and create the Receipt/Trace.", restoreReview: "Restore bound Review", analyze: "Run existing Sestina Review", ledger: "ledger_only", reason: "Public disposition reason", modified: "Modified proposal", redirect: "Redirected research question", accepted: "Accept", rejected: "Reject", modifiedAccepted: "Accept modified", deferred: "Defer", directionChanged: "Change direction", semanticRequired: "Accept, modify, or direction change requires the existing semantic-ready Review contract. Reject and defer remain available in ledger_only.", receipt: "Open Receipt / Trace",
    continuity: "6 · New-session continuity check", continuityBody: "This starts a new ephemeral session with a new invocation identity. It reads the updated canonical Project State; it receives neither the first session's hidden state nor its complete output.", continuityClaim: "Passing proves only that a new real Codex session read the correct updated Sestina state—not that the model learned, the research is correct, or external users find value.",
    close: "7 · Close and local evidence", closeBody: "Record optional local feedback, close the Pilot, and export a minimal evidence report without research text, candidate text, paths, credentials, raw JSONL, or hidden reasoning.", feedback: "Optional result feedback", note: "Optional local note (excluded from the evidence export)", saveFeedback: "Save local feedback", closePilot: "Close Pilot", export: "Export minimal evidence report", evidenceLevel: "Evidence class", finalOutcome: "Stable outcome",
    now: "What happens now", leaves: "What leaves this device", who: "Sent to", can: "Host can", cannot: "Host cannot", written: "Already written", notWritten: "Not written", next: "Next user action", currentState: "Current Pilot state", inspect: "Inspect canonical Pilot trace", disclosure: "Codex may use an external model service for this explicitly confirmed call.",
  } : {
    eyebrow: "外部 APP / CODEX", title: "封闭式 Codex 外部 App Pilot", description: "把一份精确、已披露的项目上下文交给临时只读 Codex 任务，再将一条建议带回 Sestina Review 和用户 Authority Gate。",
    boundaryTitle: "这是有界宿主交接，不是第二套真相", boundaryBody: "Codex 只能读取本次确认的冻结上下文并提出一条 candidate；它不能写项目、接受自己的输出、改变 Authority，也不能在连续性复核中复用隐藏状态。",
    providerDifference: "Codex Host 与 Sestina Provider Connection 相互独立；静态配置、真实宿主验证和一次真实 Pilot run 是三种不同事实。",
    create: "启动封闭式 Pilot", newPilot: "启动另一个 Pilot", refresh: "刷新", loading: "正在读取当前 Pilot…", retryLoad: "重新读取", history: "最近 Pilot", open: "打开",
    preflight: "1 · 宿主预检", host: "Codex Host", available: "可用", unavailable: "不可用", supported: "支持版本", verified: "最近显式验证", never: "未验证", capabilities: "能力实测矩阵", configSeparate: "静态配置不能证明真实宿主已经运行。",
    task: "当前研究任务", project: "当前项目", brief: "当前 Brief", episode: "当前 Episode", calls: "调用预算", sandbox: "Sandbox", projectWrite: "项目写入", externalCall: "外部模型服务", cancelScope: "取消范围", failureContraction: "失败收缩", preflightBody: "宿主是临时、只读、仅限本次 invocation 且需明确确认的；本 Pilot 不包含 daemon、fallback、全局 Codex 配置修改或 Sestina Provider 调用。",
    manifest: "2 · 精确 Context Manifest", manifestBody: "离开本机的是下方这份 UTF-8 payload；除此之外没有其他项目内容被授权。Working Memory 默认保持零，只有你为本次调用逐项选择合格内容才会进入。", prepare: "生成精确 Manifest", prepareContinuity: "生成全新会话 Manifest", included: "包含", excluded: "排除", source: "来源", sensitivity: "敏感性", bytes: "实际 UTF-8 字节", hash: "Payload hash", expires: "确认过期时间", exactPayload: "将实际发送的精确字节", selectedMemory: "本次 invocation 选择的 Working Memory", zeroMemory: "默认选择为零", memoryEmpty: "当前没有 active 且 explicit-manifest-only 的合格记忆项。", confirmContext: "确认这一份精确 payload", staleWarning: "项目、来源、宿主或 payload 的任何变化都会使本次确认失效。",
    runtime: "3 · 有界运行", runtimeBody: "已确认的 attempt 只启动一次官方 Codex executable，并使用 --ephemeral、只读 sandbox、invocation-only MCP、有界输出与 timeout；不会自动重试。", launch: "启动已确认的 Codex 任务", cancel: "取消运行任务", running: "Codex 正在运行", resultPending: "进程有明确边界且可以取消；验证完成前不会提交任何 candidate。", callsObserved: "已观察 MCP 调用", usage: "Usage", unavailableUsage: "不可用", remaining: "剩余",
    candidate: "4 · Candidate", noCandidate: "尚未提交 candidate。", candidateBody: "结果的 Authority 是 model_proposed，不能修改 Authority。导入不等于接受：它只会把内容绑定到现有 Sestina Review。", materialDelta: "实质增量", preserved: "保留的 Decision", affected: "受影响 Issue", unknowns: "未知项", evidence: "使用的 Evidence", reject: "拒绝并关闭", import: "导入为非权威候选", staleCandidate: "该 candidate 已陈旧，不能导入。",
    review: "5 · Sestina Review 与用户处置", reviewBody: "复用既有 Review 计算确定性 Finding；未配置 Sestina Provider 时诚实保持 ledger_only。只有用户可以提交合法处置并形成 Receipt/Trace。", restoreReview: "恢复已绑定 Review", analyze: "运行既有 Sestina Review", ledger: "ledger_only", reason: "公开处置理由", modified: "修改后的建议", redirect: "改向后的研究问题", accepted: "接受", rejected: "拒绝", modifiedAccepted: "修改后接受", deferred: "暂缓", directionChanged: "改变方向", semanticRequired: "接受、修改或改向仍受既有 semantic-ready Review 合同约束；ledger_only 下保留拒绝和暂缓。", receipt: "打开 Receipt / Trace",
    continuity: "6 · 全新会话连续性复核", continuityBody: "这会启动一个新的 ephemeral 会话和新的 invocation identity，读取更新后的 canonical Project State；它不会收到第一次会话的隐藏状态或完整输出。", continuityClaim: "通过只证明新的真实 Codex 会话读到了更新后正确的 Sestina 状态；不证明模型已经学习、研究正确或外部用户有价值。",
    close: "7 · 关闭与本地证据", closeBody: "记录可选的项目本地反馈，关闭 Pilot，并导出不含研究正文、candidate 正文、路径、凭据、原始 JSONL 或隐藏推理的最小证据。", feedback: "可选结果反馈", note: "可选本地备注（不进入 evidence export）", saveFeedback: "保存本地反馈", closePilot: "关闭 Pilot", export: "导出最小证据报告", evidenceLevel: "证据类别", finalOutcome: "稳定结果",
    now: "现在会发生什么", leaves: "哪些内容会离开本机", who: "发送给谁", can: "宿主能做什么", cannot: "宿主不能做什么", written: "已经写入", notWritten: "尚未写入", next: "用户下一步", currentState: "当前 Pilot 状态", inspect: "检查 canonical Pilot trace", disclosure: "本次经明确确认的调用可能由 Codex 使用外部模型服务。",
  };
}

function tone(status?: ClosedExternalAppPilotStatusDto): NoticeTone {
  if (!status) return "neutral";
  if (["preflight_ready", "context_confirmed", "candidate_confirmation_required", "continuity_check_ready", "continuity_verified", "closed"].includes(status)) return "ready";
  if (RUNNING.has(status)) return "working";
  if (["failed", "blocked_host_unavailable"].includes(status)) return "danger";
  if (["stale", "expired", "cancelled", "interrupted_unknown", "user_disposition_required"].includes(status)) return "warning";
  return "neutral";
}

function memoryLabel(item: ProjectMemoryItemDto): string {
  if (!item.content) return item.id;
  if ("term" in item.content) return `${item.content.term} — ${item.content.definition}`;
  if ("purpose" in item.content) return item.content.purpose;
  return item.content.text;
}

function latestManifest(pilot: ClosedExternalAppPilotDto | undefined): ClosedPilotManifestDto | undefined {
  return pilot?.manifests.at(-1);
}

function stageFacts(language: AppLanguage, pilot: ClosedExternalAppPilotDto | undefined): { written: string; notWritten: string; next: string } {
  if (!pilot) return language === "en" ? { written: "No Pilot record yet.", notWritten: "No context, candidate, Review, or Receipt.", next: "Start one closed Pilot." } : { written: "尚无 Pilot 记录。", notWritten: "尚无 Context、candidate、Review 或 Receipt。", next: "启动一次封闭式 Pilot。" };
  const candidate = pilot.candidate?.status === "received" ? (language === "en" ? "Validated candidate only." : "仅已验证 candidate。") : pilot.candidate?.status === "imported" ? (language === "en" ? "Candidate imported and Review bound." : "candidate 已导入且 Review 已绑定。") : "";
  const manifestPurpose = pilot.manifests.at(-1)?.purpose;
  if (pilot.status === "closed") return language === "en" ? { written: `Closed Pilot, ${pilot.disposition ? "user disposition and Receipt" : "candidate rejection"}.`, notWritten: "No host authority action or automatic follow-up.", next: "Export the minimal local evidence report." } : { written: `Pilot 已关闭；${pilot.disposition ? "用户处置与 Receipt 已记录" : "candidate 已拒绝"}。`, notWritten: "没有宿主 Authority 动作或自动后续。", next: "导出最小本地证据。" };
  if (pilot.status === "continuity_verified") return language === "en" ? { written: "User disposition, Receipt/Trace, and fresh-session host observation.", notWritten: "No claim of semantic correctness or external-user value.", next: "Record optional feedback and close." } : { written: "用户处置、Receipt/Trace 与全新会话宿主观察已记录。", notWritten: "未写入语义正确性或外部用户价值结论。", next: "可记录反馈并关闭。" };
  if (pilot.status === "continuity_check_ready") return language === "en" ? { written: "The user disposition and Receipt/Trace are committed to canonical state.", notWritten: "No continuity evidence from a second, fresh Codex session yet.", next: "Prepare and confirm the fresh-session Manifest, then explicitly launch it." } : { written: "用户处置与 Receipt/Trace 已写入 canonical state。", notWritten: "尚无第二个全新 Codex 会话的连续性证据。", next: "生成并确认全新会话 Manifest，再明确启动。" };
  if (pilot.status === "user_disposition_required") return language === "en" ? { written: "Candidate import and Review binding.", notWritten: "No user disposition or Authority change.", next: "Run or restore Review, then choose a legal disposition." } : { written: "candidate 导入与 Review 绑定。", notWritten: "尚无用户处置或 Authority 改变。", next: "运行或恢复 Review，再选择合法处置。" };
  if (pilot.status === "review_required") return language === "en" ? { written: "The candidate is imported as a non-authoritative revision.", notWritten: "No Review binding, user disposition, or Authority change is committed yet.", next: "Restore the deterministic binding step; do not treat import as acceptance." } : { written: "candidate 已作为非权威 revision 导入。", notWritten: "尚未提交 Review 绑定、用户处置或 Authority 改变。", next: "恢复确定性绑定步骤；不得把导入当作接受。" };
  if (pilot.status === "candidate_confirmation_required") return language === "en" ? { written: "Validated model-proposed candidate.", notWritten: "Not imported, accepted, or applied.", next: "Inspect, then reject or import." } : { written: "已验证 model-proposed candidate。", notWritten: "尚未导入、接受或应用。", next: "复核后拒绝或导入。" };
  if (pilot.status === "candidate_received") return language === "en" ? { written: "A strict model-proposed candidate is stored inside the current transaction.", notWritten: "No import, acceptance, Review, or Authority change.", next: "Complete the deterministic candidate-confirmation transition before user action." } : { written: "严格的 model-proposed candidate 已进入当前事务。", notWritten: "尚无导入、接受、Review 或 Authority 改变。", next: "先完成确定性的 candidate 确认状态转换，再允许用户操作。" };
  if (pilot.status === "context_confirmed") return language === "en" ? { written: "The exact Context confirmation is bound to this Pilot, attempt, and hash.", notWritten: "The host has not started; there is no candidate or continuity observation.", next: `Explicitly launch the confirmed ${manifestPurpose === "continuity_check" ? "fresh-session continuity" : "candidate-generation"} attempt, or leave it uncalled.` } : { written: "精确 Context 确认已绑定到这一 Pilot、attempt 与 hash。", notWritten: "宿主尚未启动，尚无 candidate 或连续性观察。", next: `明确启动已确认的${manifestPurpose === "continuity_check" ? "全新会话连续性" : "候选生成"} attempt，或保持不调用。` };
  if (pilot.status === "context_confirmation_required") return language === "en" ? { written: "The exact Manifest preview is stored; no bytes have been sent to Codex.", notWritten: "No Context authorization, host call, candidate, or continuity observation.", next: "Confirm this exact hash and attempt, or regenerate after any change." } : { written: "精确 Manifest 预览已写入；尚未向 Codex 发送任何字节。", notWritten: "尚无 Context 授权、宿主调用、candidate 或连续性观察。", next: "确认这一份 hash 与 attempt；任何变化后都应重新生成。" };
  if (pilot.status === "draft") return language === "en" ? { written: "A project-bound Pilot draft only.", notWritten: "No verified host capability, Context, candidate, Review, or Receipt.", next: "Complete the bounded Codex host preflight." } : { written: "仅已写入项目绑定的 Pilot 草稿。", notWritten: "尚无已核验宿主能力、Context、candidate、Review 或 Receipt。", next: "完成受限 Codex 宿主预检。" };
  if (pilot.status === "preflight_ready") return language === "en" ? { written: "Project-bound Pilot preflight only.", notWritten: "No context, candidate, Review, Receipt, or host call.", next: "Choose any eligible Working Memory and prepare the exact Manifest." } : { written: "仅已写入项目绑定的 Pilot 预检。", notWritten: "尚无 Context、candidate、Review、Receipt 或宿主调用。", next: "按需选择合格 Working Memory，再生成精确 Manifest。" };
  if (RUNNING.has(pilot.status)) return language === "en" ? { written: "Attempt identity and consumed confirmation.", notWritten: "No model result or candidate yet.", next: "Wait or cancel." } : { written: "attempt identity 与已消费确认。", notWritten: "尚无模型结果或 candidate。", next: "等待或取消。" };
  if (STOPPED.has(pilot.status) || pilot.status === "blocked_host_unavailable") return language === "en" ? { written: `Stable stopped state${pilot.failure ? `: ${pilot.failure.code}` : ""}.`, notWritten: "No late result, candidate, or automatic retry.", next: "Inspect the failure; explicitly prepare another bounded attempt if budget remains." } : { written: `已记录稳定停止状态${pilot.failure ? `：${pilot.failure.code}` : ""}。`, notWritten: "没有晚到结果、candidate 或自动重试。", next: "检查失败；预算允许时明确准备另一次有界 attempt。" };
  return language === "en" ? { written: `${pilot.status}${candidate ? ` · ${candidate}` : ""}`, notWritten: "No host Authority mutation.", next: "Complete the visible next stage." } : { written: `${pilot.status}${candidate ? ` · ${candidate}` : ""}`, notWritten: "没有宿主 Authority 改变。", next: "完成界面中可见的下一阶段。" };
}

export function ExternalAppPilotWorkspace(props: ExternalAppPilotWorkspaceProps) {
  const copy = words(props.language);
  const [host, setHost] = useState<CodexHostStatusDto>();
  const [pilot, setPilot] = useState<ClosedExternalAppPilotDto>();
  const [history, setHistory] = useState<readonly ClosedExternalAppPilotDto[]>([]);
  const [memory, setMemory] = useState<readonly ProjectMemoryItemDto[]>([]);
  const [selectedMemoryIds, setSelectedMemoryIds] = useState<readonly string[]>([]);
  const [prepared, setPrepared] = useState<PreparedReviewDto>();
  const [analyzed, setAnalyzed] = useState<AnalyzedReviewDto>();
  const [evidence, setEvidence] = useState<ClosedPilotEvidenceDto>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [reason, setReason] = useState("");
  const [modified, setModified] = useState("");
  const [redirect, setRedirect] = useState("");
  const [feedbackCodes, setFeedbackCodes] = useState<readonly string[]>([]);
  const [feedbackNote, setFeedbackNote] = useState("");
  const launchAbort = useRef<AbortController | undefined>(undefined);
  const pilotRef = useRef<ClosedExternalAppPilotDto | undefined>(undefined);
  pilotRef.current = pilot;

  async function load(preferredId = props.pilotId, quiet = false) {
    if (!quiet) setLoading(true);
    try {
      const [hostValue, page, memoryValue] = await Promise.all([researchRoomApi.codexHost(), researchRoomApi.listClosedExternalAppPilots(), researchRoomApi.projectMemory()]);
      const selected = preferredId ? await researchRoomApi.getClosedExternalAppPilot(preferredId) : page.items[0];
      setHost(hostValue); setHistory(page.items); setMemory(memoryValue.workingMemory.items); setPilot(selected); setLoadError(undefined);
      if (selected?.status === "closed") setEvidence(await researchRoomApi.closedExternalAppPilotEvidence(selected.id));
    } catch (error) { setLoadError(localizedError(props.language, error)); props.onError(error); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); return () => { launchAbort.current?.abort(); }; }, [props.projectId, props.pilotId]);

  async function act(work: () => Promise<ClosedExternalAppPilotDto>, notice?: string) {
    setBusy(true);
    try { const value = await work(); setPilot(value); if (notice) props.onNotice(notice, "ready"); return value; }
    catch (error) { props.onError(error); props.onNotice(localizedError(props.language, error), "danger"); return undefined; }
    finally { setBusy(false); }
  }

  async function createPilot() {
    setBusy(true);
    try {
      const value = await researchRoomApi.createClosedExternalAppPilot(); setPilot(value); setPrepared(undefined); setAnalyzed(undefined); setEvidence(undefined); setSelectedMemoryIds([]);
      props.onNavigate(`/project/external-app-pilot/${value.id}`); props.onNotice(props.language === "en" ? "Closed Pilot preflight recorded." : "封闭式 Pilot 预检已记录。", value.status === "blocked_host_unavailable" ? "warning" : "ready");
      await load(value.id, true);
    } catch (error) { props.onError(error); props.onNotice(localizedError(props.language, error), "danger"); }
    finally { setBusy(false); }
  }

  async function prepareContext(kind: PilotPurpose) {
    if (!pilot) return;
    const value = await act(() => researchRoomApi.prepareClosedExternalAppPilotContext(pilot, kind, selectedMemoryIds), props.language === "en" ? "Exact Context Manifest prepared; nothing has been sent." : "精确 Context Manifest 已生成；尚未发送任何内容。");
    if (value) setSelectedMemoryIds([]);
  }

  async function launch() {
    if (!pilot) return;
    setBusy(true);
    const controller = new AbortController(); launchAbort.current = controller;
    const poll = window.setInterval(() => { const current = pilotRef.current; if (!current) return; void researchRoomApi.getClosedExternalAppPilot(current.id).then((value) => { setPilot(value); }).catch(() => undefined); }, 500);
    try {
      const value = await researchRoomApi.launchClosedExternalAppPilot(pilot, controller.signal); setPilot(value);
      props.onNotice(value.status === "candidate_confirmation_required" ? (props.language === "en" ? "One validated model-proposed candidate is ready for user review." : "一条已验证的 model-proposed candidate 正等待用户复核。") : (props.language === "en" ? "Fresh-session continuity observation completed." : "全新会话连续性观察已完成。"), "ready");
    } catch (error) { if (!controller.signal.aborted) { props.onError(error); props.onNotice(localizedError(props.language, error), "danger"); } }
    finally { window.clearInterval(poll); if (launchAbort.current === controller) launchAbort.current = undefined; setBusy(false); await load(pilot.id, true); }
  }

  async function cancel() {
    const id = pilot?.id; if (!id) return;
    setBusy(true);
    try {
      const current = await researchRoomApi.getClosedExternalAppPilot(id);
      const value = await researchRoomApi.cancelClosedExternalAppPilot(current); setPilot(value); launchAbort.current?.abort();
      props.onNotice(props.language === "en" ? "The bounded host attempt was cancelled; late output cannot reopen it." : "有界宿主 attempt 已取消；晚到输出不能重新打开它。", "warning");
    } catch (error) { props.onError(error); props.onNotice(localizedError(props.language, error), "danger"); }
    finally { setBusy(false); }
  }

  async function importCandidate() {
    if (!pilot) return; setBusy(true);
    try { const result = await researchRoomApi.importClosedExternalAppPilotCandidate(pilot); setPilot(result.pilot); setPrepared(result.review); setAnalyzed(undefined); props.onInspect({ kind: "manifest", value: result.review }); props.onNotice(props.language === "en" ? "Candidate imported without acceptance; existing Sestina Review is now bound." : "candidate 已在未接受的前提下导入；现有 Sestina Review 已绑定。", "ready"); }
    catch (error) { props.onError(error); props.onNotice(localizedError(props.language, error), "danger"); }
    finally { setBusy(false); }
  }

  async function restoreReview() {
    if (!pilot) return; setBusy(true);
    try { const result = await researchRoomApi.restoreClosedExternalAppPilotReview(pilot); setPilot(result.pilot); setPrepared(result.review); setAnalyzed(undefined); props.onNotice(props.language === "en" ? "The bound Review was restored from persisted Pilot state." : "已从持久化 Pilot 状态恢复绑定 Review。", "ready"); }
    catch (error) { props.onError(error); props.onNotice(localizedError(props.language, error), "danger"); }
    finally { setBusy(false); }
  }

  async function analyzeReview() {
    if (!pilot || !prepared) return; setBusy(true);
    try { const value = await researchRoomApi.analyzeClosedExternalAppPilotReview(pilot, prepared); setAnalyzed(value); props.onInspect({ kind: "analysis", value }); props.onNotice(props.language === "en" ? "Existing Sestina Review completed." : "现有 Sestina Review 已完成。", value.providerStatus === "semantic_ready" ? "ready" : "warning"); }
    catch (error) { props.onError(error); props.onNotice(localizedError(props.language, error), "danger"); }
    finally { setBusy(false); }
  }

  async function disposition(kind: DispositionKind) {
    if (!pilot || !analyzed || !reason.trim()) { props.onNotice(props.language === "en" ? "A public disposition reason is required." : "必须填写公开处置理由。", "danger"); return; }
    if (kind === "modified_accepted" && !modified.trim()) { props.onNotice(props.language === "en" ? "Enter the modified proposal." : "请填写修改后的建议。", "danger"); return; }
    if (kind === "direction_changed" && !redirect.trim()) { props.onNotice(props.language === "en" ? "Enter the redirected research question." : "请填写改向后的研究问题。", "danger"); return; }
    setBusy(true);
    try {
      const result = await researchRoomApi.commitClosedExternalAppPilotDisposition(pilot, analyzed, kind, reason.trim(), { ...(modified.trim() ? { modifiedProposal: modified.trim() } : {}), ...(redirect.trim() ? { redirectQuestion: redirect.trim() } : {}) });
      setPilot(result.pilot); setPrepared(undefined); setAnalyzed(undefined); setReason(""); setModified(""); setRedirect(""); await props.onAuthorityChanged(); props.onInspect({ kind: "receipt", value: result.receipt }); props.onNotice(props.language === "en" ? "User disposition committed; Receipt/Trace created." : "用户处置已提交；Receipt/Trace 已生成。", "ready");
    } catch (error) { props.onError(error); props.onNotice(localizedError(props.language, error), "danger"); }
    finally { setBusy(false); }
  }

  async function saveFeedback() {
    if (!pilot) return; await act(() => researchRoomApi.recordClosedExternalAppPilotFeedback(pilot, feedbackCodes, feedbackNote), props.language === "en" ? "Project-local feedback saved." : "项目本地反馈已保存。");
  }

  async function closePilot() {
    if (!pilot) return; const value = await act(() => researchRoomApi.closeClosedExternalAppPilot(pilot), props.language === "en" ? "Pilot closed with no next stage started." : "Pilot 已关闭，未启动任何下一阶段。"); if (value) { const exported = await researchRoomApi.closedExternalAppPilotEvidence(value.id); setEvidence(exported); await props.onAuthorityChanged(); }
  }

  async function downloadEvidence() {
    if (!pilot) return; const value = evidence ?? await researchRoomApi.closedExternalAppPilotEvidence(pilot.id); setEvidence(value);
    const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" }); const href = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = href; anchor.download = `sestina-ri52-${pilot.id}-evidence.json`; anchor.click(); URL.revokeObjectURL(href);
  }

  function inspectPilot() {
    if (!pilot) return;
    props.onInspect({ kind: "research_object", title: `${copy.host} · ${pilot.id}`, status: pilot.status, fields: [
      { label: "Authority", value: `${pilot.authority} · canMutateAuthority=${String(pilot.canMutateAuthority)}` }, { label: copy.project, value: pilot.projectId }, { label: copy.brief, value: `${pilot.brief.id} · v${pilot.brief.version}` }, { label: copy.episode, value: `${pilot.episode.id} · v${pilot.episode.version}` }, { label: copy.task, value: pilot.currentTask }, { label: copy.calls, value: `candidate ${pilot.invocationBudget.candidateAttemptsUsed}/${pilot.invocationBudget.candidateMaximum} · continuity ${pilot.invocationBudget.continuityAttemptsUsed}/${pilot.invocationBudget.continuityMaximum} · automatic 0` }, { label: "Trace", value: pilot.events.map((event) => JSON.stringify(event)).join("\n") },
    ], ...(pilot.disposition ? { relations: [{ label: copy.receipt, href: `/project/receipts/${pilot.disposition.receiptId}` }] } : {}) });
  }

  const manifest = latestManifest(pilot);
  const eligibleMemory = useMemo(() => memory.filter((item) => item.state === "active" && item.manifestEligible && item.outboundPolicy === "explicit_manifest_only"), [memory]);
  const facts = stageFacts(props.language, pilot);
  const canSemantic = analyzed?.providerStatus === "semantic_ready";
  const purpose: PilotPurpose = pilot?.disposition ? "continuity_check" : "candidate_generation";
  const attempt = pilot?.attempts.at(-1);
  const canPrepare = pilot !== undefined && (pilot.status === "preflight_ready" || pilot.status === "continuity_check_ready" || STOPPED.has(pilot.status)) && (purpose === "candidate_generation" ? pilot.invocationBudget.candidateAttemptsUsed < 2 : pilot.invocationBudget.continuityAttemptsUsed < 2);

  return <article className="object-workspace pilot-workspace" aria-labelledby="external-app-pilot-heading">
    <WorkspaceHeader id="external-app-pilot-heading" eyebrow={copy.eyebrow} title={copy.title} description={copy.description} status={<StatusBadge tone={tone(pilot?.status)}>{pilot?.status ?? "not_started"}</StatusBadge>} actions={<><Button type="button" variant="quiet" disabled={loading || busy} onClick={() => { void load(pilot?.id, true); }}>{copy.refresh}</Button><Button type="button" variant={pilot ? "secondary" : "primary"} disabled={busy} onClick={() => { void createPilot(); }}>{pilot ? copy.newPilot : copy.create}</Button></>} />

    <StateNotice ariaLabel={copy.boundaryTitle} eyebrow="AUTHORITY / DATA BOUNDARY" title={copy.boundaryTitle} description={<>{copy.boundaryBody}<br/>{copy.providerDifference}</>} status="proposal_only" tone="warning" />

    {loading && !pilot ? <StateNotice ariaLabel={copy.loading} title={copy.loading} description={copy.preflightBody} status="loading" tone="working" /> : null}
    {loadError && !pilot ? <StateNotice ariaLabel={copy.retryLoad} title={copy.retryLoad} description={loadError} status="local error" tone="danger" role="alert" actions={<Button type="button" onClick={() => { void load(); }}>{copy.retryLoad}</Button>} /> : null}

    <section className="pilot-stage pilot-stage--orientation" aria-labelledby="pilot-orientation-heading">
      <div className="section-heading"><div><p className="eyebrow">CURRENT CONSEQUENCE</p><h2 id="pilot-orientation-heading">{copy.now}</h2></div>{pilot ? <Button type="button" variant="quiet" data-inspector-return="research_object" onClick={inspectPilot}>{copy.inspect}</Button> : null}</div>
      <dl className="pilot-consequence-grid"><div><dt>{copy.currentState}</dt><dd>{pilot?.status ?? "not_started"}</dd></div><div><dt>{copy.written}</dt><dd>{facts.written}</dd></div><div><dt>{copy.notWritten}</dt><dd>{facts.notWritten}</dd></div><div><dt>{copy.next}</dt><dd>{facts.next}</dd></div></dl>
    </section>

    <section className="pilot-stage" aria-labelledby="pilot-preflight-heading">
      <div className="section-heading"><div><p className="eyebrow">PREFLIGHT / HOST</p><h2 id="pilot-preflight-heading">{copy.preflight}</h2><p>{copy.preflightBody}</p></div><StatusBadge tone={host?.availability === "available" ? "ready" : "danger"}>{host?.availability === "available" ? copy.available : copy.unavailable}</StatusBadge></div>
      <dl className="pilot-primary-facts"><div><dt>{copy.project}</dt><dd><code>{pilot?.projectId ?? props.projectId}</code></dd></div><div><dt>{copy.task}</dt><dd>{pilot?.currentTask ?? "—"}</dd></div><div><dt>{copy.brief}</dt><dd>{pilot ? `${pilot.brief.id} · v${pilot.brief.version}` : "—"}</dd></div><div><dt>{copy.episode}</dt><dd>{pilot ? `${pilot.episode.id} · v${pilot.episode.version}` : "—"}</dd></div></dl>
      <dl className="pilot-runtime-facts"><div><dt>{copy.supported}</dt><dd>{host?.supportedVersion ?? "unavailable"}</dd></div><div><dt>{copy.verified}</dt><dd>{host?.verifiedAt ?? copy.never}</dd></div><div><dt>{copy.sandbox}</dt><dd>read_only · ephemeral</dd></div><div><dt>{copy.projectWrite}</dt><dd>false</dd></div><div><dt>{copy.externalCall}</dt><dd>{copy.disclosure}</dd></div><div><dt>{copy.calls}</dt><dd>{pilot ? `candidate ${pilot.invocationBudget.candidateAttemptsUsed}/2 · continuity ${pilot.invocationBudget.continuityAttemptsUsed}/2` : "candidate 0/2 · continuity 0/2"}</dd></div><div><dt>{copy.cancelScope}</dt><dd>one active child process; late result rejected</dd></div><div><dt>{copy.failureContraction}</dt><dd>stable local failure · no send/retry/fallback</dd></div></dl>
      <p className="muted">{copy.configSeparate}</p>
      <div className="pilot-capabilities" aria-label={copy.capabilities}>{host ? Object.entries(host.capabilities).map(([name, state]) => <span key={name}><strong>{CAPABILITY_LABELS[name as keyof CodexHostStatusDto["capabilities"]][props.language]}</strong><StatusBadge tone={state === "observed" ? "ready" : state === "unavailable" ? "danger" : "warning"}>{state}</StatusBadge></span>) : <span><strong>{copy.capabilities}</strong><StatusBadge tone="warning">unproven</StatusBadge></span>}</div>
    </section>

    <section className="pilot-stage" aria-labelledby="pilot-manifest-heading">
      <div className="section-heading"><div><p className="eyebrow">DISCLOSURE / EXACT BYTES</p><h2 id="pilot-manifest-heading">{copy.manifest}</h2><p>{copy.manifestBody}</p></div>{manifest ? <StatusBadge tone={pilot?.status === "context_confirmed" ? "ready" : "warning"}>{manifest.payloadBytes} bytes</StatusBadge> : null}</div>
      {canPrepare ? <><fieldset className="pilot-memory-selection"><legend>{copy.selectedMemory}</legend><p>{copy.zeroMemory}</p>{eligibleMemory.length ? <div>{eligibleMemory.map((item) => <label key={item.id}><input type="checkbox" checked={selectedMemoryIds.includes(item.id)} disabled={busy} onChange={(event) => { setSelectedMemoryIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id)); }} /><span><strong>{memoryLabel(item)}</strong><small>{item.id} · {item.sensitivity} · {item.outboundPolicy} · v{item.version}</small></span></label>)}</div> : <p className="muted">{copy.memoryEmpty}</p>}</fieldset><Button type="button" variant="primary" disabled={busy} onClick={() => { void prepareContext(purpose); }}>{purpose === "continuity_check" ? copy.prepareContinuity : copy.prepare}</Button></> : null}
      {manifest ? <div className="pilot-manifest"><dl className="pilot-manifest-summary"><div><dt>{copy.who}</dt><dd>Codex · {manifest.disclosure.externalModelServiceMayBeCalled ? "external model service may be called" : "local only"}</dd></div><div><dt>{copy.leaves}</dt><dd>{manifest.included.map((item) => item.category).join(" · ") || "none"}</dd></div><div><dt>{copy.bytes}</dt><dd>{manifest.payloadBytes}</dd></div><div><dt>{copy.hash}</dt><dd><code>{manifest.payloadHash}</code></dd></div><div><dt>{copy.expires}</dt><dd>{manifest.expiresAt}</dd></div><div><dt>{copy.selectedMemory}</dt><dd>{manifest.workingMemorySelection.selectedIds.length} · never_send included {manifest.workingMemorySelection.neverSendIncludedCount}</dd></div><div><dt>{copy.can}</dt><dd>{manifest.disclosure.hostCan.join(" · ")}</dd></div><div><dt>{copy.cannot}</dt><dd>{manifest.disclosure.hostCannot.join(" · ")}</dd></div></dl>
        <div className="pilot-manifest-lists"><section><h3>{copy.included}</h3><ul>{manifest.included.map((item) => <li key={`${item.category}-${item.id}`}><strong>{item.category} · {item.id}</strong><span>{copy.source}: {item.source}</span><small>{copy.sensitivity}: {item.sensitivity} · {item.contentBytes} bytes</small></li>)}</ul></section><section><h3>{copy.excluded}</h3>{manifest.excluded.length ? <ul>{manifest.excluded.map((item, index) => <li key={`${item.category}-${item.id ?? index}`}><strong>{item.category}{item.id ? ` · ${item.id}` : ""}</strong><span>{item.reason}</span><small>{copy.source}: {item.source} · {copy.sensitivity}: {item.sensitivity}</small></li>)}</ul> : <p>none</p>}</section></div>
        <details className="pilot-exact-payload"><summary>{copy.exactPayload}</summary><pre>{manifest.payloadUtf8}</pre></details><p className="muted">{copy.staleWarning}</p>
        {pilot?.status === "context_confirmation_required" ? <Button type="button" variant="primary" disabled={busy} onClick={() => { void act(() => researchRoomApi.confirmClosedExternalAppPilotContext(pilot), props.language === "en" ? "Exact context confirmed; the host has not started yet." : "精确 Context 已确认；宿主尚未启动。"); }}>{copy.confirmContext}</Button> : null}
      </div> : null}
    </section>

    <section className="pilot-stage" aria-labelledby="pilot-runtime-heading">
      <div className="section-heading"><div><p className="eyebrow">RUNTIME / ONE ATTEMPT</p><h2 id="pilot-runtime-heading">{copy.runtime}</h2><p>{copy.runtimeBody}</p></div>{attempt ? <StatusBadge tone={tone(pilot?.status)}>{attempt.status} · #{attempt.ordinal}</StatusBadge> : null}</div>
      {pilot?.status === "context_confirmed" ? <Button type="button" variant="primary" disabled={busy} onClick={() => { void launch(); }}>{copy.launch}</Button> : null}
      {pilot && RUNNING.has(pilot.status) ? <StateNotice ariaLabel={copy.running} title={copy.running} description={copy.resultPending} status={pilot.status} tone="working" actions={<Button type="button" variant="danger" disabled={!busy && !RUNNING.has(pilot.status)} onClick={() => { void cancel(); }}>{copy.cancel}</Button>} /> : null}
      {attempt ? <dl className="pilot-runtime-facts"><div><dt>Attempt</dt><dd><code>{attempt.id}</code> · {attempt.kind}</dd></div><div><dt>Invocation</dt><dd><code>{attempt.invocationId ?? "not started"}</code></dd></div><div><dt>{copy.callsObserved}</dt><dd>{attempt.mcpObservation ? `health=${attempt.mcpObservation.health} · get_research_context=${attempt.mcpObservation.getResearchContext}` : "not observed"}</dd></div><div><dt>{copy.usage}</dt><dd>{attempt.usage === "unavailable" || !attempt.usage ? copy.unavailableUsage : JSON.stringify(attempt.usage)}</dd></div><div><dt>stdout / stderr</dt><dd>{attempt.stdoutBytes ?? 0} / {attempt.stderrBytes ?? 0} bounded bytes</dd></div><div><dt>{copy.remaining}</dt><dd>{attempt.kind === "candidate_generation" ? 2 - (pilot?.invocationBudget.candidateAttemptsUsed ?? 0) : 2 - (pilot?.invocationBudget.continuityAttemptsUsed ?? 0)}</dd></div></dl> : null}
      {pilot?.failure ? <StateNotice ariaLabel={pilot.failure.code} title={pilot.failure.code} description={pilot.failure.publicReason} status={pilot.status} tone={pilot.status === "cancelled" ? "warning" : "danger"} role="alert" /> : null}
    </section>

    <section className="pilot-stage" aria-labelledby="pilot-candidate-heading">
      <div className="section-heading"><div><p className="eyebrow">MODEL OUTPUT / PROPOSAL ONLY</p><h2 id="pilot-candidate-heading">{copy.candidate}</h2><p>{copy.candidateBody}</p></div><StatusBadge tone={pilot?.candidate?.status === "received" ? "warning" : pilot?.candidate?.status === "imported" ? "ready" : "neutral"}>{pilot?.candidate?.authority ?? "model_proposed"}</StatusBadge></div>
      {!pilot?.candidate ? <p className="empty-state">{copy.noCandidate}</p> : <article className="pilot-candidate"><div className="pilot-candidate__meta"><code>{pilot.candidate.id}</code><span>{pilot.candidate.status} · Authority: {pilot.candidate.authority} · canMutateAuthority=false</span><small>Host: codex · invocation {pilot.candidate.invocationId} · Manifest {pilot.candidate.manifestHash}</small></div><div className="pilot-candidate__content"><pre>{pilot.candidate.candidateMarkdown}</pre><dl><dt>{copy.materialDelta}</dt><dd>{pilot.candidate.materialDelta}</dd><dt>{copy.preserved}</dt><dd>{pilot.candidate.preservedDecisionIds.join(" · ") || "none"}</dd><dt>{copy.affected}</dt><dd>{pilot.candidate.affectedIssueIds.join(" · ") || "none"}</dd><dt>{copy.evidence}</dt><dd>{pilot.candidate.evidenceUsed.join(" · ") || "none"}</dd><dt>{copy.unknowns}</dt><dd>{pilot.candidate.unknowns.join(" · ") || "none"}</dd></dl></div>{pilot.status === "candidate_confirmation_required" ? <div className="button-row"><Button type="button" variant="danger" disabled={busy} onClick={() => { void act(() => researchRoomApi.rejectClosedExternalAppPilotCandidate(pilot), props.language === "en" ? "Candidate rejected; no Review or Authority action was created." : "candidate 已拒绝；未创建 Review 或 Authority 动作。"); }}>{copy.reject}</Button><Button type="button" variant="primary" disabled={busy || pilot.candidate.status === "stale"} onClick={() => { void importCandidate(); }}>{copy.import}</Button></div> : null}{pilot.candidate.status === "stale" ? <p role="alert">{copy.staleCandidate}</p> : null}</article>}
    </section>

    <section className="pilot-stage" aria-labelledby="pilot-review-heading">
      <div className="section-heading"><div><p className="eyebrow">EXISTING REVIEW / USER AUTHORITY</p><h2 id="pilot-review-heading">{copy.review}</h2><p>{copy.reviewBody}</p></div><StatusBadge tone={pilot?.status === "user_disposition_required" ? "warning" : "neutral"}>{analyzed?.providerStatus ?? pilot?.review?.reviewMode ?? copy.ledger}</StatusBadge></div>
      {pilot?.status === "user_disposition_required" && !prepared ? <Button type="button" variant="primary" disabled={busy} onClick={() => { void restoreReview(); }}>{copy.restoreReview}</Button> : null}
      {prepared && !analyzed ? <div className="pilot-review-binding"><dl><dt>Review</dt><dd><code>{prepared.reviewId}</code></dd><dt>Manifest</dt><dd><code>{prepared.manifestHash}</code></dd><dt>Network</dt><dd>{prepared.manifest.networkRequired ? "requires explicit Provider confirmation" : "not required · ledger_only"}</dd></dl><div className="button-row"><Button type="button" variant="quiet" data-inspector-return="manifest" onClick={() => { props.onInspect({ kind: "manifest", value: prepared }); }}>{copy.inspect}</Button><Button type="button" variant="primary" disabled={busy} onClick={() => { void analyzeReview(); }}>{copy.analyze}</Button></div></div> : null}
      {analyzed ? <div className="pilot-review-result"><div className="finding-summary">{analyzed.analysis.findings.map((finding, index) => <p key={`${finding.kind}-${index}`}><strong>{finding.kind}</strong> — {finding.summary}</p>)}</div><p><strong>{copy.materialDelta}:</strong> {analyzed.analysis.argumentDelta.genuineAdditions.join(" · ") || analyzed.analysis.argumentDelta.summary}</p><p><strong>{copy.unknowns}:</strong> {analyzed.analysis.unknowns.join(" · ") || "none"}</p><Button type="button" variant="quiet" data-inspector-return="analysis" onClick={() => { props.onInspect({ kind: "analysis", value: analyzed }); }}>{copy.inspect}</Button><div className="authority-gate"><label htmlFor="pilot-disposition-reason">{copy.reason}</label><textarea id="pilot-disposition-reason" maxLength={4096} required value={reason} onChange={(event) => { setReason(event.target.value); }} /><label htmlFor="pilot-modified-proposal">{copy.modified}</label><textarea id="pilot-modified-proposal" maxLength={16384} value={modified} onChange={(event) => { setModified(event.target.value); }} /><label htmlFor="pilot-redirect-question">{copy.redirect}</label><textarea id="pilot-redirect-question" maxLength={4096} value={redirect} onChange={(event) => { setRedirect(event.target.value); }} />{!canSemantic ? <p className="action-availability">{copy.semanticRequired}</p> : null}<div className="disposition-grid"><Button type="button" variant="primary" disabled={busy || !canSemantic} onClick={() => { void disposition("accepted"); }}>{copy.accepted}</Button><Button type="button" variant="danger" disabled={busy} onClick={() => { void disposition("rejected"); }}>{copy.rejected}</Button><Button type="button" disabled={busy || !canSemantic} onClick={() => { void disposition("modified_accepted"); }}>{copy.modifiedAccepted}</Button><Button type="button" disabled={busy} onClick={() => { void disposition("deferred"); }}>{copy.deferred}</Button><Button type="button" disabled={busy || !canSemantic} onClick={() => { void disposition("direction_changed"); }}>{copy.directionChanged}</Button></div></div></div> : null}
      {pilot?.disposition ? <StateNotice ariaLabel={copy.receipt} title={`${pilot.disposition.disposition} · ${pilot.disposition.decidedBy}`} description={`${pilot.disposition.decidedAt} · ${pilot.disposition.receiptId}`} status="committed" tone="ready" actions={<Button type="button" onClick={() => { props.onNavigate(`/project/receipts/${pilot.disposition?.receiptId}`); }}>{copy.receipt}</Button>} /> : null}
    </section>

    <section className="pilot-stage" aria-labelledby="pilot-continuity-heading">
      <div className="section-heading"><div><p className="eyebrow">FRESH INVOCATION / CANONICAL STATE</p><h2 id="pilot-continuity-heading">{copy.continuity}</h2><p>{copy.continuityBody}</p></div><StatusBadge tone={pilot?.status === "continuity_verified" || pilot?.status === "closed" && pilot.continuity ? "ready" : "neutral"}>{pilot?.continuity ? "host_observation" : "not_run"}</StatusBadge></div>
      <p className="pilot-proof-boundary">{copy.continuityClaim}</p>
      {pilot?.continuity ? <pre className="pilot-continuity-result">{JSON.stringify(pilot.continuity, null, 2)}</pre> : null}
    </section>

    <section className="pilot-stage" aria-labelledby="pilot-close-heading">
      <div className="section-heading"><div><p className="eyebrow">LOCAL EVIDENCE / NO TELEMETRY</p><h2 id="pilot-close-heading">{copy.close}</h2><p>{copy.closeBody}</p></div>{evidence ? <StatusBadge tone="ready">{evidence.stableOutcome}</StatusBadge> : null}</div>
      {pilot && ["continuity_verified", "closed"].includes(pilot.status) ? <><fieldset className="pilot-feedback"><legend>{copy.feedback}</legend><div>{FEEDBACK_CODES.map((code) => <label key={code}><input type="checkbox" checked={feedbackCodes.includes(code)} disabled={busy || pilot.status === "closed"} onChange={(event) => { setFeedbackCodes((current) => event.target.checked ? [...current, code] : current.filter((item) => item !== code)); }} />{code}</label>)}</div><label htmlFor="pilot-feedback-note">{copy.note}</label><textarea id="pilot-feedback-note" maxLength={4096} disabled={busy || pilot.status === "closed"} value={feedbackNote} onChange={(event) => { setFeedbackNote(event.target.value); }} /></fieldset><div className="button-row">{pilot.status !== "closed" ? <><Button type="button" disabled={busy} onClick={() => { void saveFeedback(); }}>{copy.saveFeedback}</Button><Button type="button" variant="primary" disabled={busy} onClick={() => { void closePilot(); }}>{copy.closePilot}</Button></> : null}<Button type="button" variant="secondary" disabled={busy} onClick={() => { void downloadEvidence(); }}>{copy.export}</Button></div></> : null}
      {evidence ? <dl className="pilot-evidence-summary"><div><dt>{copy.evidenceLevel}</dt><dd>{evidence.evidenceClass}</dd></div><div><dt>{copy.finalOutcome}</dt><dd>{evidence.stableOutcome}</dd></div><div><dt>Authority mutation</dt><dd>{evidence.authorityMutationCount}</dd></div><div><dt>Automatic retry</dt><dd>{evidence.automaticRetryCount}</dd></div><div><dt>External-user evidence</dt><dd>{evidence.externalUserEvidenceCount}</dd></div><div><dt>Context</dt><dd>{evidence.context.map((entry) => `${entry.purpose}: ${entry.bytes} bytes · ${entry.hash}`).join("\n")}</dd></div></dl> : null}
    </section>

    {history.length ? <section className="pilot-history" aria-labelledby="pilot-history-heading"><div className="section-heading"><div><p className="eyebrow">PROJECT LOCAL / BOUNDED LIST</p><h2 id="pilot-history-heading">{copy.history}</h2></div></div><ol>{history.map((item) => <li key={item.id}><div><strong>{item.status}</strong><code>{item.id}</code><small>{item.updatedAt} · {item.evidenceClass}</small></div><Button type="button" variant="quiet" onClick={() => { props.onNavigate(`/project/external-app-pilot/${item.id}`); void load(item.id); }}>{copy.open}</Button></li>)}</ol></section> : null}
  </article>;
}
