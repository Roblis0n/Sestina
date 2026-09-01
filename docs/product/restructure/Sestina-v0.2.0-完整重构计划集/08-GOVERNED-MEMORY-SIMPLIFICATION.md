---
title: "Governed Memory 内核保留与用户表面简化计划"
status: proposed_complete_plan
implementation_status: not_started
baseline_release: v0.2.0
baseline_commit: caf893db7928bab91c4098eb04a7e4a8d4c62ffe
source_review: Sestina-v0.2.0-对抗性产品审查.md
source_findings: ["P1-06", "P0-01", "P1-04", "改进项-08"]
depends_on: ["03-PROJECT-STATE-REVISION-AND-MANIFEST.md", "04-PERSISTENT-REVIEW-AND-SEMANTIC-CLAIMS.md", "05-PROGRESSIVE-RESEARCH-BRIEF.md"]
blocks: ["06-TASK-ORIENTED-IA-AND-PRODUCTION-UI.md", "11-DATA-MIGRATION-COMPATIBILITY-AND-ROLLBACK.md", "12-PRIVACY-SECURITY-AND-THREAT-MODEL.md"]
affected_layers: ["memory domain", "context projection", "search", "backup", "privacy", "UI", "migration"]
decision_owner: user
---

# Governed Memory 内核保留与用户表面简化计划

> 本文件给出该领域的完整目标状态和实施合同。它不是 `v0.2.0` 当前事实，也不是完成证明；标注 `existing_verified` 的内容仅表示基线代码中已直接核对。

## 1. 计划结果

完成后，Memory继续保留内部`candidate|active|stale|expired|retired|forgotten`、sensitivity、retention、`never_send|explicit_manifest_only`等安全规则，但用户只看到 `Suggested`、`In use`、`Not in use`、`Forgotten` 四态；stale/expired/retired作为原因。Memory不再是一级工作区，而是Review/Brief的contextual drawer与Project history。Recall只由明确触发规则产生，默认不外发；每次Provider请求必须逐项选择并进入Exact Manifest。Forget清理当前DB、search index、cache/temp，并对managed backup、Receipt/Manifest、Provider和手工导出明确可控/不可控副本边界。

## 2. 来源发现与证据边界

### 对应发现

- 当前Memory有六态、kind、retention、sensitivity、outbound policy、source binding、resume checkpoint、separate workspace，保护强但用户成本高。
- `P1-06`：Memory作为一级入口，与主任务竞争。
- `P0-01`：Memory可进入Provider context，但当前全局state binding未统一覆盖。

### `existing_verified` 保护

- `authorityClass: working_memory_non_authoritative`；`semanticConflict: semantic_conflict_unchecked`。
- `Store ≠ Recall ≠ Share ≠ Promote`在数据模型中有候选/确认、recall eligibility、Manifest selection。
- `never_send`与`secret_never_send`、external Provider sensitivity限制。
- Memory Manifest有item version/content hash、included/excluded/reason、确认/consumed、TTL。
- forgotten只保留tombstone，当前内容字段被移除；cross-project repository scope。
- ResumeCheckpoint明确non-authoritative。

### 源码

`packages/research/src/memory/project-working-memory.ts`、`packages/core/src/project-memory.ts`、migration019、repository、`apps/research-room/client/src/components/product/ProjectMemoryWorkspace.tsx`。

## 3. 当前状态与根因链

```text
候选/激活/stale/expired/retired/forgotten + retention/sensitivity/outbound/source
→ 独立Memory workspace与Resume流程
→ 用户为“继续当前研究”维护第二套对象系统
→ Review又要求显式Memory Manifest
→ 安全保护真实，但可见状态多于直接任务增量
```

简单删除状态会破坏never_send、source stale、retention和forget边界；正确方法是内部精细、外部投影简化，并把Memory放回“本次Review需要什么上下文”的位置。

## 4. 方案空间

| 方案 | 连续性价值 | 隐私保护 | UI负担 | 迁移 | 范围膨胀 |
|---|---|---|---|---|---|
| A. 完全删除Memory | 低 | 简单 | 最低 | 中 | 无，但重复解释增加 |
| B. 只保留Pinned context，无状态/retention | 中 | `never_send`可保留但stale弱 | 低 | 中 | 低 |
| C. 内部保留精细状态，UI四态；contextual recall/Manifest | 高 | 最强 | 中低 | 中 | 可控 |
| D. 维持现状独立工作区/六态 | 高 | 强 | 高 | 低 | 易变个人知识库 |
| E. 扩张为跨项目个人知识库 | 很高表面 | 风险极高 | 高 | 极高 | 违反产品范围 |

### 完全删除Memory的反事实

核心Review仍可工作，但用户需反复粘贴术语/工作集，且Host跨会话连续性更差。由于现有`never_send`和source binding确有不可替代增量，删除不是最优。

## 5. 最终推荐裁决

选择 **C：内部精细状态不变，用户表面四态，入口contextual化**。

- 不删除安全内核或tombstone；不新增跨项目知识库。
- UI映射：candidate→Suggested；active→In use；stale/expired/retired→Not in use+原因；forgotten→Forgotten。
- Recall不等于share：In use item可被建议召回，但Provider payload仍需逐项勾选/Manifest确认。
- `never_send`永远不出现在selection可选项；不是一个可被普通UI覆盖的checkbox。
- 每item记录`lastConfirmedProjectStateRevision`和source trigger，帮助用户理解为什么出现。
- Memory变化推进project revision；Review-specific selection不推进project revision，只形成Manifest version。
- 牺牲独立“管理中心”的可见性，保留Project history/search和Settings中的privacy control。

## 6. 目标领域模型

### 6.1 内部→用户态映射

| Internal (`existing_verified`) | User state | reason | Recall | Provider selection |
|---|---|---|---:|---:|
| `candidate` | Suggested | awaiting confirmation | 否 | 否 |
| `active` | In use | source current | 是，按trigger | 仅`explicit_manifest_only`且sensitivity允许 |
| `stale` | Not in use | source changed/unavailable | 否 | 否 |
| `expired` | Not in use | retention ended | 否 | 否 |
| `retired` | Not in use | user retired | 否 | 否 |
| `forgotten` | Forgotten | content removed/tombstone | 否 | 否 |

### 6.2 新projection字段 (`proposed_new`)

- `lastConfirmedProjectStateRevision`；
- `lastRecalledAt?`、`lastRecallTrigger?`（仅本地操作事实，不是Authority）；
- `userState` derived；
- `notInUseReason`；
- `controlledCopyInventory` derived。

内部live schema继续含kind/contentHash/source/retention/sensitivity/outboundPolicy/version。

### 6.3 Recall trigger

允许trigger：

- Review suggestion显式引用item关联对象；
- 当前Brief task与workset refs匹配；
- 用户主动打开“Add context”；
- Resume显示上次确认后source/object变化。

禁止：纯semantic similarity自动share、其他项目匹配、Provider要求追加、Host instruction要求include。

### 6.4 Copy inventory

| 副本 | 可控性 | Forget行为 |
|---|---|---|
| current DB | 可控 | 内容移除、tombstone保留 |
| Search/FTS/cache/temp | 可控 | 同transaction/outbox清理；失败进入privacy recovery |
| unsent Manifest draft | 可控 | stale/cancel，exact body重建 |
| committed local Receipt/Manifest plaintext | 可控但审计冲突 | 写`privacy_redaction`补偿记录，删除plaintext、保留hash/bytes/identity并降低proof级别 |
| managed Sestina backup | 可控 | inventory列出受影响backup；用户删除/retire，未处理者不自动restore |
| Provider receipt／Provider端已发送副本 | 不可控 | Provider receipt显示Provider/time/Manifest及当时included Memory refs；forget不能声称撤回或删除 |
| manual export/clipboard/用户复制的backup | 不可控 | 明确提醒，Sestina无法追踪/删除 |

`privacy_redaction`不会篡改旧hash；它记录原proof不再可重显。

## 7. 状态机与 transition

### Internal state

保留existing create candidate→confirm active→edit/stale/expire/renew/retire/forget transitions。增加revision/event coupling：每次Memory canonical write与project head同事务推进。

### User workflow

| state | action | precondition | result | failure/recovery |
|---|---|---|---|---|
| Suggested | Use / user | source still valid | active/In use + revision | source changed→Not in use |
| In use | Edit/Retire/Forget | version current | newversion/state + revision | CAS conflict reload |
| In use | Select for Review | policy/sensitivity/source valid | Review-local Manifest selection | item change→Manifest stale |
| Not in use | Renew / user | reason可恢复 | active + revision | source unavailable不能renew |
| Not in use | Forget | user confirmation | tombstone + copy cleanup plan + revision | cleanup partial→privacy recovery |
| Forgotten | View tombstone | read-only | no content | 不可恢复内容 |

### Manifest selection

prepare selection→preview included/excluded/reasons→user confirm→Manifest consumed。Review-specific selection不修改Memory active state；重启后未发送selection恢复但需session/fresh确认。

### Forget failure

若DB内容已删除但index/managed backup cleanup失败，Kernel记录`forget_cleanup_required`，Search不得回显旧内容，Recovery提供剩余副本清单；不能rollback恢复正文。

## 8. 数据流与 Authority 流

```text
User/Project object → Suggested memory candidate
→ user confirms → In use (non-authoritative)
→ deterministic recall trigger → contextual suggestion
→ user selects specific items for one Review
→ Memory Manifest projection + Exact Context Manifest
→ optional Provider send
→ Receipt records included item IDs/hashes, not promote to Evidence

Forget → DB tombstone + index/cache cleanup + backup/receipt copy inventory
```

网络只通过Review Manifest；Memory workspace/drawer本身0网络。Authority write只改变Memory治理状态，不改变事实/Decision。

## 9. API、Schema、Repository 与代码边界

| 当前模块 | 当前 | 目标 | 修改 | 验证 |
|---|---|---|---|---|
| `packages/research/src/memory/project-working-memory.ts` domain | 六态/retention/sensitivity/policy | 保留；加入project revision binding/cleanup metadata | 扩展 | `existing_verified` |
| `packages/core/src/project-memory.ts` | independent manifest/Resume | 调用统一ContextProjection；输出四态UI projection | 重构 | `existing_verified` |
| `packages/storage/src/migrations/019-project-working-memory.ts` / `project_working_memory` | memory/checkpoints | 保留；新增必要columns/data version | 扩展 | `existing_verified` |
| `apps/research-room/client/src/components/product/ProjectMemoryWorkspace.tsx` | full独立workspace | 拆为`ContextMemoryDrawer`+Project History view | 重构 | `existing_verified` |
| `apps/research-room/client/src/components/product/MemorySelectionPanel.tsx` | 现有逻辑在workspace | Review contextual selection/reasons | `proposed_new` | 计划对象 |
| `apps/research-room/client/src/components/product/MemoryPrivacyInventory.tsx` | 不存在 | forget copy inventory/managed backup action | `proposed_new` | 计划对象 |
| Search projection | memory searchable | 显示user state/source；forgotten只tombstone | 重构 | `existing_verified` path需在object workspace核对 |
| backup/restore | 包含DB | 增加redacted/retired backup inventory | 扩展 | `existing_verified` |

`requires_code_verification`：核对FTS是否直接索引Memory content、Receipt/Manifest是否复制正文、managed backup catalog的位置。答案决定cleanup SQL/backup inventory实现，但不改变“不得回显/不得声称远端删除”。

## 10. UI 与交互

### Contextual drawer

在Review的“Add context”与Project的“Context in use”打开。默认分组：Suggested、In use、Not in use；Forgotten只在Privacy/History可见。

每item显示：可读title/content摘要、source、为什么被召回、last confirmed revision、sensitivity、outbound policy、状态原因。普通用户不见`candidate/retired`内部enum。

### Selection

- checkbox仅对eligible In use item出现；`never_send`显示锁和明确原因，不能通过advanced UI覆盖。
- external Provider下project_private/sensitive限制在列表即时显示。
- 选择后Manifest摘要列出exact included item、版本、hash；正文在exact body中可核对。
- Review提交不自动改变Memory状态。

### Forget

destructive dialog逐层列出：当前DB/index将删除；哪些managed backups仍含内容；哪些Receipt/Manifest可redact；Provider/manual export无法删除。用户选择删除受影响managed backups或保留并接受风险。完成后显示tombstone和cleanup Receipt。

### 状态

- empty：解释Memory不是知识库，提供从当前task创建working hint。
- stale/expired：Not in use+reason+renew action。
- partial cleanup：privacy warning阻止Search回显，提供repair。
- offline：全部功能正常。
- recovery：restore含forgotten内容的旧backup时必须预览并重新执行forget redactions或拒绝自动restore。
- 200%/keyboard/screen reader：列表单列、checkbox标签完整、destructive summary先读。
- long content：摘要折叠，full local view；不自动放入Manifest。

## 11. 中文／English 与术语

用户态固定：

- Suggested / 建议使用
- In use / 使用中
- Not in use / 未使用
- Forgotten / 已忘记

原因词：Source changed、Expired、Retired by user、Never send、Sensitivity blocks sharing。

内部`candidate|active|stale|expired|retired|forgotten`只在technical proof/API compatibility中出现。

- Recall / 召回：在本地建议显示，不等于外发。
- Share / 外发：本Review的Manifest显式选择。
- Promote：不提供Memory→Evidence自动promotion。
- `Memory ≠ Evidence`和`Store ≠ Recall ≠ Share ≠ Promote`保留在docs/technical explanation，不把它们堆在每个卡片。
- Forget：不得写“从所有地方删除”；写清副本范围。

## 12. 隐私、安全与权限

- `never_send`/`secret_never_send`为Kernel hard rule，Renderer/Host/Provider不能覆盖。
- cross-project查询、selection、ID全部拒绝。
- similarity/recall不得向Provider发送query或content；本地确定性/受限索引。
- forgotten内容从active DB/FTS/cache/temp删除；tombstone不含内容/hash可逆线索超出必要范围。
- historical exact payload redaction保留hash/bytes/provider/time，UI明确proof降级；不伪造未发送。
- backup restore必须检测privacy redaction ledger，防旧内容复活。
- Provider已收内容不可撤回；显示诚实边界。
- logs/errors不打印Memory正文。
- imported/Host文本不能指令系统召回或share。
- Memory limit/size/ref caps保留，防资源耗尽。

## 13. 数据迁移与向后兼容

- internal states lossless保留；新UI projection即时计算。
- existing active items增加`lastConfirmedProjectStateRevision=1`（migration baseline）与source validation结果；不重新确认用户Authority。
- legacy Manifest selection/Receipt中的Memory included/excluded保留；标legacy payload。
- resume checkpoints映射到project revision 1 + authority/memory bindings；仍non-authoritative。
- old Memory route转Project drawer/history。
- forgotten tombstone保留；migration不得从backup/Receipt恢复正文。
- 初次打开migrated project运行controlled-copy scan，列出managed backups/legacy receipts可能副本，不自动删除。
- 新forget cleanup schema完成前，旧UI只读，避免“已忘记”但index未清。
- downgrade只能恢复pre-migration backup，并警告其中可能含已忘记数据。

## 14. 测试与验证

- mapping unit：六内部态→四用户态+reason。
- property：`never_send`在所有Provider/locality/selection序列中永不included；Memory从不变Evidence。
- recall：只有eligible active+trigger；cross-project/semantic-only/Host instruction不能召回。
- revision：confirm/edit/stale/expire/renew/retire/forget推进；Review selection不推进。
- Manifest：item version/hash变化使stale；no auto share。
- forget：DB/FTS/cache/temp、Receipt redaction、managed backup inventory、restore旧backup防复活。
- crash：forget各步骤故障，正文不能重新Search；cleanup recovery可继续。
- migration：所有states/checkpoints/tombstones/legacy Manifest。
- E2E：Suggested→In use→select→Manifest→Receipt；Not in use renew；Forget副本向导。
- privacy/no-network：Memory操作0网络，Provider只发送selected exact body。
- large：200 active/400 checkpoint bindings/long content。
- accessibility/visual：四态非颜色、lock reason、200%、long list。
- Provider fixture不证明Memory有用或内容真实。

## 15. 完整验收标准

- 一级导航无独立Memory；Review/Project/Search/History可找到相关内容。
- 用户只需理解四态；内部reason和security规则仍完整。
- 每个recall显示来源和触发原因；不自动share。
- Manifest逐项列出selected items；默认0项；`never_send`不可选择。
- Memory永远标non-authoritative，不能自动成为Evidence/support。
- confirm/edit/stale/expire/retire/forget与project revision一致。
- forget后当前DB/Search/cache/temp不回显；managed backups/Receipt/Provider/manual export边界可见。
- restore旧backup不会静默复活forgotten内容。
- cross-project隔离、size limits、source stale、future schema保护不回归。
- migrated states/history lossless，UI不过度暴露内部enum。
- long list/200%/keyboard/screen reader可操作。

## 16. 明确非目标

- 不做个人知识库或跨项目Memory。
- 不做embedding云检索。
- 不自动把Memory变Evidence/Decision。
- 不允许Provider选择Memory。
- 不删除内部stale/retention/sensitivity状态。
- 不声称forget能删除Provider/手工导出副本。
- 不以Memory数量作为产品价值指标。
- 不增加无限kind/标签系统。

## 17. 被拒绝方案与重新考虑条件

- **完全删除Memory**：只有连续性价值被证明可由Brief/Review完全替代且复杂度仍过高时重开。
- **Pinned-only**：只有source stale/retention/forget保护可被更简单机制同等保证时重开。
- **维持独立workspace**：只有Memory成为用户不可约简主任务时重开；当前不是。
- **跨项目知识库**：违反范围/隐私，不重开。
- **自动semantic recall/share**：只有本地可证、用户显式确认且不绕Manifest时可研究；默认不采用。

## 18. 实施风险与失败收缩

- UI简化可能隐藏never_send原因；锁定item必须可解释而非消失。
- Receipt redaction会降低exact-body proof；必须记录redaction event和proof降级，不能改旧hash。
- backup inventory不完整时，forget UI只能声称已清理已管理副本，不能“全部删除”。
- FTS cleanup失败可能泄露；Search先fail closed并进入privacy recovery。
- migration把legacy empty/forgotten误处理会复活内容；tombstone优先。
- contextual drawer未完成时不能简单移除旧workspace；切换必须保证manage/forget路径可达。
- `projectStateRevision`与Memory version不同步会破Manifest；同UoW强制。

## 19. 对其他计划的依赖

- `03-PROJECT-STATE-REVISION-AND-MANIFEST.md`定义revision、selection、payload/stale。
- `04-PERSISTENT-REVIEW-AND-SEMANTIC-CLAIMS.md`保存Review-local selection/attempt。
- `05-PROGRESSIVE-RESEARCH-BRIEF.md`定义current task触发与context limitations。
- `06-TASK-ORIENTED-IA-AND-PRODUCTION-UI.md`定义drawer/Project/History位置。
- `11-DATA-MIGRATION-COMPATIBILITY-AND-ROLLBACK.md`定义state/checkpoint/backup迁移。
- `12-PRIVACY-SECURITY-AND-THREAT-MODEL.md`定义forget/redaction/backup威胁。
- `13`验证never_send、no-network、forget破坏性矩阵。
