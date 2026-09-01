---
title: "Appeal、第二意见与 Deliberation 收敛计划"
status: proposed_complete_plan
implementation_status: not_started
baseline_release: v0.2.0
baseline_commit: caf893db7928bab91c4098eb04a7e4a8d4c62ffe
source_review: Sestina-v0.2.0-对抗性产品审查.md
source_findings: ["P2-01", "P1-06", "P1-02", "P0-01", "改进项-07"]
depends_on: ["01-REVIEW-CANONICAL-TRANSITION.md", "02-AUTHORITY-PROVIDER-DECOUPLING.md", "03-PROJECT-STATE-REVISION-AND-MANIFEST.md", "04-PERSISTENT-REVIEW-AND-SEMANTIC-CLAIMS.md"]
blocks: ["06-TASK-ORIENTED-IA-AND-PRODUCTION-UI.md", "11-DATA-MIGRATION-COMPATIBILITY-AND-ROLLBACK.md"]
affected_layers: ["appeal domain", "second opinion", "deliberation", "review history", "provider", "migration", "UI"]
decision_owner: user
---

# Appeal、第二意见与 Deliberation 收敛计划

> 本文件给出该领域的完整目标状态和实施合同。它不是 `v0.2.0` 当前事实，也不是完成证明；标注 `existing_verified` 的内容仅表示基线代码中已直接核对。

## 1. 计划结果

完成后，**原 assessment 不可变**：原 Provider assessment/Finding 永久不可变；用户在原 Review history 内追加 correction record，可跳过或显式取得一次 `runtime-distinct second opinion`，界面始终显示 Provider identity 与 `cognitive independence unproven`。correction不会形成独立 Resolution truth，而是回到同一 canonical effect preview/commit。Deliberation Room 从默认导航和新建能力移除；历史 Room 可读、导出、恢复，Resolution仅作为历史意见。系统不增加第三 synthesis Agent、winner、vote、agreement score或更多轮次。

## 2. 来源发现与证据边界

### 对应发现

- `P2-01`：Appeal/second opinion/Room有严格runtime identity、context isolation、sealed attempts、无投票/赢家等真实保护，但最终Resolution主要形成自己的Receipt/状态，未统一进入Brief/Decision/Issue/Evidence transition。
- `P1-06`：Appeal和Room成为独立对象/一级入口，增加认知负担。
- `P1-02`：runtime隔离可能被用户误解为认知独立或正确性。

### `existing_verified` 保护

- `CorrectionAppeal`状态持久化；原Finding hash/source binding；second opinion Manifest与独立connection/endpoint identity比较。
- independence basis为`runtime_and_context_isolated`；Room明确`cognitiveIndependence: "unproven"`。
- Room恰好2参与者、互盲initial round、最多directed challenge、无自动retry/synthesis/winner/vote。
- interrupted/unknown、partial、stale、cancelled等失败状态存在。

### 精确代码

- `packages/research/src/appeal/correction-appeal.ts`、`packages/core/src/correction-appeal.ts`、`packages/review/src/semantic/correction-appeal-second-opinion.ts`。
- `packages/research/src/deliberation/deliberation-room.ts`、`packages/core/src/deliberation-room.ts`。
- migrations 017/018、对应repositories/React workspaces。

## 3. 当前状态与根因链

```text
Provider Finding →独立Appeal aggregate→Second opinion→Appeal Resolution/Receipt
或 Project object→独立Room→两份assessment→Difference→Room Resolution
→ 用户仍需去其他对象页面实际修改研究状态
→ Resolution看似完成，但canonical object未必改变
```

增加“Resolution仅供参考”的文案不够，因为独立状态机、独立导航、独立Receipt仍在产品结构上表达第二套完成真相。需要把纠错能力嵌入原Review，并冻结Room写路径。

## 4. 方案空间

| 方案 | 纠错能力 | canonical truth | 认知负担 | 历史兼容 | 维护 |
|---|---|---|---|---|---|
| A. 完全删除Appeal与Deliberation，包括历史 | 低 | 单一 | 低 | 差；丢审计 | 低 |
| B. 保留Appeal/Room为高级实验功能，可新建 | 高 | 仍有旁路 | 高 | 强 | 高 |
| C. Appeal嵌入Review；second opinion可选；Room新建删除、历史只读 | 高且聚焦 | 单一 | 中低 | 强 | 中 |
| D. 保留独立Room但Resolution自动写canonical state | 高 | 可统一但多Agent控制复杂 | 高 | 中 | 极高 |
| E. 将Deliberation做成独立研究工具/产品 | 与Sestina核心分离 | 各自 | 产品范围扩大 | 可 | 很高 |

### 完全删除Deliberation的反事实

核心Sestina更清楚；损失的是两份隔离意见的比较协议，而不是核心Review/Authority。基于直接产品增量，active Room应退出；历史与可选second opinion足以保留有价值部分。

## 5. 最终推荐裁决

选择 **C：Appeal内嵌Review，保留一次可选second opinion；active Deliberation删除，history只读**。

- `CorrectionRecord`是Review child，引用immutable original assessment/finding。
- second opinion只证明runtime identity不同与context isolation；统一label `runtime-distinct`，始终附`cognitive independence unproven`。
- 用户可直接跳过second opinion，写公开correction reason并形成effect preview。
- comparison是derived/non-authoritative；无synthesis Provider。
- Room不能新建、retry、challenge或resolve；旧Room renderer只读/导出/恢复。
- 历史Resolution不自动迁移为Decision；若用户要继续，显式“Create Review draft from this history”。
- 牺牲多Agent仪式感，保留真正的纠错、provenance和隔离证据。

## 6. 目标领域模型

### 6.1 Review correction (`proposed_new`)

```ts
interface ReviewCorrectionRecord {
  correctionId: string;
  reviewId: string;
  projectId: string;
  sourceAssessmentId: string;
  sourceFindingId?: string;
  originalAssessmentHash: string;
  userStatement: string;
  requestedCorrection: "withdraw" | "qualify" | "replace" | "request_more_context";
  secondOpinionAttemptId?: string;
  comparison?: CorrectionComparison; // derived
  resultingEffectDraftId?: string;
  status: "recorded" | "second_opinion_prepared" | "second_opinion_running" |
          "second_opinion_uncertain" | "second_opinion_recorded" |
          "effect_prepared" | "closed" | "cancelled" | "stale";
  version: number;
}
```

Original `ProviderAssessmentEnvelope` immutable；correction不覆盖它。

### 6.2 Second opinion identity

保留existing字段：connectionId、providerId、family、model、endpoint identity hash、config generation、locality；增加用户projection：

- `runtimeDistinct: true|false`；
- `contextIsolated: true|false`；
- `cognitiveIndependence: "unproven"`（固定，不提供true选项）；
- `originalAssessmentExcludedFields`；
- Manifest/exact request identity。

如果同connection/endpoint/model/generation，不能称second opinion；可作为“repeat assessment”但本计划不默认提供。

### 6.3 Comparison

`agreement|direct_contradiction|qualified_agreement|insufficient_for_comparison`保留为derived；显示sources，不产生Authority。禁止agreement score、winner、vote。

### 6.4 Legacy Room projection

`LegacyDeliberationRecord`从原Room完整数据只读映射：participants/identity、manifests、attempts、difference、resolution、unproven列表、events。`canCreate/canRetry/canChallenge/canResolve=false`。

## 7. 状态机与 transition

### Correction lifecycle

| from | action/actor | precondition | mutation | to | failure/restart |
|---|---|---|---|---|---|
| none | start correction / user | source assessment/finding存在且immutable | append correction | `recorded` | source stale标注但仍可记录历史纠正 |
| recorded | skip second opinion / user | 无 | effect composer可用 | `effect_prepared` | 无Provider不阻塞 |
| recorded | prepare second opinion / user | runtime-distinct Provider、fresh Manifest | persist attempt | `second_opinion_prepared` | same runtime→blocked并解释 |
| prepared | confirm/run / user+Kernel | exact body confirmed | running先持久化 | `second_opinion_running` | crash→uncertain，不自动重发 |
| running | valid result | binding/schema/span valid | immutable result+comparison | `second_opinion_recorded` | invalid/fail可回recorded |
| running | crash/write unknown | 无法证明 | uncertain | `second_opinion_uncertain` | 用户可跳过或显式新attempt |
| recorded/result | prepare effect | user | unified effect draft | `effect_prepared` | stale target→stale |
| effect_prepared | commit | user | 走`01` atomic transition | `closed` + Review committed/disposed | 无独立Resolution |
| any nonterminal | cancel | user | 无active commit | cancelled | history保留 |

### Legacy Room

所有active commands返回read-only/410；读取、导出、backup/restore合法。用户点击“Continue as Review”时创建新的Review draft，source指向legacy Room；不复制Room Resolution为Authority。

## 8. 数据流与 Authority 流

```text
Original Review assessment (immutable)
→ user correction record
→ [optional runtime-distinct Provider Manifest/send]
→ second opinion (non-authoritative, cognitive independence unproven)
→ deterministic comparison
→ user selects canonical effect preview
→ same Authority/UoW/Receipt path

Legacy Room → read-only history → explicit new Review draft → same path
```

网络只在second opinion显式send；Room历史读取/导出无网络。

## 9. API、Schema、Repository 与代码边界

| 当前模块 | 当前 | 目标 | 修改 | 验证 |
|---|---|---|---|---|
| `packages/research/src/appeal/correction-appeal.ts` | 独立aggregate/resolution | legacy parser + correction child model迁移 | 重构/兼容 | `existing_verified` |
| `packages/core/src/correction-appeal.ts` |独立service/provider attempts | ReviewCorrectionService复用persistent Review attempts | 重构 | `existing_verified` |
| `correction_appeals` table | active状态机 | migration源；新写冻结 | 只读compatibility | `existing_verified` |
| `research_review_corrections` | 不存在 | correction/second opinion refs | `proposed_new` | 计划对象 |
| `packages/research/src/deliberation/deliberation-room.ts` |完整active Room | legacy domain parser/export，禁止new transitions于production | 收缩 | `existing_verified` |
| `DeliberationRoomService` | active orchestration | history reader only；测试fixture可保留隔离 | 收缩 | `existing_verified` |
| `deliberation_rooms` table | active rows | read-only legacy store | 冻结 | `existing_verified` |
| `apps/research-room/client/src/components/product/CorrectionAppealWorkspace.tsx` |独立route | ReviewThread correction section | 重构 | `existing_verified` |
| `apps/research-room/client/src/components/product/DeliberationRoomWorkspace.tsx` |active UI | `LegacyDeliberationHistoryView` | 重构 | `existing_verified` |
| routes `/appeals/new`,`/deliberation-rooms/new` | active create | 移除/410/redirect | 删除 | `existing_verified` |

Second opinion Provider adapter可复用现有request compiler，但输出进入Review attempt schema，不新建第三种provider status。

## 10. UI 与交互

- Provider assessment卡片提供“纠正此评估”。展开后先显示原评估不可改、用户statement、选择skip或second opinion。
- second opinion配置显示Provider/model/origin/generation；若runtime不distinct，按钮disabled并写“这不是运行时不同的第二意见”。
- 固定说明：“运行时身份与上下文隔离已验证；认知独立性未证明。”不能折叠到看不见。
- comparison并列原/第二意见，列agreement/contradiction/missing context，不给score/winner。
- 下一主动作是“决定如何改变项目”，进入统一effect composer；不是“Resolve appeal”。
- 原assessment、correction、second opinion、effect/result按时间嵌在Review Thread。
- no Provider/offline/failed/uncertain仍可跳过并形成effect。
- History中的Room显示read-only banner、原protocol、unproven项、export；所有active controls消失。
- old unresolved Room提供一个次动作“以此历史创建新的Review”，预览将复制的candidate和source。
- screen reader清楚区分Original assessment、User correction、Second opinion、Canonical result；不靠A/B颜色。

## 11. 中文／English 与术语

- Appeal → 用户文案“纠正此评估 / Correct this assessment”。
- Resolution → 新路径弃用；使用`canonical effect`/“决定如何改变项目”。
- Independent second opinion → 禁止；改`runtime-distinct second opinion` / “运行时不同的第二意见”。
- 固定声明：`cognitive independence unproven` / “认知独立性未证明”。
- Deliberation Room → 仅历史名称“Legacy Deliberation Room / 历史会商记录”。
- Agreement/contradiction → “意见关系”，不是事实判决。
- Manual external opinion → Host/手工suggestion来源，进入Review draft，不属于Room participant。

不得使用“两个独立Agent达成结论”“会商解决了争议”“共识分数”等主张。

## 12. 隐私、安全与权限

- second opinion exact Manifest继续排除original verdict/reason/confidence/raw response，保留existing context isolation；用户可查看excluded fields。
- Participant identity/secret hash不泄露secret；endpoint identity显示origin摘要。
- same runtime不能伪装distinct；identity compare在Kernel。
- Provider output untrusted；无tools、无Authority、size/timeout/redirect限制。
- legacy Room export可能含研究内容，需显式选择路径/提醒敏感性；不自动上传。
- “Continue as Review”只复制用户可见candidate文本和provenance，不复制Host command/path/secret。
- original assessment不可变；privacy redaction通过单独记录，不篡改hash。
- active legacy endpoints server-side冻结，避免隐藏UI可调用。

## 13. 数据迁移与向后兼容

- 每个`correction_appeals` row迁移为`ReviewCorrectionRecord`，关联source Receipt/Review/Finding；原status、attempt、Manifest、result、comparison、receipt存legacy payload。
- resolved Appeal的Resolution不变成canonical effect；若基线已另行改变Brief/Decision，那个对象仍是canonical，correction仅历史关联。
- active/incomplete Appeal标`legacy_incomplete`并可显式continue；不自动Provider retry。
- 所有`deliberation_rooms`保留原表或copy到legacy history store；写trigger/repository冻结。
- old Room Resolution保持non-authoritative history；不创建Decision/Evidence。
- old active Room在新UI显示closed-for-migration/read-only；用户可导出或create Review draft。
- Search index重建为History result；Attention不再把Room workflow当action，除非提供explicit convert-to-review提醒。
- downgrade只用pre-migration backup。

## 14. 测试与验证

- RED：原assessment update API不存在/失败；correction只append。
- RED：correction完成不能直接写Resolution；必须有effect command。
- unit：runtime identity compare、context exclusion、comparison derived、cognitive independence固定unproven。
- provider：same connection/model/endpoint blocked；timeout/invalid/uncertain/no auto retry。
- state-machine：skip second opinion、failed、stale、cancel、effect closed。
- migration：每种legacy Appeal/Room status，Resolution不生成对象。
- API/security：legacy create/retry/challenge/resolve returns read-only/410；history read/export works。
- E2E：correct assessment→skip→effect；second opinion→compare→effect；legacy Room→Review draft。
- crash：second opinion running→uncertain，no network on restart。
- accessibility/visual：A/B不靠颜色、long rationales、200%、screen reader。
- no third Provider call/synthesis路径架构测试。
- 这些测试不证明两份模型意见认知独立或真实价值。

## 15. 完整验收标准

- 原Provider assessment/Finding字节/hash不被correction覆盖。
- correction与second opinion显示在原Review history，不出现在一级导航。
- no Provider也能纠正并提交effect。
- runtime identity/context isolation可验证，且所有表面显示cognitive independence unproven。
- comparison没有winner/vote/score/Authority。
- correction最终只能`record_only`或统一typed effect；resulting object/Receipt/revision一致。
- production UI无新建Room、retry、challenge、resolve入口；server同样拒绝。
- 历史Room完整可读、可导出、可备份恢复；unproven项保留。
- legacy Resolution不自动生成Decision/Evidence/Brief change。
- Search/History能找到旧Appeal/Room但不会形成second truth。
- Provider/Manifest/privacy/failure protections不回归。

## 16. 明确非目标

- 不增加第三synthesis Agent。
- 不增加participants、轮次、vote、winner、agreement score。
- 不证明认知独立性。
- 不保留Deliberation为默认高级实验功能。
- 不让Appeal Resolution写第二套truth。
- 不自动把disagreement变Evidence/Issue。
- 不删除历史审计数据。
- 不评价真实模型谁更准确。

## 17. 被拒绝方案与重新考虑条件

- **A完全删除历史**：只有用户明确要求不可恢复删除且无审计义务时重开；默认不采用。
- **B高级active Room**：只有可重复、非冗余直接增量由内部产品测试证明确立且仍能走统一effect时重开；当前审查证据不足。
- **D Room自动写canonical**：只有多Agent被授权为用户Authority时才可能，违反不变量。
- **E独立产品**：需要独立产品定义/仓库，不属于本重构。
- **增加synthesis**：不重开；会再增加一层model-over-model且无Authority。

## 18. 实施风险与失败收缩

- 冻结Room写但旧UI仍可调用会产生错误；server先冻结、route后移除、history renderer同时上线。
- migration关联source Finding可能缺ID/hash；保留legacy orphan projection，不猜关系。
- second opinion复用旧provider compiler时术语可能仍写independent；`15`与schema同步更新。
- correction与effect分属不同UoW时可能“closed但未commit”；closed只由effect transaction设置。
- 历史Room表继续存在可能被新代码误用；repository接口拆成read-only legacy type，禁止注入active service。
- 如果实施中只移除Room而未迁Appeal，用户失去纠错入口；两者同一切换边界完成。

## 19. 对其他计划的依赖

- `04-PERSISTENT-REVIEW-AND-SEMANTIC-CLAIMS.md`拥有Review/attempt/correction persistence。
- `01-REVIEW-CANONICAL-TRANSITION.md`是唯一effect/Receipt路径。
- `02-AUTHORITY-PROVIDER-DECOUPLING.md`定义assessment声明等级。
- `03-PROJECT-STATE-REVISION-AND-MANIFEST.md`定义second opinion Manifest/stale。
- `06-TASK-ORIENTED-IA-AND-PRODUCTION-UI.md`定义Review内嵌与History路由。
- `11-DATA-MIGRATION-COMPATIBILITY-AND-ROLLBACK.md`是Appeal/Room表级迁移权威。
- `12`处理Provider/legacy export安全，`13`验证无第三Agent/active Room。
