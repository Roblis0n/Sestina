import type { LocalJson } from "../../api/kernel-dto.js";

const terms: Record<string, [string, string]> = {
  project: ["整个项目", "Whole project"], effectiveBriefVersionId: ["依据的简报版本", "Brief version in effect"], reopenConditions: ["重新考虑的条件", "When to reconsider"],
  sourceArtifactId: ["来源产物", "Source artifact"], violatedCriterion: ["未满足的标准", "Unmet criterion"], rationaleConcepts: ["相关概念", "Related concepts"], resolutionEvidenceId: ["解决依据", "Resolution evidence"], resolutionReason: ["解决理由", "Resolution reason"],
  argument_leap: ["论证跳跃", "Argument leap"], target_substitution: ["目标被替换", "Target substitution"], repeated_audit: ["重复审查", "Repeated audit"], pseudo_depth: ["缺少实质内容", "No substantive depth"], evidence_boundary: ["证据边界", "Evidence boundary"], scope_violation: ["超出范围", "Scope violation"], decision_violation: ["违背决定", "Decision violation"], factual_error: ["事实错误", "Factual error"], methodological: ["方法问题", "Methodological issue"], stale: ["需要重新核对", "Recheck required"], disputed: ["存在争议", "Disputed"],
  draft: ["草稿已保存", "Draft saved"], committed: ["研究变更已保存", "Research change saved"], disposed: ["处置已保存", "Disposition saved"], manifest_prepared: ["待核对发送内容", "Check send content"], manifest_confirmed: ["内容已确认", "Content confirmed"], assessment_recorded: ["评估已保存", "Assessment saved"], provider_attempt_uncertain: ["外发结果不确定", "Send outcome uncertain"], provider_attempt_failed: ["评估未完成", "Assessment failed"], provider_attempt_running: ["请求进行中", "Request in progress"], provider_attempt_prepared: ["尚未发送", "Not sent"],
  text: ["内容", "Content"], term: ["术语", "Term"], definition: ["含义", "Meaning"], objectReferences: ["关联对象版本", "Referenced object versions"], workset_changed: ["工作对象已变化", "Working objects changed"], source_version_changed: ["来源版本已变化", "Source version changed"], source_content_changed: ["来源内容已变化", "Source content changed"], source_unavailable: ["来源已不可用", "Source unavailable"],
  revision: ["修改", "Revision"], question_formulation: ["形成问题", "Question formulation"], literature_review: ["文献梳理", "Literature review"], data_collection: ["收集资料", "Data collection"], analysis: ["分析", "Analysis"], writing: ["写作", "Writing"], review_response: ["回应评审", "Review response"],
  artifactId: ["产物", "Artifact"], relatedObjectRefs: ["相关对象", "Related objects"], allowedSourceIds: ["允许的来源", "Allowed sources"], policy_text: ["政策文本", "Policy text"], user_decision: ["用户决定", "User decision"], system_check: ["系统检查", "System check"],
  direct_user: ["用户手动加入", "Added by the user"], project_object: ["项目对象", "Project object"], policy: ["保留规则", "Retention policy"], until_unpinned: ["保留到主动停用", "Until you stop using it"], until_date: ["保留到指定日期", "Until the specified date"], expiresAt: ["到期时间", "Expires at"], current_episode: ["保留到本轮结束", "Until this episode ends"],
  brief: ["研究简报", "Research Brief"],
  decision: ["决定", "Decision"],
  evidence: ["证据", "Evidence"],
  issue: ["问题", "Issue"],
  artifact: ["产物", "Artifact"],
  claim: ["主张", "Claim"],
  direction_change: ["方向变更", "Direction change"],
  projectQuestion: ["研究问题", "Research question"],
  currentTask: ["当前任务", "Current task"],
  currentStage: ["研究阶段", "Research stage"],
  targetArtifacts: ["目标产物", "Target artifacts"],
  fixedDecisions: ["固定约束", "Fixed constraints"],
  acceptedDecisions: ["已接受决定", "Accepted decisions"],
  allowedChanges: ["允许改变", "Allowed changes"],
  forbiddenChanges: ["禁止改变", "Protected changes"],
  expectedDeltas: ["预期变化", "Expected changes"],
  evidenceBoundaries: ["证据边界", "Evidence boundaries"],
  explicitNonGoals: ["非目标", "Non-goals"],
  knownUnknowns: ["已知未知项", "Known unknowns"],
  evidenceThresholds: ["证据门槛", "Evidence thresholds"],
  sections: ["字段状态", "Field states"],
  progressive: ["补充信息", "Additional information"],
  statement: ["具体内容", "Statement"],
  rationale: ["理由", "Rationale"],
  publicReason: ["理由", "Reason"],
  summary: ["摘要", "Summary"],
  state: ["状态", "State"],
  status: ["状态", "Status"],
  scope: ["范围", "Scope"],
  target: ["对象", "Target"],
  operations: ["操作", "Operations"],
  relativePath: ["相对路径", "Relative path"],
  inferenceCapacity: ["推断范围", "Inference capacity"],
  provenance: ["来源", "Provenance"],
  citation: ["来源说明", "Citation"],
  kind: ["类别", "Kind"],
  importance: ["重要性", "Importance"],
  resolutionCondition: ["澄清条件", "Resolution condition"],
  appliesTo: ["适用对象", "Applies to"],
  minimumSourceClass: ["来源类别", "Source class"],
  requiredCorroboration: ["印证数量", "Corroboration count"],
  acceptedInferenceCapacity: ["允许推断", "Allowed inference"],
  forbiddenInferenceKinds: ["禁止推断", "Excluded inference"],
  add: ["添加", "Add"],
  rewrite: ["改写", "Rewrite"],
  delete: ["删除", "Delete"],
  move: ["移动", "Move"],
  citation_add: ["添加引用", "Add citation"],
  citation_remove: ["移除引用", "Remove citation"],
  data_replace: ["替换数据", "Replace data"],
  artifact_span: ["产物片段", "Artifact excerpt"],
  interview_excerpt: ["访谈摘录", "Interview excerpt"],
  coded_material: ["编码材料", "Coded material"],
  quantitative_result: ["定量结果", "Quantitative result"],
  literature_source: ["文献来源", "Literature source"],
  user_assertion: ["用户陈述", "User assertion"],
  background_only: ["仅作背景", "Background only"],
  descriptive: ["描述", "Descriptive"],
  interpretive: ["解释性理解", "Interpretive"],
  associational: ["关联", "Associational"],
  mechanistic: ["机制", "Mechanistic"],
  causal: ["因果", "Causal"],
  normative: ["规范判断", "Normative"],
  completion: ["完成情况", "Completion"],
  accepted: ["已接受", "Accepted"],
  proposed: ["待决定", "Proposed"],
  current: ["当前有效", "Current"],
  withdrawn: ["已撤回", "Withdrawn"],
  superseded: ["已被替代", "Superseded"],
  open: ["待解决", "Open"],
  resolved: ["已解决", "Resolved"],
  waived: ["已豁免", "Waived"],
  not_provided: ["未提供", "Not provided"],
  intentionally_empty: ["明确为空", "Intentionally empty"],
  provided: ["已填写", "Provided"],
  material: ["重要", "Material"],
  blocking: ["阻碍推进", "Blocking"],
  background: ["背景", "Background"],
  prepared: ["尚未发送", "Not sent"],
  running: ["请求进行中", "Request in progress"],
  completed: ["评估已保存", "Assessment saved"],
  failed: ["评估未完成", "Assessment failed"],
  uncertain: ["外发结果不确定", "Send outcome uncertain"],
  cancelled: ["已取消", "Cancelled"],
};
export function kernelLabel(value: string, en: boolean): string {
  return terms[value]?.[en ? 1 : 0] ?? value;
}
const technical = new Set([
  "fingerprint", "sourceRevisionId", "sourceRevisionContentHash", "lineageRootRevisionId", "contentVersionHash", "contentHash", "reopenHistory",
  "id",
  "projectId",
  "version",
  "versionNumber",
  "schemaVersion",
  "createdAt",
  "updatedAt",
  "currentVersionId",
  "supersedes",
  "baseProjectStateRevision",
  "allocatedIds",
  "transitions",
  "proposals",
  "objectReferences",
  "source", "actor", "actorId", "authority", "recordedAt", "createdByUserId",
]);
export function readableKernelValue(value: LocalJson, en: boolean, objectLabels: Record<string, string> = {}): string {
  if (value === null) return en ? "None" : "无";
  if (Array.isArray(value))
    return value.length
      ? value.map((v) => readableKernelValue(v, en, objectLabels)).join("\n\n")
      : en
        ? "Empty"
        : "空";
  if (typeof value === "object") {
    // A Brief aggregate preview concerns the new active version, not every historical version.
    if (Array.isArray(value.versions))
      return readableKernelValue(value.versions.at(-1) ?? null, en, objectLabels);
    return Object.entries(value)
      .filter(([key]) => !technical.has(key))
      .map(
        ([key, v]) => `${kernelLabel(key, en)}: ${readableKernelValue(v, en, objectLabels)}`,
      )
      .join("\n");
  }
  return typeof value === "string" ? objectLabels[value] ?? (/^r[a-z]{3}_[0-9A-HJKMNP-TV-Z]{26}$/.test(value) ? en ? "Referenced project object (see technical details)" : "关联项目对象（可查看技术详情）" : kernelLabel(value, en)) : String(value);
}
export function visibleKernelChanges(before: LocalJson, after: LocalJson) {
  const active = (input: LocalJson): Record<string, LocalJson> => {
    if (input === null || typeof input !== "object" || Array.isArray(input)) return {};
    if (Array.isArray(input.versions)) return active(input.versions.at(-1) ?? null);
    return input;
  };
  const b = active(before), a = active(after);
  return [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(key => !technical.has(key) && JSON.stringify(b[key] ?? null) !== JSON.stringify(a[key] ?? null)).map(field => ({ field, before: b[field] ?? null, after: a[field] ?? null }));
}
