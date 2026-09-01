---
title: "渐进式 Research Brief 与 Context limitations 计划"
status: proposed_complete_plan
implementation_status: not_started
baseline_release: v0.2.0
baseline_commit: caf893db7928bab91c4098eb04a7e4a8d4c62ffe
source_review: Sestina-v0.2.0-对抗性产品审查.md
source_findings: ["P1-04", "P0-01", "P1-02", "P1-06", "改进项-05"]
depends_on: ["03-PROJECT-STATE-REVISION-AND-MANIFEST.md", "04-PERSISTENT-REVIEW-AND-SEMANTIC-CLAIMS.md"]
blocks: ["06-TASK-ORIENTED-IA-AND-PRODUCTION-UI.md", "11-DATA-MIGRATION-COMPATIBILITY-AND-ROLLBACK.md"]
affected_layers: ["brief domain", "context projection", "UI forms", "history", "migration", "provider contract", "tests"]
decision_owner: user
---

# 渐进式 Research Brief 与 Context limitations 计划

> 本文件给出该领域的完整目标状态和实施合同。它不是 `v0.2.0` 当前事实，也不是完成证明；标注 `existing_verified` 的内容仅表示基线代码中已直接核对。

## 1. 计划结果

完成后，新项目只需输入当前研究问题或任务即可进入；系统不会一次性强迫填写完整 schema。随着用户准备 Review，Brief 通过渐进披露补齐 assessment coverage、in scope、out of scope、accepted decisions、evidence threshold、known unknowns、expected change 与 non-goals。所有字段使用 typed form、系统生成 ID、relationship picker、field diff/history；JSON 只作为只读 technical view。未提供字段形成显式 `Context limitations`，Provider 只能报告 unknown，不能猜测后自动提升为 Authority。

## 2. 来源发现与证据边界

### 对应发现

- `P1-04`：首次 `BriefSetup.tsx` 只收一个问题，过薄；完整 Brief 对象却包含大量结构化字段和 canonical IDs，普通用户需在对象工作区理解内部 schema。
- `P0-01`：Brief 是 Manifest/state binding 的核心输入，字段不足会让 Review 建立在不可见假设上。
- `P1-02`：缺 context 时 Provider 输出若被包装成系统结论，会放大认识论风险。
- `P1-06`：Brief 作为独立对象入口，而不是在用户任务发生时渐进出现。

### `existing_verified` 基线

`packages/research/src/brief/research-brief.ts` 已验证的字段包括：`projectQuestion`、`currentStage`、`currentTask`、`targetArtifacts`、`fixedDecisions`、`allowedChanges`、`forbiddenChanges`、`expectedDeltas`、`evidenceBoundaries`、`explicitNonGoals`；已有 imported draft、activate、change proposal、confirm、version、supersedes 与 YAML export。

本计划保留版本化和user confirmation，不把缺字段交给LLM自动填充。

## 3. 当前状态与根因链

```text
Start Center → 只输入 question
→ Review context却要求 stage/task/decisions/deltas/boundaries/non-goals
→ 用户要么在薄Brief上调用Provider，要么进入对象/JSON式编辑器
→ 缺字段在UI中不可见，Provider仍给出完整语气assessment
→ 用户难以分辨“建议有问题”还是“Brief不足”
```

把首次表单改成大表单会把问题从“context不足”变成“启动负担过高”。正确修复是区分最小可启动字段、Review前必要约束与高级技术表示，并把未提供状态本身纳入Manifest。

## 4. 方案空间

| 方案 | 启动成本 | Context质量 | Authority | UI负担 | 迁移/维护 |
|---|---|---|---|---|---|
| A. 保留单一question，系统/LLM自动推断其余字段 | 最低 | 表面高、真实未知 | 违反；推断易被提升 | 低 | 中；语义风险高 |
| B. 首次启动强制填写完整Brief | 高 | 高 | 清楚 | 极高；阻碍进入 | 低中 |
| C. 自由Markdown Brief + Provider自行解析 | 中 | 不稳定 | 模糊 | 低表面 | 高；难以diff/binding |
| D. 渐进typed Brief：question/task起步，Review前按coverage提示补字段，字段可显式未提供 | 低 | 可见、可提高 | 强 | 适中 | 中高但可维护 |
| E. 删除Brief，依赖聊天上下文 | 最低 | 低 | 无稳定边界 | 低 | 产品独特价值消失 |

### 完全删除assessment coverage的反事实

用户仍可编辑字段，但不知道当前Review缺少什么，Provider unknown与Brief缺口继续混合。coverage是derived提示，不是评分，不应删除。

## 5. 最终推荐裁决

选择 **D：渐进 typed Brief + 显式 section state + derived assessment coverage**。

- 创建项目时只要求 `question` 或 `task` 至少一项；两者可在同一短表单中输入。
- Review prepare时根据 suggestion/requested target计算需要的sections，显示阻塞项、建议项和可跳过项。
- 跳过不会阻止用户 `record_only` 或其他本地effect；Manifest必须显示 limitation，Provider不得补成Authority。
- typed form复用现有Brief domain，新增字段有清晰迁移；technical JSON只读。
- relationship picker引用真实Decision/Evidence/Issue，不要求手写ID。
- 牺牲“一步完成”的表面简洁，换取context边界可见且不强迫一次性填满。

## 6. 目标领域模型

### 6.1 现有字段映射

| 用户概念 | 基线字段 | 状态 | 目标处理 |
|---|---|---|---|
| question | `projectQuestion` | `existing_verified` | 保留，首启最小字段之一 |
| current task | `currentTask` | `existing_verified` | 保留，首启可填 |
| stage | `currentStage` | `existing_verified` | 默认可由用户选择，不由LLM猜 |
| target artifacts | `targetArtifacts` | `existing_verified` | relationship picker |
| accepted decisions | `fixedDecisions` | `existing_verified` | 改为Decision refs + snapshot statement projection |
| in scope | `allowedChanges` | `existing_verified` | 用户文案改为范围内可改变 |
| out of scope | `forbiddenChanges` + `explicitNonGoals` | `existing_verified` | 区分禁止改变与非目标 |
| expected change | `expectedDeltas` | `existing_verified` | 允许显式not_provided，不再要求伪造默认delta |
| evidence boundary | `evidenceBoundaries` | `existing_verified` | 扩展为threshold规则 |
| known unknowns | 无独立字段 | `proposed_new` | 结构化Unknown条目 |
| assessment coverage | 无 | `proposed_new derived` | 按Review target/policy计算 |

### 6.2 Section state (`proposed_new`)

```ts
type BriefSectionState<T> =
  | { status: "not_provided" }
  | { status: "intentionally_empty"; publicReason: string }
  | { status: "provided"; value: T };
```

`not_provided`与空数组不同：前者产生Context limitation；后者表示用户明确没有限制。

### 6.3 New fields (`proposed_new`)

```ts
interface KnownUnknown {
  id: string;
  statement: string;
  importance: "blocking" | "material" | "background";
  relatedObjectRefs: readonly ObjectRef[];
  resolutionCondition?: string;
}

interface EvidenceThreshold {
  id: string;
  appliesTo: "claim" | "decision" | "direction_change" | "completion";
  minimumSourceClass: string;
  requiredCorroboration?: number;
  acceptedInferenceCapacity?: readonly string[];
  publicReason: string;
}
```

字段名称/枚举要与现有Evidence domain对齐；精确`minimumSourceClass`枚举是`requires_code_verification`：核对`packages/evidence/src`与`packages/research/src/argument/evidence.ts`的canonical provenance分类。不同答案只影响picker options，不改变“Provider不能自动满足threshold”。

### 6.4 Assessment coverage (`derived`)

输出：section、`sufficient|limited|not_applicable`、reason、requiredForEffectKinds、missing refs。它不阻止user Authority，只影响Manifest limitation与Provider request instruction。

### 6.5 Version/history

每次confirmed patch生成新Brief version、`supersedes`旧version、字段 diff（`field diff`）和source。candidate与active分离；系统生成ID。

## 7. 状态机与 transition

| from | action/actor | precondition | mutation | to | failure/recovery |
|---|---|---|---|---|---|
| no Brief | create minimal / user | question或task非空 | imported/active v1；section states | active Brief | 写失败项目保持setup required |
| active | open section editor / user | 当前version | 本地draft，不写canonical | draft | 离开可保留local/persistent Brief candidate |
| draft | save candidate / user | typed validation | persist candidate/proposal | candidate | invalid字段逐项显示 |
| candidate | confirm patch / user | active base version未变 | new Brief version + project revision | active new version | version conflict→stale candidate |
| candidate | rebase / user | active changed | three-way field diff；无自动接受 | candidate rebased | 冲突字段必须用户选择 |
| active | prepare Review / Kernel | suggestion/target | derive coverage/limitations | Review context projection | 不写Brief |
| Review limitation shown | skip / user | limitation acknowledged | Manifest includes limitation | Review continues | Provider instruction强制unknown |
| active | formal direction change / user | effect preview | specialized Brief version + supersession | new active | 由`01`原子提交 |
| any | history view | read-only | none | none | old versions不可编辑 |

stale candidate不自动合并；restart恢复candidate和diff。取消draft不改变active。

## 8. 数据流与 Authority 流

```text
User question/task
→ active versioned Brief
→ user adds scope/decisions/thresholds/unknowns as needed
→ Review target selects required sections
→ deterministic AssessmentCoverage
→ Context limitations + selected Brief projection
→ Exact Manifest
→ Optional Provider assessment constrained to available context
→ user effect preview
→ confirmed Brief patch/direction change as canonical transaction
```

LLM可提出字段candidate文本，但只能作为Review/Suggestion来源；不允许`candidate → active`自动transition。

## 9. API、Schema、Repository 与代码边界

| 当前文件/组件 | 当前职责 | 目标职责 | 类型 | 证据 |
|---|---|---|---|---|
| `packages/research/src/brief/research-brief.ts` | 完整fields/version/change | 增加section state/unknown/threshold；保留proposal/confirm | 重构 | `existing_verified` |
| `packages/core/src/sestina-core.ts` Brief commands | 创建/变更Brief | 暴露progressive candidate/coverage | 扩展 | `existing_verified` |
| `packages/core/src/context-projection.ts` | `proposed_new` | 从active Brief生成context/limitations | 新增 | 计划对象 |
| `apps/research-room/client/src/screens/BriefSetup.tsx` | 单question启动 | question/task短表单 + why说明 | 重构 | `existing_verified` |
| `apps/research-room/client/src/components/product/ResearchObjectWorkspace.tsx` Brief view | 对象/JSON式工作区 | 被`ProjectBriefPanel`取代，legacy详情只读 | 重构/隐藏 | `existing_verified` |
| `apps/research-room/client/src/components/product/ProjectBriefPanel.tsx` | 不存在 | section cards、coverage、history、diff | `proposed_new` | 计划对象 |
| `apps/research-room/client/src/components/product/BriefRelationshipPicker.tsx` | 不存在 | Decision/Evidence/Issue/Artifact refs | `proposed_new` | 计划对象 |
| `apps/research-room/client/src/components/product/BriefTechnicalView.tsx` | 不存在 | 只读canonical JSON/YAML/export | `proposed_new` | 计划对象 |
| API `/api/commands/brief/*` | candidate/activate | strict typed candidate/confirm/rebase/history | 重构 | `existing_verified` |

新路由由`06`定义：`/project/state/brief`、`/project/state/brief/edit`、`/project/state/brief/history/:versionId`。

## 10. UI 与交互

### Progressive disclosure

1. **Start Center后**：标题、Question、Current task；高级字段折叠。
2. **Project**：Brief摘要显示“当前问题 / 当前任务 / 3项已固定决定 / 2个已知未知”。
3. **准备Review时**：只展开与本次target相关的缺口。例如`add_evidence`突出evidence threshold，`formal_direction_change`突出scope/non-goals。
4. **用户选择补充**：typed drawer，保存candidate，展示field diff；确认后回到Review并自动重建Manifest。
5. **用户跳过**：limitation留在Thread和Manifest，Provider区显示“该判断必须返回unknown或限定”。

### 必须覆盖的UI状态

- empty section：区分未提供/明确为空。
- loading relationships：picker skeleton，不允许手写陌生ID作为默认。
- conflict：字段级base/current/candidate三列，用户逐项选择。
- stale candidate：明确active Brief已变；不能直接confirm。
- long Chinese/English：文本区自动增长、section可折叠、summary保留首句与计数。
- 200%：单列，保存/取消sticky但不遮内容。
- screen reader：section status、errors、diff additions/removals有文字；focus回到修改触发点。
- technical view：默认只读，复制/下载显式；不作为主要编辑方式。
- Context limitations：普通语言，technical ID按需展开。

系统生成ID不在普通表单展示；relationship picker显示对象名称、状态、版本和provenance。

## 11. 中文／English 与术语

| 中文 | English | 内部 |
|---|---|---|
| 当前研究问题 | Current research question | `projectQuestion` |
| 当前任务 | Current task | `currentTask` |
| 评估覆盖范围 | Assessment coverage | derived，不是score |
| 范围内 | In scope | `allowedChanges` projection |
| 范围外 / 不可改变 | Out of scope / Protected | `forbiddenChanges` |
| 已接受决定 | Accepted decisions | `fixedDecisions`/refs |
| 证据门槛 | Evidence threshold | `EvidenceThreshold` |
| 已知未知项 | Known unknowns | `KnownUnknown` |
| 预期变化 | Expected change | `expectedDeltas` |
| 非目标 | Non-goals | `explicitNonGoals` |
| 未提供 | Not provided | limitation |
| 明确无此约束 | Intentionally empty | user decision |

不使用“AI已补全Brief”“覆盖率100%=研究充分”等主张。

## 12. 隐私、安全与权限

- Brief可能包含敏感研究信息；默认本地，不因打开编辑器网络发送。
- relationship picker只查询当前project；跨项目ID拒绝。
- LLM候选字段作为untrusted suggestion，不能注入ID、path、HTML或Provider config。
- technical JSON复制前显示包含哪些敏感字段；不自动写剪贴板。
- error/log不打印Brief正文或absolute project path。
- Manifest只包含policy选定fields；out-of-scope/private notes不因“完整Brief”自动外发。
- `secret_never_send` Memory不能通过Brief ref旁路。
- field-level conflict与version检查在Kernel，不信任renderer diff。

## 13. 数据迁移与向后兼容

- legacy Brief fields逐项映射为`provided`；已有空列表需区分：若schema要求且用户保存过，迁移为`intentionally_empty`并标`migration_interpreted_empty`；无法判断时迁移为`not_provided`，不能假称用户明确为空。
- `fixedDecisions`保留statement快照，并尝试匹配现有Decision ID；匹配不唯一时保留legacy constraint，不自动关联。
- `allowedChanges`/`forbiddenChanges`/`explicitNonGoals` lossless映射。
- `expectedDeltas`基线至少一项的旧约束保留；新schema允许not_provided，migration不删旧delta。
- `evidenceBoundaries`映射为legacy threshold rule，未明确source class时标limitation。
- 新known unknowns为空应是not_provided，不是“没有未知”。
- history/version/supersedes保留；baseline project revision由`03/11`处理。
- migration预览显示lossy relationship matches；失败保持原DB。

## 14. 测试与验证

- RED：新建项目只填question可进入，不生成伪scope/threshold/unknown。
- RED：Review context明确列出not_provided limitations。
- unit：section state parser、coverage rules、field diff、relationship ownership。
- property：任意candidate sequence只在user confirm后active version变化；IDs唯一；old version immutable。
- repository：candidate/confirm CAS、crash、history pagination。
- API：typed payload、long UTF-8、invalid IDs、cross-project refs。
- integration：Brief patch推进project revision并stale旧Manifest；skip limitation不阻塞effect。
- Provider contract：missing context instruction与unknown allowed；fixture只验证format。
- migration：空列表解释、legacy constraints、ambiguous ID不误连。
- E2E：首启、Review前补字段、skip、conflict/rebase、history、technical export。
- accessibility/visual：长Brief、中文/English、1100–1920、200%、keyboard、screen reader、reduced motion。
- no-network：Brief编辑/coverage不建立连接。
- performance：数百refs picker分页/搜索，不一次渲染全部。

## 15. 完整验收标准

- 新用户不理解schema/ID也可创建有效最小Brief。
- Review前系统只要求与本effect相关的sections，并允许显式跳过。
- 每个未提供section在Context limitation、Manifest和Provider request中一致。
- LLM/Provider不能自动activate Brief字段。
- typed form覆盖所有目标字段；JSON/YAML仅只读技术视图。
- relationship picker生成project-scoped真实ID；普通表单无手写canonical ID要求。
- candidate/active/history/conflict/stale/restart路径完整。
- Brief确认推进project revision、旧Manifest stale、Review可重建。
- migrated项目不把未知误写成空，也不丢旧constraints。
- Search/Project/Receipt显示同一active Brief version。
- 长内容/200%/keyboard/screen reader可完成，不靠颜色表达section状态。
-现有version、supersedes、user confirmation、local storage保护不回归。

## 16. 明确非目标

- 不建立通用研究设计向导。
- 不用LLM自动写完整Brief或自动promote。
- 不把coverage作为质量分数。
- 不要求首次启动填写所有字段。
- 不允许自由JSON成为默认编辑界面。
- 不替代Decision/Evidence/Issue对象。
- 不支持跨项目自动引用。
- 不判断研究主题本身是否有价值。

## 17. 被拒绝方案与重新考虑条件

- **LLM自动补全**：只有自动结果始终保持candidate且用户逐字段确认时，可作为输入便利重新考虑；不能作为Authority。
- **强制大表单**：只有产品面向必须先完成正式protocol的单一专业场景时重开；当前通用科研App不适合。
- **Markdown-only**：只有放弃exact field binding、diff和target-aware coverage时重开。
- **删除Brief**：与产品状态连续性核心冲突，不重开。
- **隐藏limitations**：不重开；它会让Provider unknown被误读。

## 18. 实施风险与失败收缩

- 新schema与旧Brief parser不兼容时，必须先实现dual-read/新写单一；旧runtime只读，不双写。
- relationship picker如果误连对象会改变context；匹配必须显式、可撤销、有版本。
- section数量膨胀：只保留本计划列出的不可约简字段，不增加方法论模板市场。
- coverage规则若散落前后端会漂移；只在Kernel计算，UI消费projection。
- Provider prompt若仍假设所有字段存在，会产生过强回答；semantic contract与本计划同提交边界更新。
- UI尚未完成时，新Brief仅通过迁移/测试写入，不向用户暴露半成品JSON编辑。

## 19. 对其他计划的依赖

- `03-PROJECT-STATE-REVISION-AND-MANIFEST.md` 决定Brief变化、limitations与Manifest binding。
- `01-REVIEW-CANONICAL-TRANSITION.md` 定义`patch_brief`/`formal_direction_change`。
- `02-AUTHORITY-PROVIDER-DECOUPLING.md` 保证缺context/Provider不剥夺Authority。
- `04-PERSISTENT-REVIEW-AND-SEMANTIC-CLAIMS.md` 保存Review与stale候选。
- `06-TASK-ORIENTED-IA-AND-PRODUCTION-UI.md` 定义Project/Review中的页面位置。
- `11-DATA-MIGRATION-COMPATIBILITY-AND-ROLLBACK.md` 是字段映射权威。
- `13-TEST-EVAL-AND-PRODUCTION-VERIFICATION.md` 收录coverage、long content与visual矩阵。
