---
title: "Persistent Review lifecycle 与 semantic claims 分层计划"
status: proposed_complete_plan
implementation_status: not_started
baseline_release: v0.2.0
baseline_commit: caf893db7928bab91c4098eb04a7e4a8d4c62ffe
source_review: Sestina-v0.2.0-对抗性产品审查.md
source_findings: ["P1-05", "P1-02", "P1-03", "P0-01", "改进项-04"]
depends_on: ["01-REVIEW-CANONICAL-TRANSITION.md", "02-AUTHORITY-PROVIDER-DECOUPLING.md", "03-PROJECT-STATE-REVISION-AND-MANIFEST.md"]
blocks: ["05-PROGRESSIVE-RESEARCH-BRIEF.md", "06-TASK-ORIENTED-IA-AND-PRODUCTION-UI.md", "07-APPEAL-SECOND-OPINION-AND-DELIBERATION.md", "09-HOST-PILOT-AND-AGENT-CORRECTOR-INTEGRATION.md", "11-DATA-MIGRATION-COMPATIBILITY-AND-ROLLBACK.md"]
affected_layers: ["review aggregate", "provider attempts", "semantic claims", "storage", "API", "UI", "crash recovery"]
decision_owner: user
---

# Persistent Review lifecycle 与 semantic claims 分层计划

> 本文件给出该领域的完整目标状态和实施合同。它不是 `v0.2.0` 当前事实，也不是完成证明；标注 `existing_verified` 的内容仅表示基线代码中已直接核对。

## 1. 计划结果

完成后，Review 从 suggestion 进入的第一刻起就是项目内持久化、versioned、可恢复的非权威工作流聚合；`draft`、`manifest_confirmed`、`provider_attempt_prepared`、`provider_attempt_uncertain`、`assessment_recorded`、`stale`、`disposed`、`cancelled`、`committed` 均有明确 transition。进程重启不会丢失 Review，也不会自动重复外发。`semantic_ready` 被删除，Finding/ArgumentDelta只作为 Provider assessment 的公开结构化主张；request binding、response schema、quoted-span integrity与assessment availability分别持久化和呈现。

## 2. 来源发现与证据边界

### 对应发现

- `P1-05`：`ResearchRoomService` 的 `#pending`、`#inFlight`、`#analyzed`、rollback conflict均为进程内Map；只持久化终结Receipt。
- `P1-02`：parse成功后直接设置`semantic_ready`；`analysisFrom()`将`substantive`映射`theoretical_contribution`并生成固定/过强表述。
- `P1-03`：无Provider时形成模板analysis，但不是本地semantic review。

### 一个需要澄清但不推翻原审查的代码事实

基线存在`review_runs`/`review_findings`（migration 014、`sqlite-review-run-repository.ts`），但它们是绑定Episode/Snapshot的deterministic/semantic checker run，并未被`ResearchRoomService`用于交互式pending/analyzed Review。因此“交互式Review生命周期未持久化”仍成立；本计划不复用该表，以免混合两种生命周期。

### 必须保留

- Provider调用前exact Manifest确认；无自动retry。
- response untrusted decoder、span/hash校验、size limit。
- 原assessment/Receipt可审计，不保存hidden CoT。
- user-only commit与future schema fail-closed。

## 3. 当前状态与根因链

```text
Suggestion
→ #pending Map（Manifest）
→ #inFlight Map（Provider）
→ #analyzed Map（assessment等待处置）
→ 只有commit后Receipt入库

进程退出/崩溃
→ Map消失
→ UI无法恢复Review阶段
→ 用户不知道是否发送、是否收到、是否可安全重试
```

同时，`semantic_ready`把四件不同的事压成一个状态：请求是否绑定、响应是否符合Schema、quote位置是否一致、Provider是否给出assessment。持久化Map而不重构声明只会把误导保存得更久，因此必须一起改。

## 4. 方案空间

| 方案 | 生命周期恢复 | 与现有`review_runs`关系 | 语义边界 | 迁移/维护 | 第二状态机风险 |
|---|---|---|---|---|---|
| A. 将Map序列化为临时JSON文件 | 部分；并发/事务弱 | 独立 | 可改 | 低中 | 高；文件与DB两套真相 |
| B. 复用`review_runs`表，扩展大量状态 | 可恢复 | 混合Episode checker与interactive Review | 易混 | 中 | 中；一个表两种不兼容语义 |
| C. 新建专用`research_room_reviews` aggregate + provider attempts/corrections；统一Receipt/effect | 完整 | `review_runs`保留内部checker用途 | 强 | 中高 | 低；互动Review唯一生命周期 |
| D. 把每个阶段建成独立Manifest/Finding/Appeal对象，不设Review aggregate | 可恢复 | 无关 | 分散 | 高 | 极高 |
| E. 完全删除Provider前阶段，只在commit时同步调用 | 崩溃风险更高 | 简单 | 弱 | 低 | 低但无法Manifest/用户理解 |

### 完全删除持久化Review的反事实

产品只能把每次审议当一次性对话；跨重启、Provider uncertain、Host queue与Appeal source均失去因果链，核心连续性承诺不成立。

## 5. 最终推荐裁决

选择 **C：专用 persistent interactive Review aggregate**。

- `review_runs`继续作为内部checker/snapshot运行记录，命名和UI不与Research Review混用。
- 一个`ResearchReview`聚合拥有suggestion、source、base revision、Manifest refs、attempt refs、assessment、effect draft、terminal outcome与version。
- Provider attempt另表append-like记录外发不确定性；原assessment immutable。
- correction作为Review child record；不再有独立Appeal truth。
- generic Map全部退出生产真相；可以保留仅用于AbortController句柄，但句柄状态不能决定可恢复状态。
- 牺牲schema/migration工作，换取跨崩溃连续性、幂等和诚实网络事实。

## 6. 目标领域模型

### 6.1 `ResearchReview` (`proposed_new`)

```ts
interface ResearchReview {
  schemaVersion: "2.0.0";
  id: string;                  // rrvw_ or preserve rrvw_ legacy format
  projectId: string;
  source: ReviewSource;
  suggestion: string;
  suggestionHash: string;
  requestedTarget?: ObjectRefHint;
  status: ResearchReviewStatus;
  baseProjectStateRevision: number;
  manifestId?: string;
  providerAttemptIds: readonly string[];
  providerAssessment?: ProviderAssessmentEnvelope;
  effectDraft?: CanonicalEffect;
  terminalOutcome?: ReviewTerminalOutcome;
  staleReason?: ReviewStaleReason;
  version: number;
  createdAt: string;
  updatedAt: string;
}

type ResearchReviewStatus =
  | "draft"
  | "manifest_prepared"
  | "manifest_confirmed"
  | "provider_attempt_prepared"
  | "provider_attempt_running"
  | "provider_attempt_uncertain"
  | "provider_attempt_failed"
  | "assessment_recorded"
  | "stale"
  | "disposed"
  | "committed"
  | "cancelled";
```

`disposed`用于`record_only`的rejected/deferred/reference-only等无研究对象变更终态；`committed`用于产生canonical object mutation。二者都可有Receipt。

### 6.2 Provider attempt (`proposed_new`)

字段：attempt ID、review/project、ordinal、status=`prepared|running|completed|failed|cancelled|uncertain`、Manifest identity、Provider identity/generation、exact request hash/bytes、started/completed/failedAt、failure code、response body hash、validated structured response。raw response如存储必须本地、size-capped、escaped、redacted；不保存hidden CoT字段。

### 6.3 Semantic claim projection

- `ProviderAssessmentFinding`：kind/severity/public rationale/minimal correction/unknowns/source spans/Provider identity/authority=`model_proposed_assessment`。
- `ProviderArgumentDelta`：`status=substantive|no_substantive_delta|unknown`及summary/span；UI不得自动改名`theoretical_contribution`。
- `ProviderAssessmentStatus`：以精确、互不替代的字段保存 `request_binding_valid`、`response_schema_valid`、`quoted_span_integrity_valid` 与 `provider_assessment_available`。前三项只报告协议和引用完整性；最后一项只报告是否取得可展示的 Provider assessment，不代表其内容正确。
- `DeterministicProtocolProof`：只投影上述前三项 validity flags 及 request／Manifest／Provider identity hashes；不得包含 semantic verdict。
- `EvidenceSupport`：不属于 assessment，由 Evidence domain 另行决定。

### 6.4 Schema tables (`proposed_new`)

- `research_room_reviews`
- `research_review_provider_attempts`
- `research_review_corrections`
- `context_manifests`（由`03`权威定义）
- `research_transition_receipts`（由`01/11`权威定义）

每个表有project-scoped unique、version、strict status check、JSON data；attempt的exact idempotency/ordinal唯一。

## 7. 状态机与 transition

### 7.1 完整状态表

| from | command/actor | precondition | mutation | to | restart行为 |
|---|---|---|---|---|---|
| none | create draft / user或Host adapter | suggestion有效、project开放 | persist draft/source | `draft` | 直接恢复 |
| draft/stale | prepare manifest / user | current snapshot可读 | persist newManifest/base revision | `manifest_prepared` | 显示待确认 |
| manifest_prepared | confirm / user | exact Manifest可见、version匹配 | confirmation record | `manifest_confirmed` | 不自动发送 |
| manifest_confirmed | skip assessment / user | 无 | availability not_requested | 可形成effect；保持confirmed | 恢复到effect阶段 |
| manifest_confirmed | prepare Provider / user | config/Manifest有效 | persist attempt | `provider_attempt_prepared` | 显示待发送确认/可取消 |
| provider_attempt_prepared | start / Kernel after user confirm | fresh revalidation通过 | attempt running先落库，再network | `provider_attempt_running` | 若重启，转uncertain，绝不自动重发 |
| provider_attempt_running | valid response / Kernel | binding/schema/span处理完成 | attempt completed + assessment immutable | `assessment_recorded` | 恢复assessment |
| provider_attempt_running | known fail/timeout/cancel | 明确未成功或用户abort | terminal attempt/failure | `provider_attempt_failed`或`manifest_confirmed` | 可显式新attempt |
| provider_attempt_running | process crash/write outcome unknown | 无法证明外发/写入结果 | recovery marks uncertain | `provider_attempt_uncertain` | 提示可能已发送；只能显式新attempt |
| any nonterminal | project revision change | head不同 | stale reason；保留attempt history | `stale` | 重建Manifest |
| manifest_confirmed/assessment_recorded/failed/uncertain | prepare/edit effect / user | target可解析 | effect draft/preview | 状态不变 | draft恢复 |
| effect ready | commit record_only | user | atomic outcome+revision+Receipt | `disposed` | 幂等恢复 |
| effect ready | commit mutation | user | atomic object+revision+Receipt | `committed` | 幂等恢复 |
| nonterminal | cancel / user | 不在不可中断commit | terminal record | `cancelled` | 保留历史，不自动外发 |

### 7.2 committed语义

`committed`只在同一UoW中resulting object、revision event、Review状态和Receipt都成功时写入。Renderer显示成功不参与状态决定。

### 7.3 cancellation/retry

- cancel running attempt先abort本进程句柄；若网络结果不确定，状态是uncertain而非cancelled-success。
- retry创建新attempt ordinal和新Manifest确认；不复用confirmation/nonce。
- invalid response可查看失败，但不会抹掉原suggestion/effect。

### 7.4 stale target

Review stale后assessment仍是历史意见；不能用旧effect preview提交。重建后可保留assessment作为“基于旧revision”的上下文，但不得显示为current。

### 7.5 崩溃恢复矩阵

| 崩溃时持久状态 | 能确定的事实 | 重启后的状态 | 自动网络行为 | 用户下一步 |
|---|---|---|---|---|
| `draft`／`manifest_prepared` | 尚未确认外发 | 原状态恢复；若项目revision变化则`stale` | 无 | 继续编辑或重建Manifest |
| `manifest_confirmed`／`provider_attempt_prepared` | 已确认payload，但尚无已启动attempt事实 | 原状态恢复 | **不得自动发送** | 显式启动或跳过assessment |
| `provider_attempt_running`，无terminal attempt record | 请求可能未发、已发或响应未落库 | `provider_attempt_uncertain` | **不得重试或补发** | 查看Manifest/attempt identity；显式创建新attempt或继续无assessment |
| attempt completed，assessment transaction未完成 | response hash/validation record是否存在由同一transaction决定 | 有完整assessment则`assessment_recorded`；否则`provider_attempt_uncertain` | 无 | 继续effect或显式重试 |
| `assessment_recorded`／effect draft | assessment和draft均可恢复 | 原状态或`stale` | 无 | 重新预览effect并提交 |
| canonical UoW在commit响应前崩溃 | idempotency key决定是否已提交 | 查询已存在Receipt/result则`committed|disposed`；不存在则保持可提交 | 无 | 打开result或重试同一idempotency key |
| `committed`／`disposed`／`cancelled` | terminal truth已落库 | 原terminal状态 | 无 | 只读历史、补偿或新建Review |

恢复过程只读取本地持久状态、transaction journal与idempotency记录；不得把进程内`AbortController`、浏览器state或“上次按钮已点击”当作事实。

## 8. 数据流与 Authority 流

```text
Input → research_room_reviews(draft)
→ context_manifests(prepared/confirmed)
→ provider_attempt(prepared→running→completed/failed/uncertain)
→ ProviderAssessmentEnvelope(non-authoritative)
→ CanonicalEffect draft/preview
→ user Authority
→ one UoW: canonical object + project revision event + Review terminal + Receipt
→ derived projections
```

网络只在attempt running；任何restart不自动进入该边。Authority仅terminal commit。Review/assessment是persistent non-authoritative；Receipt proof和canonical object分离。

## 9. API、Schema、Repository 与代码边界

| 当前文件/模块 | 当前职责 | 目标 | 修改 | 证据 |
|---|---|---|---|---|
| `packages/core/src/research-room.ts` | Map-based lifecycle | 薄use-case facade调用ReviewRepository/state machine | 重构 | `existing_verified` |
| `packages/review/src/review-run.ts` + migration014 | checker run | 保留内部批量review，不承载互动Review | 保留/文档区分 | `existing_verified` |
| `packages/research/src/review/research-review.ts` | 不存在 | Review aggregate/parser/transitions | `proposed_new` | 计划对象 |
| `packages/core/src/research-review.ts` | 不存在 | orchestration/Provider attempt/recovery | `proposed_new` | 计划对象 |
| `packages/research/src/ports/repositories.ts` | 无interactive Review repo | 增加Review/Attempt/Correction/Manifest repos | 扩展 | `existing_verified` |
| `packages/research-store/src/repositories/sqlite-research-review-repository.ts` | 不存在 | CAS、attempt append、terminal UoW | `proposed_new` | 计划对象 |
| migration 022 | 不存在 | tables/indexes/checks | `proposed_new` | 计划对象 |
| `packages/review/src/semantic/research-room-semantic-judge.ts` | compile/submit | 返回claims+validation facts；删过强映射 | 重构 | `existing_verified` |
| API `/api/reviews/*` | 凭内存ID操作 | project-scoped persistent IDs/versions/idempotency | 重构 | `existing_verified` |
| App React state `prepared/analyzed` | 页面内存 | query/cache只映射server aggregate | 重构 | `existing_verified` |

API目标：

```text
POST /api/project/reviews
GET  /api/project/reviews/:id
POST /api/project/reviews/:id/manifest
POST /api/project/reviews/:id/manifest/confirm
POST /api/project/reviews/:id/provider-attempts
POST /api/project/reviews/:id/provider-attempts/:attemptId/run
POST /api/project/reviews/:id/provider-attempts/:attemptId/cancel
POST /api/project/reviews/:id/cancel
```

每个mutating response返回aggregate version、status、project revision和next allowed actions。

## 10. UI 与交互

Review Thread以持久化事件顺序展示：Suggestion、Context/Manifest、Provider attempt/assessment、effect preview、Authority outcome、canonical result。

- Start/reopen：Today列出`draft`、待Manifest确认、attempt uncertain、assessment waiting、stale。
- loading：客户端从server读取aggregate；不以本地React state猜阶段。
- empty：无Review时提供paste/import/Host queue入口和当前question。
- running：显示“Provider请求已开始”，可cancel；离开页面不取消。
- uncertain：最高优先级非成功状态；说明“请求可能已发送，系统不会自动重试”，提供查看Manifest、记录为无assessment继续、显式新attempt。
- stale：assessment标注“基于revision N”，effect disabled直到rebuild。
- partial：Provider结果部分/invalid不创建半个assessment；显示attempt failure。canonical commit不允许partial。
- restart：回到同一thread位置，focus放在状态标题，下一safe action唯一。
- History：原assessment不可编辑；correction追加显示。
- technical proof：attempt hash/body、validity flags、errors按需展开。
- cancellation：保留Suggestion/Manifest，明确网络不确定性，不用“已取消”掩盖可能发送。

## 11. 中文／English 与术语

- `Review`：用户可见“审议”；不要与内部`review_runs` checker混称。
- `draft`：“待审建议”。
- `manifest_confirmed`：“已核对外发内容，尚未必发送”。
- `provider_attempt_uncertain`：“Provider请求结果不确定”。
- `assessment_recorded`：“已记录Provider评估”，不是“评审通过”。
- `disposed`：“已记录，不改变研究对象”。
- `committed`：“已写入规范研究状态”。
- Finding：“Provider评估项”或“本地确定性检查项”，必须标来源。
- ArgumentDelta：“Provider提出的论证变化判断”；不自动称理论贡献。
- 删除固定confidence `0.66`及`semantic_ready`。

## 12. 隐私、安全与权限

- Review suggestion、assessment、raw response均project-local；没有Sestina cloud或telemetry。
- in-flight AbortController只在内存，重启状态由attempt row恢复；句柄不能成为truth。
- Provider raw output不解析成HTML/command；JSON parser有exact schema/size限制。
- attempt/Manifest confirmation与desktop session绑定，重启后必须重新确认外发。
- 不保存hidden CoT；response schema拒绝该字段，logs不记录raw body。
- Host source metadata不得注入Provider endpoint、effect或Authority。
- multi-instance通过project lease；第二实例只读/阻止写，避免双attempt。
- uncertain状态禁止自动retry；这也是隐私边界。
- export明确区分Review history与canonical objects。

## 13. 数据迁移与向后兼容

- 从每个legacy `research_room_receipts`生成historical `ResearchReview`：suggestion可从analysis.proposal/modifiedProposal恢复，Manifest/assessment复制，status按`11`映射。
- `accepted/modified_accepted`→`disposed`且`canonical_effect_unresolved`；`direction_changed`可映`committed`。
- legacy Receipt与新Review通过source ID关联；不改变原receipt hash。
- 没有Receipt的Map状态无法恢复；migration明确记录“无持久源”，不创建假draft。
- correction appeals迁入`research_review_corrections`；active incomplete标legacy incomplete，不自动重试Provider。
- Deliberation/Pilot candidate只在用户显式“转为Review”时创建新draft。
- generic `review_runs`表不迁入interactive Review；文档和API命名区分。
- migration后旧Map-based endpoint停止写；compatibility读取历史。
- pre-migration backup/copy-on-write/too-new规则见`11`。

## 14. 测试与验证

### 强制退出矩阵

在每个状态创建项目并kill进程：draft、manifest_prepared、manifest_confirmed、attempt_prepared、attempt_running、assessment_recorded、stale、effect preview、commit response前。重启后必须符合状态表；attempt_running统一恢复uncertain，不产生网络。

### 其他测试

- state-machine unit：所有合法/非法transition、version CAS、terminal不可重开。
- property：随机transition序列无非法terminal、attempt ordinal唯一、原assessment immutable。
- repository：crash/transaction/constraint/large response、multi-instance lease。
- provider：timeout/abort/invalid JSON/response too large/config generation/write uncertain。
- API：project ownership、strict decoder、allowed actions、idempotency。
- integration：Review→effect UoW。
- no-network：reopen/restore不会调用Provider。
- privacy：raw output/secret/error redaction。
- E2E：离开Review到Search/Settings再返回；重启保持thread。
- accessibility：live status不重复播报；focus recovery；uncertain非颜色表达。
- migration：legacy Receipt/Appeal映射、不伪造pending。
- fixture只能证明decoder/state contract，不能证明Provider assessment准确。

## 15. 完整验收标准

- 任何可见Review都可由DB/repository查询；不存在生产truth依赖`#pending/#analyzed`。
- 每个要求状态都有合法进入/退出/恢复路径。
- running崩溃后为uncertain，网络调用计数不增加。
- assessment原记录immutable；correction只追加。
- `semantic_ready`、固定0.66、substantive→theoretical contribution自动映射不可达。
- Provider assessment、deterministic proof、Evidence support、user outcome四层在DTO/UI/Receipt一致。
- stale保留旧assessment但禁止旧effect commit。
- terminal Review与resulting object/Receipt/revision一一链接。
- Today/Search/Attention能找到pending/stale/uncertain Review，且带相同revision。
- legacy `review_runs`不出现在用户Review history中。
- no Provider/restart/recovery路径完整且不回归Manifest/Authority保护。

## 16. 明确非目标

- 不保存隐藏思维链。
- 不自动重发Provider。
- 不把interactive Review与内部checker run合并。
- 不声称持久化提高模型准确率。
- 不为每个UI动画写event。
- 不允许多个active Authority commands。
- 不把Review发展成通用工单系统。
- 不恢复基线中从未持久化的Map内容。

## 17. 被拒绝方案与重新考虑条件

- **临时JSON文件**：只有数据库不可用且产品放弃transaction/recovery保证时才重开。
- **复用`review_runs`**：只有内部checker模型被删除、其表可完全重定义时才重开；当前语义差异过大。
- **阶段对象碎片化**：不重开；会产生Manifest/Finding/Appeal各自真相。
- **同步Provider commit**：只有取消Exact Manifest/用户预览时才可能，违反不变量。
- **自动重试uncertain**：不重开；可能重复外发。

## 18. 实施风险与失败收缩

- 新Review repo与旧Map并存会双真相；切换后Map只能保存AbortController，不存业务字段。
- attempt row先写running、网络调用后崩溃会uncertain，这是有意的诚实收缩；不得用乐观completed隐藏。
- migration从Receipt恢复suggestion可能缺原始格式；保留hash/raw历史并标lossy。
- UI缓存旧aggregate时，server version是唯一依据；409触发reload，不做客户端merge Authority。
- Provider response过大/恶意导致parser资源压力；size cap/timeout/worker隔离见`12`。
- schema落地而UI未完成时，应用只读兼容，不允许旧commit endpoint。
- correction/Room/Pilot尚未迁入时不得开放新Review出货；`14`定义完整切换边界。

## 19. 对其他计划的依赖

- `01-REVIEW-CANONICAL-TRANSITION.md` 定义terminal outcome/effect/Receipt。
- `02-AUTHORITY-PROVIDER-DECOUPLING.md` 定义assessment envelope与capability。
- `03-PROJECT-STATE-REVISION-AND-MANIFEST.md` 定义Manifest/revision/stale。
- `07-APPEAL-SECOND-OPINION-AND-DELIBERATION.md` 将correction嵌入Review。
- `09-HOST-PILOT-AND-AGENT-CORRECTOR-INTEGRATION.md` 将所有宿主输入落为draft。
- `11-DATA-MIGRATION-COMPATIBILITY-AND-ROLLBACK.md` 负责tables/backfill/cutover。
- `06-TASK-ORIENTED-IA-AND-PRODUCTION-UI.md` 以server aggregate渲染Thread。
- `12-PRIVACY-SECURITY-AND-THREAT-MODEL.md` 处理raw response/session/multi-instance。
- `13-TEST-EVAL-AND-PRODUCTION-VERIFICATION.md` 收录crash matrix与证据等级。
