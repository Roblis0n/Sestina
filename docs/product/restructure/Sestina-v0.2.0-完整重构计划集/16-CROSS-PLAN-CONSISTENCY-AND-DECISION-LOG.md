---
title: "跨计划一致性审查与最终决策日志"
status: proposed_complete_plan
implementation_status: not_started
baseline_release: v0.2.0
baseline_commit: caf893db7928bab91c4098eb04a7e4a8d4c62ffe
source_review: Sestina-v0.2.0-对抗性产品审查.md
source_findings: ["P0-01", "P1-01", "P1-02", "P1-03", "P1-04", "P1-05", "P1-06", "P2-01", "P2-02", "改进项-01", "改进项-02", "改进项-03", "改进项-04", "改进项-05", "改进项-06", "改进项-07", "改进项-08", "改进项-09", "改进项-10"]
depends_on: ["00-MASTER-REFACTOR-PLAN.md", "01-REVIEW-CANONICAL-TRANSITION.md", "02-AUTHORITY-PROVIDER-DECOUPLING.md", "03-PROJECT-STATE-REVISION-AND-MANIFEST.md", "04-PERSISTENT-REVIEW-AND-SEMANTIC-CLAIMS.md", "05-PROGRESSIVE-RESEARCH-BRIEF.md", "06-TASK-ORIENTED-IA-AND-PRODUCTION-UI.md", "07-APPEAL-SECOND-OPINION-AND-DELIBERATION.md", "08-GOVERNED-MEMORY-SIMPLIFICATION.md", "09-HOST-PILOT-AND-AGENT-CORRECTOR-INTEGRATION.md", "10-RELEASE-IDENTITY-AND-LOCAL-LIFECYCLE.md", "11-DATA-MIGRATION-COMPATIBILITY-AND-ROLLBACK.md", "12-PRIVACY-SECURITY-AND-THREAT-MODEL.md", "13-TEST-EVAL-AND-PRODUCTION-VERIFICATION.md", "14-IMPLEMENTATION-DEPENDENCY-AND-CHANGE-MAP.md", "15-TERMINOLOGY-DOCS-AND-CLAIM-MIGRATION.md"]
blocks: []
affected_layers: ["cross-plan governance", "domain consistency", "migration consistency", "UI routes", "security/release consistency", "test traceability", "decision log"]
decision_owner: user
---

# 跨计划一致性审查与最终决策日志

> 本文件在其他计划完成后编制，是计划集内部的最终一致性审查。这里的“已解决”表示计划文本之间已统一，不表示仓库实现已经完成。所有目标能力仍为`implementation_status: not_started`。

## 1. 审查范围与方法

逐项对照`00`～`15`的YAML、领域模型、状态机、数据流、Schema/Repository、routes、migration、security、tests和claims，并用精确`v0.2.0`源码做最小定向核对。核对范围包括：

- `packages/core/src/research-room.ts`：in-memory Review Maps、prepare/analyze/commit/rollback、state binding/context构造；
- `packages/research/src/room/research-room.ts`：generic disposition、provider status、Manifest、Receipt；
- `packages/storage/src/migrations/014-review-runs.ts`、`016`～`020`及repositories：持久化边界；
- `apps/research-room/client/src/routing/project-route.ts`、`ProjectShell.tsx`：object-first routes/nav、Open Pilot；
- Provider、server、recovery、release identity与Agent Corrector branch材料。

没有重新进行广泛产品审查；没有读取或使用外部试用者反馈、Pilot参与者行为、访谈、问卷、Issue/Discussion意见、采用、市场或`RI-55`证据。

## 2. 最终统一产品关系

所有计划已经收敛到一条且仅一条关系：

```text
Suggestion
→ Persistent Review Draft
→ State-bound Context Projection
→ Exact Context Manifest
→ Optional Provider Assessment
→ User Canonical Effect Preview
→ User Authority
→ Atomic Canonical Mutation
→ Receipt / Trace as Proof
→ Search / Attention / Resume / Recovery
```

唯一canonical truth是：**Research Deliberation Kernel管理的本地project canonical objects + `projectStateRevision` head/event chain + persistent Review lifecycle。** Search、Attention、Today、Resume、History和UI cache均为携带source revision的derived projections；Receipt是proof record，不是canonical result；Provider、Host、Skill、MCP、Memory和legacy Room/Pilot均不能写第二套truth。

## 3. 强制一致性检查结果

| 检查项 | 结果 | 统一裁决 | 权威文件 |
|---|---|---|---|
| 两套canonical state | 已消除 | canonical objects + revision/event唯一；legacy tables只读；projection可重建 | `00`,`03`,`11`,`14` |
| 两套Review lifecycle | 已消除 | `ResearchReview`专用持久聚合唯一；`review_runs`仅内部checker | `04`,`11` |
| 两套Authority | 已消除 | 只有user actor可commit `CanonicalEffect`；Provider/Host/Agent无Authority | `01`,`02`,`09` |
| Receipt定义 | 一致 | transaction proof，引用resulting object/revision/Manifest；不替代结果 | `00`,`01`,`03`,`15` |
| `projectStateRevision`规则 | 一致 | 每个canonical transaction一次；workflow/settings/projection不推进；compensation推进 | `03`,`01`,`08`,`15` |
| Manifest输入清单 | 一致 | active Brief、selected Decisions/Evidence、relevant Issues、Episode、Suggestion、explicit Memory、limitations、relevant review outcome summary；排除raw Receipt/Trace/secret/path/CoT | `03`,`08`,`12` |
| Provider声明等级 | 一致 | assessment + 四个validity flags；无semantic_ready、固定0.66或事实提升 | `02`,`04`,`15` |
| Appeal最终位置 | 一致 | 原Review内immutable correction history；effect回统一transition | `07`,`04`,`06` |
| Room最终位置 | 一致 | 新建/active移除；legacy只读/导出/恢复 | `07`,`11`,`06` |
| Memory最终位置 | 一致 | 内部精细state、四用户态、contextual drawer、explicit share；Memory≠Evidence | `08`,`06`,`03` |
| Pilot最终位置 | 一致 | active Closed Pilot退出；legacy只读；Host只创建Review draft | `09`,`11`,`06` |
| Agent Corrector边界 | 一致 | companion Skill，same-agent ephemeral；显式handoff才入Review；合入主树不等于v0.2.0能力 | `09`,`15` |
| UI routes与Domain | 已统一 | `/project/today`、`/project/reviews/:id`、`/project/state`、`/project/history`、`/project/search`、`/project/settings`；Brief nested routes一致 | `05`,`06`,`15` |
| migration覆盖 | 完整 | 021–025、copy-on-write、lossy mapping、legacy read-only、no dual-write、downgrade via backup | `11`,`14` |
| security与UI/Host/Release | 一致 | Electron typed IPC；Host bridge独立默认off；Provider/paths/secrets/update fail closed | `10`,`12`,`06`,`09` |
| testing覆盖 | 完整 | 每项finding、十项改进和17计划均有证据合同 | `13` |
| release identity与名称 | 一致 | target Electron Desktop App；v0.2.0 archive=local loopback research server preview | `10`,`15`,`00` |
| 中英文术语 | 一致 | `15`为唯一术语/claim权威 | `15` |
| 必要工作被推迟 | 未发现 | 实施有依赖节点，但每份计划描述完整最终状态；没有“以后再补” | 全部 |
| 计划被写成已实现 | 未发现 | YAML均proposed/not_started；current/target/legacy分开 | 全部 |
| 外部反馈/市场证据混入 | 未发现 | 只作为明确非目标/禁止冒充，不作为结论或阻塞 | `13`,`15`,`16` |
| 官方Logo改变 | 未发现 | 原文件/usage rules不变；release以source hash gate | `06`,`10`,`13`,`15` |

## 4. 经定向源码核对后的审查报告修正判断

### 4.1 `review_runs`存在，但不反驳P1-05

**原判断：** 交互式Research Room的pending/analyzed Review只存内存Map，重启丢失。

**代码证据：**

- `packages/core/src/research-room.ts`定义`#pending`、`#inFlight`、`#analyzed` Map；interactive `prepare()/analyze()/commit()`读写这些Map。
- `packages/storage/src/migrations/014-review-runs.ts`和`packages/research-store/src/repositories/sqlite-review-run-repository.ts`确有持久`review_runs`/`review_findings`，但其对象是Episode/Snapshot checker run，状态只有`running|completed_*`，没有Manifest、Provider attempt、Authority disposition或interactive suggestion生命周期。

**裁决：** 原判断不修正；只增加精确澄清：不能因为同名`review_runs`表存在就声称interactive Review已持久化。目标采用专用`research_room_reviews`，不把两种语义强行合表。该澄清已回写`04`、`11`、`13`、`14`。

### 4.2 tag对齐的冻结release-index副本不反驳P2-02

**原判断：** `v0.2.0`公开发行provenance存在sourceCommit/tag target不闭合。

**代码/制品证据：** 工作包内`Sestina/.frozen-local/release-signing-caf893d/public-release/release-index.json`写入正确`sourceCommit=caf893...`；同时仓库工作树`Sestina/public-release/release-index.json`存在不同`sourceCommit`。冻结副本证明项目曾生成tag对齐候选，不证明公开Release资产、公开index和可复现build链最终只指向该副本，也不能替代source tree/toolchain/schema/assets/signed envelope的完整provenance。

**裁决：** 不推翻P2-02；将问题精确化为“公开制品链必须由tag exact commit唯一生成并可独立验证，不能依赖私有冻结目录解释”。该裁决已体现在`10`、`13`、`15`。

### 4.3 没有发现足以推翻P0/P1/P2的生产反证

定向核对没有发现：generic accepted对应隐藏canonical mutation、Provider-independent positive action、persistent interactive Review、task-first production route或真正Desktop lifecycle。因此原审查的P0/P1/P2保持作为计划输入；本文件没有新增无证据严重度。

## 5. 已发现并回写的跨文件冲突

### C-01 Brief history route遗漏

- **冲突文件：** `05-PROGRESSIVE-RESEARCH-BRIEF.md` §9 与原`06-TASK-ORIENTED-IA-AND-PRODUCTION-UI.md` route map。
- **冲突：** `05`定义`/project/state/brief`和`/project/state/brief/history/:versionId`，`06`只列`/project/state`和edit。
- **统一裁决：** 保留`/project/state/brief`、`/project/state/brief/edit`、`/project/state/brief/history/:versionId`作为Project下二级route，不新增一级导航。
- **回写：** 已修改`06` route map；`15`只保留一级术语，不与二级route冲突。
- **理由：** Brief diff/history是完整迁移和冲突处理所需，但不应恢复object-first IA。

### C-02 migration 023名称不一致

- **冲突文件：** `03-PROJECT-STATE-REVISION-AND-MANIFEST.md` §9 与`11-DATA-MIGRATION-COMPATIBILITY-AND-ROLLBACK.md` §6。
- **冲突：** `receipt-effects`与`transition-receipts`两种文件名。
- **统一裁决：** `023-context-manifests-and-transition-receipts.ts`。
- **回写：** 已修改`03`；`11`名称保持。
- **理由：** Receipt证明完整transition，不是effect对象本身。

### C-03 Receipt创建是否导致revision循环

- **涉及文件：** `01`,`03`,`04`,`11`。
- **潜在冲突：** Receipt属于canonical transaction并推进revision；旧实现又把`receiptSummary`放进下次payload，可能造成每个Receipt无限扩大context。
- **统一裁决：** object mutation或`record_only`、Review terminal、revision event/head和Receipt是**同一个**transaction，只推进一次。默认context不包含raw/full Receipt，仅由policy选择确定性的`RelevantReviewOutcomeSummary`；summary的来源transaction已推进revision。后续Review可因新的相关outcome而stale，这是预期，不是循环。
- **回写状态：** `03` §6.4/§6.5、`00` §7和`13` tests已一致。

### C-04 Provider generation与project revision

- **涉及文件：** `02`,`03`,`10`。
- **潜在冲突：** Provider配置会改变exact body，但不是研究状态。
- **统一裁决：** Provider settings/generation不推进`projectStateRevision`；Manifest单独绑定generation/model/origin/serializer identity，任何变化都stale。配置若被错误存在project DB，migration搬至app settings/keychain，但policy不变。
- **回写状态：** `02` §13、`03` revision matrix、`10` settings migration一致。

### C-05 Review/Appeal/assessment是否推进revision

- **涉及文件：** `03`,`04`,`07`。
- **统一裁决：** draft、Manifest、attempt、assessment、correction、second opinion均non-authoritative，不推进project revision，由各自version管理；一旦用户提交`record_only`或typed effect，作为canonical review outcome transaction推进一次revision。
- **理由：** 防止workflow噪声制造项目revision，同时让用户最终处置能stale旧Manifest和进入History/Resume。

### C-06 Memory选择与Memory状态变化

- **涉及文件：** `03`,`08`。
- **统一裁决：** confirm/edit/stale/expire/renew/retire/forget改变project-governed context，推进revision；某一Review内选择哪些eligible items只推进Manifest/Review version，不推进project revision。item在选择后变化会stale Manifest。
- **回写状态：** `03`、`08`规则一致。

### C-07 Appeal Resolution与Room Resolution的truth位置

- **涉及文件：** `07`,`01`,`04`,`11`。
- **统一裁决：** 新系统没有独立canonical Resolution。Appeal correction只能准备`record_only`/typed effect并由统一Authority commit；legacy Appeal/Room Resolution作为历史文本和protocol record只读。不能从legacy Resolution反推canonical object。

### C-08 Agent Corrector是否合并

- **涉及文件：** `09`,`15`,`14`。
- **统一裁决：** 在完整重构实现中，发布后分支经rebase/安全审查后合入主树的`integrations/skills`作为companion Skill；不进入`packages/core`、默认nav或Authority。其输出是ephemeral candidate，只有用户显式handoff才成为persistent Review draft。合入不倒算为`v0.2.0`能力。
- **重新打开条件：** 只有项目决定将其另立独立产品/仓库；在Sestina内部不得变第二纠偏真相。

### C-09 Desktop vs loopback最终形态

- **涉及文件：** `00`,`06`,`09`,`10`,`12`,`15`。
- **统一裁决：** target是Electron Desktop App；生产renderer通过typed IPC，不暴露Research Room UI HTTP。Host draft bridge独立、默认off。`v0.2.0` archive和dev harness称local loopback research server preview。
- **理由：** 最大复用现有Node/React/SQLite，减少system-browser/UI HTTP面，形成真实三平台lifecycle。

### C-10 generic disposition历史映射

- **涉及文件：** `01`,`04`,`11`,`15`。
- **统一裁决：** `rejected/deferred`→lossless `record_only`；`accepted/modified_accepted`→lossy `legacy_record_only_unresolved_effect`，保留原文但不制造Decision/Evidence；`direction_changed`仅在Brief before/after证据匹配时映formal direction change。所有legacy记录只读。

### C-11 Receipt与canonical result

- **涉及文件：** 全部用户旅程/文档。
- **统一裁决：** resulting Brief/Decision/Issue/Evidence或明确`record_only` outcome是结果；Receipt/Trace证明transaction。UI success先显示resulting object/revision，再显示Receipt；Search/Attention从canonical+revision构建，不从Receipt重放为truth。

### C-12 `review_runs`与`ResearchReview`命名

- **涉及文件：** `04`,`11`,`14`,`15`。
- **统一裁决：** `review_runs`保留内部checker run，用户不可见；interactive object内部名`ResearchReview`、表`research_room_reviews`、UI名Review。文档出现“Review run”必须明确checker subsystem。

### C-13 UI、Security与Desktop的依赖环

- **冲突文件：** 原`06` frontmatter依赖`10`，原`10`又阻塞`06`；原`10`依赖`12`，原`12`又依赖`10`。
- **统一裁决：** Domain/IA和威胁模型先固定，顺序为`12`安全边界→`06`生产UI合同→`10`Electron封装与三平台lifecycle；视觉设计fixture可并行，但packaged production验收在`10`后由`13`执行。
- **回写：** 已调整`06`、`10`、`12`的`depends_on/blocks`，并把`00`依赖图改为`P06→P10`；依赖图现为有向无环图。
- **理由：** Security不应等待壳实现才定义，Desktop也不能在UI主旅程尚未稳定时成为UI的前置；同时最终视觉证据仍必须来自packaged Desktop。

### C-14 Verification与Implementation Map的方向

- **冲突文件：** 原`00`依赖图写`P14→P13`，而`14` frontmatter和正文要求先有RED/verification contracts再制定实施门。
- **统一裁决：** `15`术语/claim合同→`13`统一验证合同→`14`实施依赖与change map→`16`最终一致性。`13`可以覆盖`14`作为最终复核对象，但其基础测试合同不等待`14`。
- **回写：** 已把`13` frontmatter加入对`15`的依赖，并把`00`图改为`P15→P13→P14→P16`。
- **理由：** 先定义可证伪完成条件，才能让实施节点的进入/退出门不依赖主观判断。

## 6. 最终字段与状态权威摘要

### 6.1 Canonical effect

```text
record_only
create_decision
add_evidence
create_or_resolve_issue
patch_brief
formal_direction_change
```

所有effect具有kind、payload、target refs/expected versions（适用时）、reason、preview hash、idempotency key。只有user actor可commit。

### 6.2 Review lifecycle

```text
draft
manifest_prepared
manifest_confirmed
provider_attempt_prepared
provider_attempt_running
provider_attempt_uncertain
provider_attempt_failed
assessment_recorded
stale
disposed
committed
cancelled
```

`effect_preview_ready`是Review内持久effect draft/preview属性，不另建第二顶层状态机。`provider_attempt_running`在crash后恢复`provider_attempt_uncertain`，绝不自动resend。

### 6.3 Revision推进

推进：Brief/Decision/Issue/Evidence/Episode/Memory canonical change、record-only outcome、typed effect、privacy redaction/forget compensation、migration baseline、rollback/compensation。每transaction一次。

不推进：Review draft/Manifest/Provider attempt/assessment/correction/second opinion、Host draft、Provider settings、UI prefs、Search/Attention rebuild、backup/export。Provider generation仍能单独stale Manifest。

### 6.4 Manifest identity

```text
projectStateRevision
contextProjectionPolicyVersion
contextProjectionSchemaVersion
contextProjectionHash
providerId/model/origin/configGeneration/serializerVersion
exactRequestHash + exactRequestBytes + protected exactRequestBody
selected Memory refs/versions/hashes
excluded fields + context limitations
```

send前从同一transaction snapshot重建并比较；任一不一致零网络、precise stale reason。

## 7. 最终页面与对象位置

| 用户任务 | 主route | 主要对象 | 二级/历史位置 |
|---|---|---|---|
| 现在做什么/处理Review | `/project/today` | derived Today + persistent Review queue | Attention内嵌 |
| 新建议 | `/project/reviews/new` | Review draft | source provenance |
| 完成审议 | `/project/reviews/:reviewId` | Review/Manifest/assessment/effect/result | Inspector technical proof |
| 查看研究状态 | `/project/state` | Brief/Decision/Evidence/Issue/Episode关系 | `/state/brief*`等二级 |
| 查找 | `/project/search` | revision-bound results | object/review/history detail |
| 历史与证明 | `/project/history` | Receipt/correction/legacy Room/Pilot | `/history/:kind/:id` |
| 配置/隐私/恢复 | `/project/settings` | app/project settings | Provider/Host/Recovery/About sections |

Memory是Review/Brief contextual drawer和Project history；Appeal是Review correction；Room/Pilot只有history。Inspector默认关闭。

## 8. Migration、security、testing与implementation闭合核对

### Migration

`11`逐表覆盖013–020及new 021–025；所有计划新增对象均有目标table/repository或明确复用；generic/Appeal/Room/Memory/Pilot/Search/Brief/Provider settings均有映射；copy-on-write/prebackup/journal/crash/rollback/future/old/corrupt/Brief binding/downgrade完整。没有领域计划要求双写。

### Security

Electron/main/preload/renderer、Host bridge、legacy loopback、Provider endpoint/DNS/redirect/private/metadata、path/symlink/junction、secret/log/error、backup/temp/crash、prompt injection、MCP/Skill capability、Manifest/Memory/forget/export/uninstall/update均有威胁/测试/failure shrink。UI route或Host能力没有越过`12`。

### Testing

`13`覆盖P0/P1/P2、十项改进、17计划、RED/domain/state/property/UoW/repository/migration/API/IPC/provider exact body/concurrency/crash/no-network/security/backup/large/performance/cross-platform/production E2E/a11y/theme/language/visual/release。Fixture/screenshot/hash证据等级被限制；真实Provider质量、外部用户价值和市场价值未作为完成条件。

### Implementation

`14`先合同/RED/Schema/repository/UoW，再effect+Review，后Brief/Appeal/Memory/Host/projections/UI/Desktop/docs/verification，最后移除legacy active paths；节点不是可独立出货版本。任何中断都有不产生混合truth的收缩路径。

## 9. 决策日志

| ID | 最终决定 | 选择理由 | 被拒绝方案 | 重新考虑条件 |
|---|---|---|---|---|
| D-01 | typed `CanonicalEffect`，删除新写generic disposition | 让Review产生真实结果 | disposition+target metadata；纯event command UI | 仅需支持完全新effect family时扩展enum，不恢复generic |
| D-02 | user Authority与Provider完全解耦 | Provider不应控制研究方向 | semantic-ready gate；自动Authority | 不重开 |
| D-03 | global monotonic revision + projection/request hash | 兼顾transaction freshness和exact payload | 仅stateHash；仅vector；仅hash | 若单project写吞吐证明全局head不可接受，可内部优化vector，但外部仍有单调commit序列 |
| D-04 | 专用persistent interactive Review | Map不可恢复，checker run语义不同 | Map JSON；复用review_runs；无Review aggregate | 不重开，除非删除整个跨会话Review产品 |
| D-05 | progressive Brief typed form | 平衡低摩擦与Context边界 | 一次填满；question-only永久；LLM自动提升 | 只在字段无法支持目标effect时调整schema |
| D-06 | task-first IA四个一级入口 | 用户任务优先，复杂对象渐进呈现 | 保留object nav；纯chat；dashboard cards | 只有新不可约简任务出现时增加入口 |
| D-07 | Appeal嵌入Review，Room legacy只读 | 消除第二truth和仪式扩张 | 完全删除历史；高级active实验；独立工具 | 只有独立会商产生可证明canonical增量且仍回统一effect时重开active |
| D-08 | Memory内核保留、UI四态 | 保留安全保护，压缩知识库负担 | 删除；只pin；维持六态UI | 只有Memory不再减少重复解释时考虑删除 |
| D-09 | Host draft-only、MCP read-only、Agent Corrector companion | 保持薄集成和统一Review | Closed Pilot主UI；Host Authority；通用Agent平台 | Host bridge风险不可控时收缩为手工文件导入，不扩权 |
| D-10 | Electron Desktop App | 与产品身份/lifecycle一致，复用TS/Node/React/SQLite | bundled server/browser；Tauri sidecar；archive永久形态 | Electron维护/安全成本有直接证据失控，且替代方案可保持Kernel/lifecycle |
| D-11 | copy-on-write migration、legacy read-only、no dual-write | 防混合truth和历史伪造 | in-place；dual-write；重新导入；不迁移 | 不重开dual-write；磁盘不足可提供用户选择备份位置 |
| D-12 | Receipt=proof，canonical object/outcome=result | 防日志替代研究状态 | event log作为唯一truth；Receipt自动成为Evidence | 不重开 |

## 10. 是否仍存在未决产品选择

**不存在留给后续编码Agent自行决定的产品级分叉。** 本计划已经对typed effect、Authority policy、revision模型、Review persistence、IA、Appeal/Room、Memory、Host/Pilot/Agent Corrector、migration、security、testing和发行形态作出明确推荐裁决。

需要用户正式批准的是整套目标本身，而不是让编码Agent再次比较方案。若只要求一个需要显式签署的最高影响决定，推荐批准 **D-10 Electron Desktop App + legacy loopback preview准确降级**；它已与Kernel、security、migration和UI计划绑定，不能单独换壳而保留旧产品关系。

## 11. 计划集完成定义

计划集内部完成意味着：

1. 17份计划和FILE-MANIFEST全部存在、非空、YAML一致；
2. 本文件列出的冲突已回写受影响文件；
3. P0/P1/P2和十项改进均有计划与验证；
4. 无两套canonical state/Review/Authority；
5. migration/security/testing/implementation覆盖全部领域；
6. current/target/legacy和中英文声明一致；
7. 没有把计划写成完成事实；
8. 没有使用排除的外部/市场证据；
9. 官方Logo约束保持；
10. ZIP机械核对通过。

这一定义只证明计划集完整，不证明Sestina代码已实施。
