import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { researchRoomApi } from "../../api/client.js";
import type {
  AppLanguage,
  ProjectMemoryContentDto,
  ProjectMemoryItemDto,
  ProjectMemoryKindDto,
  ProjectMemoryManifestDto,
  ProjectMemoryOutboundPolicyDto,
  ProjectMemoryProjectionDto,
  ProjectMemoryRetentionDto,
  ProjectMemorySensitivityDto,
  ProjectMemoryStateDto,
  ResumeAuthorityChangeDto,
  ResumeWorkingMemoryChangeDto,
} from "../../api/dto.js";
import { Button } from "../primitives/Button.js";
import { Modal } from "../primitives/Modal.js";
import { StatusBadge } from "../primitives/StatusBadge.js";
import { StateNotice } from "./StateNotice.js";
import { WorkspaceHeader } from "./WorkspaceHeader.js";
import type { InspectorSelection } from "./ContextInspector.js";

interface ProjectMemoryWorkspaceProps {
  readonly language: AppLanguage;
  readonly projectId: string;
  readonly onNavigate: (href: string) => void;
  readonly onInspect: (selection: InspectorSelection) => void;
  readonly onError: (error: unknown) => void;
  readonly onNotice: (message: string, tone?: "ready" | "warning" | "danger") => void;
  readonly onAuthorityChanged: () => Promise<void>;
}

type MemoryAction = "confirm" | "edit" | "renew" | "retire" | "forget";
interface ActionSelection { readonly action: MemoryAction; readonly item: ProjectMemoryItemDto }

const STATES: readonly ProjectMemoryStateDto[] = ["candidate", "active", "stale", "expired", "retired", "forgotten"];
const SENSITIVITIES: readonly ProjectMemorySensitivityDto[] = ["project_private", "public", "sensitive", "secret_never_send"];
const OBJECT_ROUTES: Readonly<Record<string, string>> = Object.freeze({ brief: "/project/brief", decision: "/project/decisions", issue: "/project/issues", evidence: "/project/evidence", episode: "/project/episodes", appeal: "/project/appeals", deliberation_room: "/project/deliberation-rooms", receipt: "/project/receipts" });
const MEMORY_PAGE_SIZE = 20;

function words(language: AppLanguage) {
  return language === "en" ? {
    eyebrow: "RESUME / PROJECT MEMORY", title: "Resume with governed project memory", description: "Review the Kernel-owned Project State first, then use only the project-local working memory you explicitly created and confirmed.",
    projectState: "Project State", projectStateDescription: "Authoritative projection from the Kernel. Working memory cannot replace or change these records.", question: "Research question", task: "Current minimum task", episode: "Current Episode", activeDecisions: "Active Decisions", openIssues: "Open Issues", unproven: "Unproven",
    resume: "Resume Checkpoint", resumeDescription: "A deterministic, non-authoritative record of what you reviewed. It does not summarize chat or decide what matters.", noCheckpoint: "No checkpoint yet", noCheckpointBody: "Review the current Project State and Working Memory, then record this recovery point.", checkpoint: "Record reviewed checkpoint", changes: "Changes since the last review", unchanged: "No Project State or Working Memory versions changed since the checkpoint.",
    working: "Project Working Memory", workingDescription: "Non-authoritative, current-project-only notes and references. Saving does not mean recall; recall does not mean sharing.", create: "Create memory candidate", pin: "Pin project object as candidate", preview: "Preview candidate", previewTitle: "Confirm candidate creation", previewDescription: "Check the exact local content, source, retention and outbound policy. Creation still produces a candidate; recall remains disabled until a second explicit confirmation.", createCandidate: "Create candidate", cancel: "Cancel", loading: "Loading project continuity…", retry: "Retry", empty: "No project working memory", emptyBody: "Nothing is recalled or sent. Create a small candidate only when it will reduce recovery work.",
    kind: "Kind", content: "Content", term: "Term", definition: "Definition", purpose: "Workset purpose", refs: "Object references", refsHelp: "One per line: kind, id, version. Worksets reference objects; they do not copy them.", retention: "Retention", untilUnpinned: "Until explicitly retired", untilDate: "Until date", currentEpisode: "Current Episode", expires: "Expiry", sensitivity: "Sensitivity", outbound: "Outbound policy", neverSend: "Never send", explicitOnly: "Explicit Manifest only", reason: "Public action reason", source: "Source", directUser: "Direct user entry", candidateNotice: "Candidate only: not recalled and never included in a Manifest until you review and confirm it.",
    manifest: "Context Manifest", manifestDescription: "Select eligible active items for one request. Preview shows exact inclusion, exclusion, Provider binding and payload; Review performs the final request confirmation.", previewManifest: "Preview exact Manifest", defaultZero: "Nothing is selected by default; the Provider payload is zero until you choose eligible items.", included: "Included", excluded: "Excluded", actualPayload: "Exact request payload candidate", provider: "Provider binding", network: "Would leave this device", manifestHash: "Manifest hash", confirmManifest: "Confirm this exact selection", validateHandoff: "Use this selection in Review", rebuildManifest: "Rebuild preview", noProvider: "No Provider is configured. Manifest preparation and confirmation remain local; Review stays ledger_only and no network request occurs.",
    inspect: "Inspect source and trace", reviewConfirm: "Review & confirm", edit: "Edit", renew: "Renew", retire: "Retire", forget: "Forget irreversibly", openSource: "Open canonical source", loadMore: "Load more memory", loaded: "loaded", status: "Status", authority: "Authority", recall: "Recall", manifestEligibility: "Manifest", eligible: "eligible", ineligible: "ineligible", staleReason: "Stale reason", actionReason: "Why are you taking this action?", confirmAction: "Confirm action", forgetToken: "Type FORGET", forgetWarning: "This deletes the content and fingerprint from Sestina's current managed project memory and leaves only an opaque tombstone. A prior confirmed Provider request Receipt, manual export, or older backup may still retain a copy and must be managed separately.", editReconfirm: "Editing returns this item to candidate. It will not be recalled or sent until you confirm the new version.",
    trace: "Local receipt & action trace", hash: "Content hash", version: "Version", forgotten: "Forgotten memory tombstone", forgottenBody: "The current managed content, kind, source and fingerprint are gone. Older backups or manual exports are outside this tombstone and may still retain copies.", semanticUnchecked: "Semantic conflict unchecked", refreshed: "Project memory refreshed.", checkpointed: "Resume Checkpoint recorded.", candidateCreated: "Memory candidate created; review and confirm it before recall.", actionDone: "Project memory updated.", manifestPrepared: "Exact Context Manifest preview prepared.", manifestConfirmed: "Exact Context Manifest confirmed.", handoffValidated: "Exact payload handoff validated without changing Authority.",
  } : {
    eyebrow: "恢复 / 项目记忆", title: "使用受治理的项目记忆恢复研究", description: "先复核由 Kernel 拥有的 Project State，再仅使用你明确创建并确认的当前项目工作记忆。",
    projectState: "Project State（项目状态）", projectStateDescription: "来自 Kernel 的权威投影。工作记忆不能替代或修改这些记录。", question: "研究问题", task: "当前最小任务", episode: "当前 Episode", activeDecisions: "有效 Decision", openIssues: "开放 Issue", unproven: "未证明",
    resume: "Resume Checkpoint（恢复检查点）", resumeDescription: "记录你已经复核到哪里的一份确定性、非权威记录；它不会总结聊天，也不会替你决定什么重要。", noCheckpoint: "尚无检查点", noCheckpointBody: "复核当前 Project State 与 Working Memory 后，记录本次恢复位置。", checkpoint: "记录已复核检查点", changes: "自上次复核后的变化", unchanged: "检查点之后，Project State 与 Working Memory 的版本均未变化。",
    working: "Project Working Memory（项目工作记忆）", workingDescription: "非权威、仅限当前项目的备注与引用。保存不等于召回，召回不等于分享。", create: "创建记忆候选", pin: "把项目对象固定为候选", preview: "预览候选", previewTitle: "确认创建候选", previewDescription: "核对本地正文、来源、保留期与外发策略。创建后仍是 candidate；只有再次明确确认后才可召回。", createCandidate: "创建 candidate", cancel: "取消", loading: "正在读取项目连续性…", retry: "重试", empty: "暂无项目工作记忆", emptyBody: "当前不会召回或发送任何内容。只在能减少恢复成本时创建一条小而明确的候选。",
    kind: "类型", content: "内容", term: "术语", definition: "定义", purpose: "工作集用途", refs: "对象引用", refsHelp: "每行填写：kind, id, version。workset 只引用对象，不复制对象。", retention: "保留策略", untilUnpinned: "直到明确撤销", untilDate: "直到日期", currentEpisode: "当前 Episode", expires: "过期时间", sensitivity: "敏感性", outbound: "外发策略", neverSend: "永不发送", explicitOnly: "仅逐次显式 Manifest", reason: "公开操作理由", source: "来源", directUser: "用户直接录入", candidateNotice: "仅为 candidate：在你复核并确认前，不会被召回，也不会进入任何 Manifest。",
    manifest: "Context Manifest", manifestDescription: "为一次请求选择合格的 active 项。这里展示精确包含、排除、Provider 绑定与 payload；最终请求仍需在 Review 中确认。", previewManifest: "预览精确 Manifest", defaultZero: "默认不选任何项；只有你逐项选择合格内容后，Provider payload 才会非零。", included: "包含", excluded: "排除", actualPayload: "精确请求 payload 候选", provider: "Provider 绑定", network: "若执行请求是否离开本机", manifestHash: "Manifest hash", confirmManifest: "确认这一份精确选择", validateHandoff: "在 Review 中使用此选择", rebuildManifest: "重新生成预览", noProvider: "当前未配置 Provider。Manifest 的准备与确认仍可在本地完成；Review 保持 ledger_only，不会发生网络请求。",
    inspect: "查看来源与 Trace", reviewConfirm: "复核并确认", edit: "编辑", renew: "续期", retire: "撤销", forget: "不可逆遗忘", openSource: "打开 canonical 来源", loadMore: "加载更多记忆", loaded: "已加载", status: "状态", authority: "Authority", recall: "召回", manifestEligibility: "Manifest", eligible: "可进入", ineligible: "不可进入", staleReason: "陈旧原因", actionReason: "为什么执行这次操作？", confirmAction: "确认操作", forgetToken: "输入 FORGET", forgetWarning: "这会从 Sestina 当前受管项目记忆中删除正文与指纹，只保留不透明 tombstone。此前已确认的 Provider 请求 Receipt、手工导出或旧备份仍可能保留副本，必须另行管理。", editReconfirm: "编辑后会回到 candidate；在重新确认前不会被召回或发送。",
    trace: "本地操作凭证与 Trace", hash: "内容 hash", version: "版本", forgotten: "已遗忘记忆 tombstone", forgottenBody: "当前受管正文、类型、来源和指纹已经删除；旧备份或手工导出不受该 tombstone 控制，仍可能留有副本。", semanticUnchecked: "语义冲突未检查", refreshed: "项目记忆已刷新。", checkpointed: "Resume Checkpoint 已记录。", candidateCreated: "记忆 candidate 已创建；复核并确认后才可召回。", actionDone: "项目记忆已更新。", manifestPrepared: "精确 Context Manifest 预览已生成。", manifestConfirmed: "精确 Context Manifest 已确认。", handoffValidated: "精确 payload 交接已校验，Authority 未改变。",
  };
}

function itemTitle(item: ProjectMemoryItemDto): string {
  if (item.state === "forgotten") return item.id;
  if (item.content && "term" in item.content) return item.content.term;
  if (item.content && "purpose" in item.content) return item.content.purpose;
  return item.content && "text" in item.content ? item.content.text : item.id;
}

function itemBody(item: ProjectMemoryItemDto): string {
  if (item.state === "forgotten") return "";
  if (item.content && "term" in item.content) return item.content.definition;
  if (item.content && "purpose" in item.content) return item.content.refs.map((ref) => `${ref.kind} · ${ref.id} · v${ref.version}`).join("\n");
  return item.content && "text" in item.content ? item.content.text : "";
}

function toneForState(state: ProjectMemoryStateDto): "neutral" | "ready" | "warning" | "danger" {
  if (state === "active") return "ready";
  if (state === "candidate" || state === "stale" || state === "expired") return "warning";
  return state === "forgotten" ? "danger" : "neutral";
}

function resumeVersionText(entry: ResumeAuthorityChangeDto | ResumeWorkingMemoryChangeDto): string {
  const before = "beforeVersion" in entry ? `v${entry.beforeVersion}` : "—";
  const after = "afterVersion" in entry ? `v${entry.afterVersion}` : "—";
  return `${before} → ${after}`;
}

function resumeStateText(entry: ResumeWorkingMemoryChangeDto): string {
  const before = "beforeState" in entry ? entry.beforeState : "—";
  const after = "afterState" in entry ? entry.afterState : "—";
  return `${before} → ${after}`;
}

function sourceText(item: ProjectMemoryItemDto, direct: string): string {
  if (!item.source) return "—";
  return item.source.kind === "direct_user" ? direct : `${item.source.objectKind} · ${item.source.objectId} · v${item.source.objectVersion}`;
}

function routeForSource(item: ProjectMemoryItemDto): string | undefined {
  if (item.source?.kind !== "project_object") return undefined;
  const root = OBJECT_ROUTES[item.source.objectKind];
  return root ? `${root}${item.source.objectKind === "brief" ? "" : `/${item.source.objectId}`}` : undefined;
}

function retentionText(retention: ProjectMemoryRetentionDto | undefined, language: AppLanguage): string {
  if (!retention) return "—";
  if (retention.policy === "until_unpinned") return language === "en" ? "Until explicitly retired" : "直到明确撤销";
  if (retention.policy === "current_episode") return `Episode · ${retention.episodeId}`;
  return `${language === "en" ? "Until" : "直到"} ${new Date(retention.expiresAt).toLocaleString(language)}`;
}

export function ProjectMemoryWorkspace(props: ProjectMemoryWorkspaceProps) {
  const copy = words(props.language);
  const [projection, setProjection] = useState<ProjectMemoryProjectionDto>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [kind, setKind] = useState<ProjectMemoryKindDto>("working_hint");
  const [text, setText] = useState(""); const [term, setTerm] = useState(""); const [definition, setDefinition] = useState(""); const [purpose, setPurpose] = useState(""); const [refs, setRefs] = useState("");
  const [retentionPolicy, setRetentionPolicy] = useState<ProjectMemoryRetentionDto["policy"]>("until_unpinned");
  const [expiresAt, setExpiresAt] = useState("");
  const [sensitivity, setSensitivity] = useState<ProjectMemorySensitivityDto>("project_private");
  const [outboundPolicy, setOutboundPolicy] = useState<ProjectMemoryOutboundPolicyDto>("never_send");
  const [publicReason, setPublicReason] = useState("");
  const [createPreview, setCreatePreview] = useState(false);
  const [action, setAction] = useState<ActionSelection>(); const [actionReason, setActionReason] = useState(""); const [forgetToken, setForgetToken] = useState(""); const [editText, setEditText] = useState(""); const [editTerm, setEditTerm] = useState(""); const [editDefinition, setEditDefinition] = useState(""); const [editPurpose, setEditPurpose] = useState("");
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]); const [manifest, setManifest] = useState<ProjectMemoryManifestDto>();
  const actionTriggerRef = useRef<HTMLButtonElement>(null); const createTriggerRef = useRef<HTMLButtonElement>(null); const loadSequence = useRef(0);
  const query = useMemo(() => new URLSearchParams(window.location.search), [window.location.search]);
  const pinKind = query.get("pinKind"); const pinId = query.get("pinId"); const highlightedId = query.get("item");
  const pinning = pinKind !== null && pinId !== null && /^[a-z_]+$/u.test(pinKind) && /^[a-z]+_[0-9A-HJKMNP-TV-Z]{26}$/u.test(pinId);

  async function load(showNotice = false, targetItemId = highlightedId) {
    const sequence = ++loadSequence.current; setLoading(true); setLoadError(undefined);
    try {
      let value = await researchRoomApi.projectMemory(MEMORY_PAGE_SIZE);
      while (targetItemId && !value.workingMemory.items.some((item) => item.id === targetItemId) && value.workingMemory.nextCursor) {
        const next = await researchRoomApi.projectMemory(MEMORY_PAGE_SIZE, value.workingMemory.nextCursor);
        value = { ...next, workingMemory: { ...next.workingMemory, items: [...value.workingMemory.items, ...next.workingMemory.items] } };
      }
      if (sequence !== loadSequence.current) return;
      setProjection(value); setSelectedIds((current) => current.filter((id) => value.workingMemory.items.some((item) => item.id === id && item.manifestEligible))); if (showNotice) props.onNotice(copy.refreshed, "ready");
    } catch (error) { if (sequence === loadSequence.current) { setLoadError(error instanceof Error ? error.message : String(error)); props.onError(error); } }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }

  async function loadMore() {
    const cursor = projection?.workingMemory.nextCursor; if (!projection || !cursor) return;
    setBusy(true);
    try {
      const next = await researchRoomApi.projectMemory(MEMORY_PAGE_SIZE, cursor);
      setProjection({ ...next, workingMemory: { ...next.workingMemory, items: [...projection.workingMemory.items, ...next.workingMemory.items] } });
    } catch (error) { props.onError(error); } finally { setBusy(false); }
  }

  useEffect(() => { void load(); return () => { loadSequence.current += 1; }; }, [props.projectId]);
  useEffect(() => {
    if (!projection || !highlightedId) return;
    window.requestAnimationFrame(() => { document.querySelector<HTMLElement>(`[data-memory-id="${highlightedId}"]`)?.focus(); });
  }, [projection, highlightedId]);

  function buildRetention(): ProjectMemoryRetentionDto {
    if (retentionPolicy === "until_unpinned") return { policy: "until_unpinned" };
    if (retentionPolicy === "current_episode") {
      const episodeId = projection?.projectState.currentEpisode?.id; if (!episodeId) throw new Error(props.language === "en" ? "No current Episode is available for this retention policy." : "当前没有可用于此保留策略的 Episode。");
      return { policy: "current_episode", episodeId };
    }
    if (!expiresAt) throw new Error(props.language === "en" ? "Choose a future expiry." : "请选择未来的过期时间。");
    const date = new Date(expiresAt); if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new Error(props.language === "en" ? "Expiry must be in the future." : "过期时间必须晚于当前时间。");
    return { policy: "until_date", expiresAt: date.toISOString() };
  }

  function parseWorksetRefs() {
    const parsed = refs.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line) => {
      const [objectKind, id, rawVersion, ...extra] = line.split(/[\s,]+/u); const version = Number(rawVersion);
      if (!objectKind || !id || extra.length > 0 || !Number.isSafeInteger(version) || version < 1) throw new Error(copy.refsHelp);
      return { kind: objectKind as never, id, version };
    });
    if (!parsed.length) throw new Error(copy.refsHelp); return parsed;
  }

  function buildContent(useEdit = false): ProjectMemoryContentDto {
    if (kind === "term") { const currentTerm = useEdit ? editTerm : term; const currentDefinition = useEdit ? editDefinition : definition; if (!currentTerm.trim() || !currentDefinition.trim()) throw new Error(props.language === "en" ? "Term and definition are required." : "术语与定义均为必填。"); return { term: currentTerm.trim(), definition: currentDefinition.trim() }; }
    if (kind === "workset") { const currentPurpose = useEdit ? editPurpose : purpose; if (!currentPurpose.trim()) throw new Error(copy.refsHelp); return { purpose: currentPurpose.trim(), refs: parseWorksetRefs() }; }
    const value = useEdit ? editText : text; if (!value.trim()) throw new Error(props.language === "en" ? "Memory content is required." : "记忆内容为必填。"); return { text: value.trim() };
  }

  function validateCreate() { buildContent(); buildRetention(); if (!publicReason.trim()) throw new Error(props.language === "en" ? "A public reason is required." : "必须填写公开操作理由。"); if (sensitivity === "secret_never_send" && outboundPolicy !== "never_send") throw new Error(props.language === "en" ? "Secret content must remain never_send." : "secret 内容必须保持 never_send。"); }
  function openCreatePreview(event: SyntheticEvent<HTMLFormElement>) { event.preventDefault(); try { validateCreate(); setCreatePreview(true); } catch (error) { props.onError(error); } }
  function resetDraft() { setText(""); setTerm(""); setDefinition(""); setPurpose(""); setRefs(""); setPublicReason(""); setCreatePreview(false); }

  async function createCandidate() {
    setBusy(true);
    try {
      const input = { projectId: props.projectId, kind, content: buildContent(), retention: buildRetention(), sensitivity, outboundPolicy, publicReason: publicReason.trim() };
      const created = pinning ? await researchRoomApi.pinProjectObjectToMemory({ ...input, objectKind: pinKind, objectId: pinId }) : await researchRoomApi.createProjectMemoryCandidate(input);
      resetDraft(); await load(false, typeof created.id === "string" ? created.id : undefined); await props.onAuthorityChanged(); props.onNotice(copy.candidateCreated, "warning");
    } catch (error) { props.onError(error); } finally { setBusy(false); }
  }

  function openAction(next: MemoryAction, item: ProjectMemoryItemDto, trigger: HTMLButtonElement) {
    actionTriggerRef.current = trigger; setAction({ action: next, item }); setActionReason(""); setForgetToken(""); setKind(item.kind ?? "working_hint");
    if (item.content && "text" in item.content) setEditText(item.content.text); if (item.content && "term" in item.content) { setEditTerm(item.content.term); setEditDefinition(item.content.definition); } if (item.content && "purpose" in item.content) { setEditPurpose(item.content.purpose); setRefs(item.content.refs.map((ref) => `${ref.kind}, ${ref.id}, ${ref.version}`).join("\n")); }
    if (item.retention) { setRetentionPolicy(item.retention.policy); setExpiresAt(item.retention.policy === "until_date" ? item.retention.expiresAt.slice(0, 16) : ""); } if (item.sensitivity) setSensitivity(item.sensitivity); if (item.outboundPolicy) setOutboundPolicy(item.outboundPolicy);
  }

  async function executeAction() {
    if (!action) return; const { item } = action; if (!actionReason.trim() && action.action !== "forget") { props.onError(new Error(copy.actionReason)); return; }
    setBusy(true);
    try {
      if (action.action === "confirm") await researchRoomApi.confirmProjectMemory(props.projectId, item.id, item.version, actionReason.trim());
      else if (action.action === "edit") await researchRoomApi.editProjectMemory({ projectId: props.projectId, itemId: item.id, expectedVersion: item.version, content: buildContent(true), retention: buildRetention(), sensitivity, outboundPolicy, publicReason: actionReason.trim() });
      else if (action.action === "renew") await researchRoomApi.renewProjectMemory(props.projectId, item.id, item.version, buildRetention(), actionReason.trim());
      else if (action.action === "retire") await researchRoomApi.retireProjectMemory(props.projectId, item.id, item.version, actionReason.trim());
      else await researchRoomApi.forgetProjectMemory(props.projectId, item.id, item.version, forgetToken);
      setAction(undefined); await load(false, item.id); await props.onAuthorityChanged(); props.onNotice(copy.actionDone, action.action === "forget" ? "warning" : "ready");
    } catch (error) { props.onError(error); } finally { setBusy(false); }
  }

  async function checkpoint() { setBusy(true); try { await researchRoomApi.reviewProjectResume(props.projectId, props.language === "en" ? "User reviewed current Project State and Project Working Memory." : "用户已复核当前 Project State 与 Project Working Memory。"); await load(); props.onNotice(copy.checkpointed, "ready"); } catch (error) { props.onError(error); } finally { setBusy(false); } }
  async function prepareManifest() { setBusy(true); try { const value = await researchRoomApi.prepareProjectMemoryManifest(props.projectId, selectedIds); setManifest(value); props.onNotice(copy.manifestPrepared, "ready"); } catch (error) { props.onError(error); } finally { setBusy(false); } }
  async function confirmManifest() { if (!manifest) return; setBusy(true); try { const value = await researchRoomApi.confirmProjectMemoryManifest(props.projectId, manifest); setManifest(value); props.onNotice(copy.manifestConfirmed, "ready"); } catch (error) { setManifest(undefined); props.onError(error); } finally { setBusy(false); } }
  function useInReview() { if (!manifest) return; const query = new URLSearchParams(); for (const item of manifest.included) query.append("memory", item.itemId); props.onNavigate(`/project/review${manifest.included.length ? `?${query.toString()}` : ""}`); }

  function inspectItem(item: ProjectMemoryItemDto) {
    const sourceRoute = routeForSource(item);
    props.onInspect({ kind: "research_object", title: item.state === "forgotten" ? copy.forgotten : itemTitle(item), status: item.state, fields: item.state === "forgotten" ? [{ label: "ID", value: item.id }, { label: copy.version, value: String(item.version) }, { label: "Tombstone", value: item.tombstone ?? "—" }, { label: "Forgotten at", value: item.forgottenAt ?? "—" }] : [
      { label: "ID", value: item.id }, { label: copy.authority, value: item.authorityClass }, { label: copy.source, value: sourceText(item, copy.directUser) }, { label: copy.staleReason, value: item.staleReason ?? "—" }, { label: copy.retention, value: retentionText(item.retention, props.language) }, { label: copy.sensitivity, value: item.sensitivity ?? "—" }, { label: copy.outbound, value: item.outboundPolicy ?? "—" }, { label: copy.hash, value: item.contentHash ?? "—" }, { label: copy.semanticUnchecked, value: item.semanticConflict ?? "—" }, { label: copy.trace, value: item.transitions?.map((entry) => `${entry.at} · ${entry.actor} · ${entry.action} · ${entry.publicReason}`).join("\n") ?? "—" },
    ], ...(sourceRoute ? { relations: [{ label: copy.openSource, href: sourceRoute }] } : {}) });
  }

  function openSource(item: ProjectMemoryItemDto) {
    const sourceRoute = routeForSource(item);
    if (sourceRoute) props.onNavigate(sourceRoute);
  }

  if (loading && !projection) return <div className="object-workspace memory-workspace"><StateNotice ariaLabel={copy.loading} title={copy.loading} description={copy.projectStateDescription} tone="working" status="loading" /></div>;
  if (!projection) return <div className="object-workspace memory-workspace"><StateNotice ariaLabel={copy.retry} title={copy.retry} description={loadError ?? "Unknown local projection error"} tone="danger" role="alert" actions={<Button type="button" onClick={() => { void load(); }}>{copy.retry}</Button>} /></div>;

  const state = projection.projectState; const changes = projection.resume.changes; const changeCount = (changes?.authority.length ?? 0) + (changes?.workingMemory.length ?? 0) + (changes?.projectChanged ? 1 : 0);
  return <article className="object-workspace memory-workspace" aria-labelledby="memory-workspace-title">
    <WorkspaceHeader id="memory-workspace-title" eyebrow={copy.eyebrow} title={copy.title} description={copy.description} status={<StatusBadge tone="neutral">local · non-authoritative</StatusBadge>} actions={<Button type="button" variant="quiet" disabled={loading || busy} onClick={() => { void load(true); }}>{loading ? "…" : copy.retry}</Button>} />

    <section className="memory-project-state" aria-labelledby="memory-project-state-title">
      <div className="section-heading"><div><p className="eyebrow">KERNEL AUTHORITY</p><h2 id="memory-project-state-title">{copy.projectState}</h2><p>{copy.projectStateDescription}</p></div><StatusBadge tone="ready">kernel_authoritative_projection</StatusBadge></div>
      <dl className="memory-primary-facts"><div><dt>{copy.question}</dt><dd>{state.projectQuestion ?? "—"}</dd></div><div><dt>{copy.task}</dt><dd>{state.currentTask ?? "—"}</dd></div></dl>
      <dl className="memory-state-counts"><div><dt>{copy.episode}</dt><dd>{state.currentEpisode ? `${state.currentEpisode.status} · ${state.currentEpisode.id}` : "—"}</dd></div><div><dt>{copy.activeDecisions}</dt><dd>{state.activeDecisions.length}</dd></div><div><dt>{copy.openIssues}</dt><dd>{state.openIssues.length}</dd></div><div><dt>{copy.unproven}</dt><dd>{state.unproven.length ? state.unproven.join(" · ") : "—"}</dd></div></dl>
    </section>

    <section aria-labelledby="resume-checkpoint-title">
      <div className="section-heading"><div><p className="eyebrow">DETERMINISTIC RECOVERY</p><h2 id="resume-checkpoint-title">{copy.resume}</h2><p>{copy.resumeDescription}</p></div><Button type="button" variant="secondary" disabled={busy} onClick={() => { void checkpoint(); }}>{copy.checkpoint}</Button></div>
      {!projection.resume.checkpoint ? <StateNotice ariaLabel={copy.noCheckpoint} title={copy.noCheckpoint} description={copy.noCheckpointBody} tone="warning" status="not reviewed" /> : <div className="resume-ledger"><div><strong>{copy.changes}</strong><StatusBadge tone={changeCount ? "warning" : "ready"}>{changeCount ? `${changeCount} changed` : "current"}</StatusBadge></div><p>{changeCount ? `${changes?.projectChanged ? "Project version changed. " : ""}${changes?.authority.length ?? 0} authority bindings · ${changes?.workingMemory.length ?? 0} memory bindings` : copy.unchanged}</p>{changeCount ? <ul className="resume-change-list">{changes?.authority.map((entry) => <li key={`authority-${entry.kind}-${entry.id}`}><strong>{entry.change} · {entry.kind}</strong><code>{entry.id}</code><small>{resumeVersionText(entry)}</small></li>)}{changes?.workingMemory.map((entry) => <li key={`memory-${entry.id}`}><strong>{entry.change} · memory</strong><code>{entry.id}</code><small>{resumeVersionText(entry)} · {resumeStateText(entry)}</small></li>)}</ul> : null}<small>{projection.resume.checkpoint.reviewedAt} · {projection.resume.checkpoint.id}</small></div>}
    </section>

    <section aria-labelledby="working-memory-title">
      <div className="section-heading"><div><p className="eyebrow">NON-AUTHORITATIVE · PROJECT LOCAL</p><h2 id="working-memory-title">{copy.working}</h2><p>{copy.workingDescription}</p></div><StatusBadge tone="neutral">{projection.workingMemory.activeCount} active</StatusBadge></div>
      {pinning ? <StateNotice ariaLabel={copy.pin} title={copy.pin} description={`${pinKind} · ${pinId}`} status="explicit pin" tone="warning" /> : null}
      <form className="memory-create-form" onSubmit={openCreatePreview}>
        <div className="form-grid"><label>{copy.kind}<select value={kind} onChange={(event) => { setKind(event.target.value as ProjectMemoryKindDto); }} disabled={pinning}><option value="working_hint">working_hint</option><option value="resume_note">resume_note</option><option value="term">term</option><option value="workset">workset</option></select></label><label>{copy.sensitivity}<select value={sensitivity} onChange={(event) => { const value = event.target.value as ProjectMemorySensitivityDto; setSensitivity(value); if (value === "secret_never_send") setOutboundPolicy("never_send"); }}>{SENSITIVITIES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label></div>
        {kind === "term" ? <div className="form-grid"><label>{copy.term}<input value={term} onChange={(event) => { setTerm(event.target.value); }} maxLength={1024} /></label><label>{copy.definition}<textarea value={definition} onChange={(event) => { setDefinition(event.target.value); }} /></label></div> : kind === "workset" ? <><label>{copy.purpose}<textarea value={purpose} onChange={(event) => { setPurpose(event.target.value); }} /></label><label>{copy.refs}<textarea className="code-input" value={refs} onChange={(event) => { setRefs(event.target.value); }} placeholder="decision, rdec_…, 1" /><small>{copy.refsHelp}</small></label></> : <label>{copy.content}<textarea value={text} onChange={(event) => { setText(event.target.value); }} /></label>}
        <div className="form-grid"><label>{copy.retention}<select value={retentionPolicy} onChange={(event) => { setRetentionPolicy(event.target.value as ProjectMemoryRetentionDto["policy"]); }}><option value="until_unpinned">{copy.untilUnpinned}</option><option value="until_date">{copy.untilDate}</option><option value="current_episode" disabled={!state.currentEpisode}>{copy.currentEpisode}</option></select></label>{retentionPolicy === "until_date" ? <label>{copy.expires}<input type="datetime-local" value={expiresAt} onChange={(event) => { setExpiresAt(event.target.value); }} /></label> : <label>{copy.outbound}<select value={outboundPolicy} onChange={(event) => { setOutboundPolicy(event.target.value as ProjectMemoryOutboundPolicyDto); }} disabled={sensitivity === "secret_never_send"}><option value="never_send">{copy.neverSend}</option><option value="explicit_manifest_only">{copy.explicitOnly}</option></select></label>}</div>
        {retentionPolicy === "until_date" ? <label>{copy.outbound}<select value={outboundPolicy} onChange={(event) => { setOutboundPolicy(event.target.value as ProjectMemoryOutboundPolicyDto); }} disabled={sensitivity === "secret_never_send"}><option value="never_send">{copy.neverSend}</option><option value="explicit_manifest_only">{copy.explicitOnly}</option></select></label> : null}
        <label>{copy.reason}<textarea value={publicReason} onChange={(event) => { setPublicReason(event.target.value); }} /></label><p className="memory-candidate-note">{copy.candidateNotice}</p><div className="form-actions"><Button ref={createTriggerRef} type="submit" variant="primary" disabled={busy}>{pinning ? copy.pin : copy.preview}</Button></div>
      </form>

      {!projection.workingMemory.items.length ? <StateNotice ariaLabel={copy.empty} title={copy.empty} description={copy.emptyBody} tone="neutral" /> : <div className="memory-state-groups">{STATES.map((memoryState) => {
        const items = projection.workingMemory.items.filter((item) => item.state === memoryState); if (!items.length) return null;
        return <section key={memoryState} className="memory-state-group" aria-labelledby={`memory-state-${memoryState}`}><div className="memory-state-group__header"><h3 id={`memory-state-${memoryState}`}>{memoryState}</h3><span>{items.length}</span></div><ol className="memory-list">{items.map((item) => <li key={item.id} className="memory-item" data-state={item.state} data-memory-id={item.id} tabIndex={highlightedId === item.id ? -1 : undefined}>
          <header><div><StatusBadge tone={toneForState(item.state)}>{item.state}</StatusBadge><p className="eyebrow">{item.kind ?? copy.forgotten}</p><h3>{item.state === "forgotten" ? copy.forgotten : itemTitle(item)}</h3></div><code>v{item.version}</code></header>
          <p className={item.state === "forgotten" ? "memory-forgotten-copy" : "memory-body"}>{item.state === "forgotten" ? copy.forgottenBody : itemBody(item)}</p>
          {item.state !== "forgotten" ? <dl className="memory-item-facts"><div><dt>{copy.source}</dt><dd>{sourceText(item, copy.directUser)}</dd></div>{item.staleReason ? <div><dt>{copy.staleReason}</dt><dd>{item.staleReason}</dd></div> : null}<div><dt>{copy.retention}</dt><dd>{retentionText(item.retention, props.language)}</dd></div><div><dt>{copy.outbound}</dt><dd>{item.outboundPolicy}</dd></div><div><dt>{copy.recall}</dt><dd>{item.recallEligible ? copy.eligible : copy.ineligible}</dd></div><div><dt>{copy.manifestEligibility}</dt><dd>{item.manifestEligible ? copy.eligible : copy.ineligible}</dd></div></dl> : null}
          <div className="memory-item-actions"><Button type="button" variant="quiet" data-inspector-return="research_object" onClick={() => { inspectItem(item); }}>{copy.inspect}</Button>{item.state === "candidate" ? <Button type="button" variant="primary" disabled={busy} onClick={(event) => { openAction("confirm", item, event.currentTarget); }}>{copy.reviewConfirm}</Button> : null}{item.state !== "forgotten" && !(item.state === "stale" && item.source?.kind === "project_object") ? <Button type="button" variant="secondary" disabled={busy} onClick={(event) => { openAction("edit", item, event.currentTarget); }}>{copy.edit}</Button> : null}{["active", "stale", "expired"].includes(item.state) ? <Button type="button" variant="secondary" disabled={busy} onClick={(event) => { openAction("renew", item, event.currentTarget); }}>{copy.renew}</Button> : null}{!["retired", "forgotten"].includes(item.state) ? <Button type="button" variant="secondary" disabled={busy} onClick={(event) => { openAction("retire", item, event.currentTarget); }}>{copy.retire}</Button> : null}{item.state !== "forgotten" ? <Button type="button" variant="danger" disabled={busy} onClick={(event) => { openAction("forget", item, event.currentTarget); }}>{copy.forget}</Button> : null}{routeForSource(item) ? <Button type="button" variant="quiet" onClick={() => { openSource(item); }}>{copy.openSource}</Button> : null}</div>
          {item.state !== "forgotten" ? <details><summary>{copy.trace}</summary><ol className="timeline-list">{item.transitions?.map((entry, index) => <li key={`${entry.at}-${index}`}><div><time>{entry.at}</time><span><strong>{entry.action} · {entry.actor}</strong><small>{entry.publicReason}</small></span></div></li>)}</ol><p><strong>{copy.hash}:</strong> <code>{item.contentHash}</code></p></details> : null}
        </li>)}</ol></section>;
      })}</div>}
      {projection.workingMemory.nextCursor ? <div className="memory-pagination"><Button type="button" variant="secondary" disabled={busy} onClick={() => { void loadMore(); }}>{copy.loadMore}</Button><small>{projection.workingMemory.items.length} {copy.loaded}</small></div> : null}
    </section>

    <section aria-labelledby="memory-manifest-title" className="memory-manifest">
      <div className="section-heading"><div><p className="eyebrow">EXPLICIT REQUEST BOUNDARY</p><h2 id="memory-manifest-title">{copy.manifest}</h2><p>{copy.manifestDescription}</p></div><StatusBadge tone="warning">default · never_send</StatusBadge></div>
      <p className="memory-default-zero">{copy.defaultZero}</p>
      <fieldset className="memory-manifest-selection"><legend>{props.language === "en" ? "Items for this request" : "本次请求的记忆项"}</legend>{projection.workingMemory.items.filter((item) => item.state !== "forgotten").map((item) => <label key={item.id} className="check-line"><input type="checkbox" checked={selectedIds.includes(item.id)} disabled={!item.manifestEligible || busy} onChange={(event) => { setManifest(undefined); setSelectedIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id)); }} /><span><strong>{itemTitle(item)}</strong><small>{item.state} · {item.outboundPolicy} · {item.manifestEligible ? copy.eligible : copy.ineligible}</small></span></label>)}</fieldset>
      <div className="form-actions"><Button type="button" variant="primary" disabled={busy} onClick={() => { void prepareManifest(); }}>{copy.previewManifest}</Button>{manifest ? <Button type="button" variant="quiet" disabled={busy} onClick={() => { setManifest(undefined); }}>{copy.rebuildManifest}</Button> : null}</div>
      {manifest ? <div className="memory-manifest-preview" data-status={manifest.status}>
        <div className="memory-manifest-preview__header"><div><p className="eyebrow">{manifest.status}</p><h3>{copy.manifest}</h3></div><StatusBadge tone={manifest.status === "previewed" ? "warning" : "ready"}>{manifest.status}</StatusBadge></div>
        {manifest.provider.kind === "none" ? <StateNotice ariaLabel={copy.noProvider} title="ledger_only" description={copy.noProvider} tone="warning" /> : null}
        <dl className="memory-manifest-facts"><div><dt>{copy.provider}</dt><dd>{manifest.provider.id} · {manifest.provider.kind}</dd></div><div><dt>{copy.network}</dt><dd>{manifest.provider.networkRequired ? "yes" : "no"}</dd></div><div><dt>{copy.manifestHash}</dt><dd><code>{manifest.manifestHash}</code></dd></div><div><dt>Project State hash</dt><dd><code>{manifest.projectStateHash}</code></dd></div></dl>
        <div className="memory-manifest-columns"><div><h3>{copy.included} · {manifest.included.length}</h3>{manifest.included.length ? <ul>{manifest.included.map((item) => <li key={item.itemId}><strong>{item.kind}</strong><code>{item.itemId}</code><small>{item.contentBytes} bytes · {item.sensitivity} · leave device: {String(item.willLeaveDevice)}</small></li>)}</ul> : <p>0</p>}</div><div><h3>{copy.excluded} · {manifest.excluded.length}</h3><ul>{manifest.excluded.map((item) => <li key={item.itemId}><code>{item.itemId}</code><small>{item.state} · {item.reason}</small></li>)}</ul></div></div>
        <details><summary>{copy.actualPayload}</summary><pre>{JSON.stringify(manifest.providerPayload, null, 2)}</pre></details>
        <div className="form-actions">{manifest.status === "previewed" ? <Button type="button" variant="primary" disabled={busy} onClick={() => { void confirmManifest(); }}>{copy.confirmManifest}</Button> : null}{manifest.status === "confirmed" ? <Button type="button" variant="primary" disabled={busy} onClick={useInReview}>{copy.validateHandoff}</Button> : null}</div>
      </div> : null}
    </section>

    <Modal open={createPreview} title={copy.previewTitle} description={copy.previewDescription} closeLabel={copy.cancel} onClose={() => { setCreatePreview(false); }} returnFocusRef={createTriggerRef}>
      {createPreview ? <><dl className="memory-preview-facts"><dt>{copy.kind}</dt><dd>{kind}</dd><dt>{copy.source}</dt><dd>{pinning ? `${pinKind} · ${pinId}` : copy.directUser}</dd><dt>{copy.content}</dt><dd><pre>{JSON.stringify(buildContent(), null, 2)}</pre></dd><dt>{copy.retention}</dt><dd>{retentionText(buildRetention(), props.language)}</dd><dt>{copy.sensitivity}</dt><dd>{sensitivity}</dd><dt>{copy.outbound}</dt><dd>{outboundPolicy}</dd><dt>{copy.reason}</dt><dd>{publicReason}</dd></dl><p className="memory-candidate-note">{copy.candidateNotice}</p><div className="form-actions"><Button type="button" variant="primary" disabled={busy} onClick={() => { void createCandidate(); }}>{copy.createCandidate}</Button><Button type="button" variant="quiet" disabled={busy} onClick={() => { setCreatePreview(false); }}>{copy.cancel}</Button></div></> : null}
    </Modal>

    <Modal open={action !== undefined} title={action ? `${copy.confirmAction} · ${action.action}` : copy.confirmAction} description={action?.action === "forget" ? copy.forgetWarning : action?.action === "edit" ? copy.editReconfirm : undefined} closeLabel={copy.cancel} onClose={() => { setAction(undefined); }} returnFocusRef={actionTriggerRef}>
      {action ? <><p><StatusBadge tone={toneForState(action.item.state)}>{action.item.state}</StatusBadge></p><h3>{itemTitle(action.item)}</h3>{action.action === "edit" ? <div className="memory-action-editor">{action.item.kind === "term" ? <><label>{copy.term}<input value={editTerm} onChange={(event) => { setEditTerm(event.target.value); }} /></label><label>{copy.definition}<textarea value={editDefinition} onChange={(event) => { setEditDefinition(event.target.value); }} /></label></> : action.item.kind === "workset" ? <><label>{copy.purpose}<textarea value={editPurpose} onChange={(event) => { setEditPurpose(event.target.value); }} /></label><label>{copy.refs}<textarea value={refs} onChange={(event) => { setRefs(event.target.value); }} /></label></> : <label>{copy.content}<textarea value={editText} onChange={(event) => { setEditText(event.target.value); }} /></label>}<label>{copy.sensitivity}<select value={sensitivity} onChange={(event) => { const value = event.target.value as ProjectMemorySensitivityDto; setSensitivity(value); if (value === "secret_never_send") setOutboundPolicy("never_send"); }}>{SENSITIVITIES.map((value) => <option key={value}>{value}</option>)}</select></label><label>{copy.outbound}<select value={outboundPolicy} disabled={sensitivity === "secret_never_send"} onChange={(event) => { setOutboundPolicy(event.target.value as ProjectMemoryOutboundPolicyDto); }}><option value="never_send">never_send</option><option value="explicit_manifest_only">explicit_manifest_only</option></select></label></div> : null}{action.action === "edit" || action.action === "renew" ? <div className="form-grid"><label>{copy.retention}<select value={retentionPolicy} onChange={(event) => { setRetentionPolicy(event.target.value as ProjectMemoryRetentionDto["policy"]); }}><option value="until_unpinned">{copy.untilUnpinned}</option><option value="until_date">{copy.untilDate}</option><option value="current_episode" disabled={!state.currentEpisode}>{copy.currentEpisode}</option></select></label>{retentionPolicy === "until_date" ? <label>{copy.expires}<input type="datetime-local" value={expiresAt} onChange={(event) => { setExpiresAt(event.target.value); }} /></label> : null}</div> : null}{action.action === "forget" ? <label>{copy.forgetToken}<input autoComplete="off" value={forgetToken} onChange={(event) => { setForgetToken(event.target.value); }} placeholder="FORGET" /></label> : <label>{copy.actionReason}<textarea value={actionReason} onChange={(event) => { setActionReason(event.target.value); }} /></label>}<div className="form-actions"><Button type="button" variant={action.action === "forget" ? "danger" : "primary"} disabled={busy || action.action === "forget" && forgetToken !== "FORGET"} onClick={() => { void executeAction(); }}>{copy.confirmAction}</Button><Button type="button" variant="quiet" disabled={busy} onClick={() => { setAction(undefined); }}>{copy.cancel}</Button></div></> : null}
    </Modal>
  </article>;
}
