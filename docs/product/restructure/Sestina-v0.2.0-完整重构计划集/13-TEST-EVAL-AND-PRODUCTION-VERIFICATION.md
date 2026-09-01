---
title: "测试、评测与真实生产验证总计划"
status: proposed_complete_plan
implementation_status: not_started
baseline_release: v0.2.0
baseline_commit: caf893db7928bab91c4098eb04a7e4a8d4c62ffe
source_review: Sestina-v0.2.0-对抗性产品审查.md
source_findings: ["P0-01", "P1-01", "P1-02", "P1-03", "P1-04", "P1-05", "P1-06", "P2-01", "P2-02", "改进项-01", "改进项-02", "改进项-03", "改进项-04", "改进项-05", "改进项-06", "改进项-07", "改进项-08", "改进项-09", "改进项-10"]
depends_on: ["00-MASTER-REFACTOR-PLAN.md", "01-REVIEW-CANONICAL-TRANSITION.md", "02-AUTHORITY-PROVIDER-DECOUPLING.md", "03-PROJECT-STATE-REVISION-AND-MANIFEST.md", "04-PERSISTENT-REVIEW-AND-SEMANTIC-CLAIMS.md", "05-PROGRESSIVE-RESEARCH-BRIEF.md", "06-TASK-ORIENTED-IA-AND-PRODUCTION-UI.md", "07-APPEAL-SECOND-OPINION-AND-DELIBERATION.md", "08-GOVERNED-MEMORY-SIMPLIFICATION.md", "09-HOST-PILOT-AND-AGENT-CORRECTOR-INTEGRATION.md", "10-RELEASE-IDENTITY-AND-LOCAL-LIFECYCLE.md", "11-DATA-MIGRATION-COMPATIBILITY-AND-ROLLBACK.md", "12-PRIVACY-SECURITY-AND-THREAT-MODEL.md", "15-TERMINOLOGY-DOCS-AND-CLAIM-MIGRATION.md"]
blocks: ["14-IMPLEMENTATION-DEPENDENCY-AND-CHANGE-MAP.md", "16-CROSS-PLAN-CONSISTENCY-AND-DECISION-LOG.md"]
affected_layers: ["test architecture", "domain invariants", "repositories", "migrations", "API/IPC", "Provider contract", "security", "production UI", "accessibility", "release artifacts"]
decision_owner: user
---

# 测试、评测与真实生产验证总计划

> 本文件是整套重构的统一验证权威。它定义什么证据能证明实现完成、什么只能证明局部合同，以及哪些结论不在本轮产品重构完成条件内。所有测试对象均为计划状态，不表示当前代码已经通过。

## 1. 验证总裁决

整套重构只有在同一生产构建中证明以下因果链时才算闭合：

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

通过条件不是“测试数量增加”，而是每一个高影响审查发现都先有能在 `v0.2.0` 或其兼容 fixture 上失败的 RED contract，再由新的 Domain、Storage、Transport、UI、Recovery 和 Release evidence共同关闭。任何 mock、fixture、Schema、hash、DOM snapshot或截图均不得被解释为真实 Provider 语义准确、外部用户价值或市场价值。

## 2. 证据等级与禁止替代

| 证据类别 | 能证明什么 | 不能证明什么 | 本计划用途 |
|---|---|---|---|
| `implementation_evidence` | 生产路径存在，symbol/route/repository按设计调用 | 路径在真实发行物中可用；语义结果正确 | 源码审查与边界核对 |
| `test_contract` | 给定输入下实现满足明确合同 | 合同本身就是正确产品模型 | RED/GREEN 回归 |
| `fixture` | decoder、状态机、迁移和错误路径可被确定触发 | Provider真实质量、自然任务中的触发率 | 合成边界与可证伪性 |
| `screenshot` | 一个时间点的像素结果 | 键盘可达、状态转换、焦点、恢复、数据写入 | 视觉回归的辅证 |
| `rendered_production_evidence` | packaged production build 在真实窗口/主题/缩放/状态下可操作 | 长期使用价值或外部采用 | UI/生命周期完成证据 |
| `release_artifact_evidence` | 制品、身份、hash、签名、toolchain和生命周期可验证 | 研究结论正确 | 发行门禁 |
| `real_provider_quality` | 真实第三方模型在指定样本上的行为 | Sestina总体产品价值 | **不属于本轮完成条件** |
| `external_user_value` | 外部使用中的价值或困难 | Kernel是否内部一致 | **不属于本轮完成条件** |
| `market_value` | 采用、留存、商业结果 | 产品安全、Authority和恢复正确 | **不属于本轮完成条件** |

测试报告必须对每个结论标注上述证据类型。禁止将 `fixture passed` 写成 “Semantic Judge准确”，将 `screenshot captured` 写成 “UI已通过”，或将 `hash matched` 写成 “研究判断正确”。

## 3. 审查发现 → RED test → 完成证据矩阵

| 发现 | 必须先出现的 RED test | 预期旧行为 | 目标通过条件 | 主计划 |
|---|---|---|---|---|
| `P0-01` | Review A prepare 后提交 Review B 的 `record_only`/effect，再发送 A；另测 accepted legacy无target | 旧 Manifest仍fresh；accepted只写Receipt | A因revision/projection改变fail closed；新Review必须有typed effect或record_only；resulting object与Receipt同事务 | `01`,`03`,`04`,`11` |
| `P1-01` | Provider未配置、timeout、invalid JSON、用户跳过四条路径提交每种合法effect | positive disposition被阻止 | action capability与assessment availability分离；事实support约束仍生效 | `02`,`01` |
| `P1-02` | 合法Schema+真实quote但理由明显不支持结论 | UI/DTO形成`semantic_ready`/validated/0.66 | 只显示Provider assessment；四个protocol flags；无固定confidence；Evidence support不被推断 | `04`,`02`,`15` |
| `P1-03` | zero-network suggestion含明显重复措辞 | 旧`ledger_only`可能被文档称semantic review且不能采纳 | 只声明state-bound deterministic proof；完整Authority闭环；无伪语义checker | `02`,`15` |
| `P1-04` | 仅question/task创建项目并准备Review；普通用户补scope/evidence threshold | 空字段进入成熟assessment；高级编辑要求JSON/ID | coverage/limitations明确；typed form/relationship picker；系统ID；Manifest diff | `05`,`06` |
| `P1-05` | 在每个Review阶段kill进程并重启；在Provider写出后读回前kill | draft/Manifest/analysis丢失或可疑重发 | 恢复精确阶段；attempt uncertain；绝不自动重复外发；幂等 | `04`,`11` |
| `P1-06` | 生产路由/导航可达性检查；新用户键盘从项目入口完成闭环 | 十余一级对象和Open Pilot并列 | 只有Today/Review、Project、Search、Settings；Room/Pilot新建不可达；对象二级可审计 | `06`,`09` |
| `P2-01` | Appeal/second opinion/legacy Room Resolution结束后检查source object | Resolution不改变source或被误认为独立truth | correction回统一effect；原assessment immutable；runtime distinct+independence unproven；Room只读 | `07` |
| `P2-02` | release tag/sourceCommit/tree hash/build identity不一致；fresh install/start/stop/reopen/upgrade/uninstall矩阵 | archive/Node/browser或provenance断裂 | Electron packaged lifecycle；public tag exact commit；reproducible core bundle；signed envelope；data separation | `10`,`12` |

## 4. 十项核心改进的验证追踪

| 改进 | 不可替代的验证结果 | 关键测试类型 |
|---|---|---|
| 1. typed canonical effect | 每个Review终态有明确target/before/after/result或record_only | domain、transaction、E2E |
| 2. Authority/Provider解耦 | zero-network仍能完成闭环，且Evidence support未被Authority替代 | policy、API、E2E、no-network |
| 3. revision + Manifest | 所有outbound-relevant变化stale旧Manifest；无mixed snapshot | property、concurrency、provider contract |
| 4. persistent Review + claim分层 | 每阶段可恢复；protocol proof不变semantic truth | state machine、crash、UI copy |
| 5. progressive Brief | 不写JSON/ID也能建立上下文；limitations可见 | form、migration、long content、a11y |
| 6. task-first IA | 默认旅程围绕任务；旧对象仍可审计但不抢入口 | route、E2E、production visual |
| 7. Appeal嵌入/Room收缩 | correction不形成第二truth；legacy Room read-only | migration、domain、route |
| 8. Memory简化 | 四个用户态、逐项外发、forget边界真实 | domain、privacy、backup/restore |
| 9. Host/Pilot/Agent Corrector收口 | 所有来源仅创建同一Review draft；无Authority旁路 | capability、integration、provenance |
| 10. release/lifecycle | 产品身份、启动、升级、数据目录、来源链一致 | cross-platform、artifact、security |

## 5. 17 份计划的验证覆盖矩阵

| 计划 | 主要可证伪对象 | 必须产生的验证制品 |
|---|---|---|
| `00-MASTER-REFACTOR-PLAN.md` | 全局闭环和不变量是否统一 | end-to-end trace bundle；cross-plan gate report |
| `01-REVIEW-CANONICAL-TRANSITION.md` | effect类型、target CAS、UoW、compensation | command matrix、transaction trace、Receipt diff |
| `02-AUTHORITY-PROVIDER-DECOUPLING.md` | Authority policy与support status | policy table tests、zero-network E2E |
| `03-PROJECT-STATE-REVISION-AND-MANIFEST.md` | revision推进和exact payload freshness | mutation property suite、body/hash capture |
| `04-PERSISTENT-REVIEW-AND-SEMANTIC-CLAIMS.md` | lifecycle、attempt uncertain、claim levels | crash matrix、decoder fixtures、restart evidence |
| `05-PROGRESSIVE-RESEARCH-BRIEF.md` | coverage、field state、relation、diff/history | form E2E、migration snapshots、long locale renders |
| `06-TASK-ORIENTED-IA-AND-PRODUCTION-UI.md` | route/interaction/state/a11y/visual | packaged screenshots、video traces、axe/manual matrix |
| `07-APPEAL-SECOND-OPINION-AND-DELIBERATION.md` | immutable source、correction effect、legacy Room | history chain、identity/independence labels、route denial |
| `08-GOVERNED-MEMORY-SIMPLIFICATION.md` | recall/share/promote/forget separation | manifest selections、cleanup inventory、restore tests |
| `09-HOST-PILOT-AND-AGENT-CORRECTOR-INTEGRATION.md` | draft-only capability与source provenance | Host/MCP/Skill matrix、legacy Pilot conversion |
| `10-RELEASE-IDENTITY-AND-LOCAL-LIFECYCLE.md` | Desktop lifecycle和provenance | three-platform installers/packages、release attestation |
| `11-DATA-MIGRATION-COMPATIBILITY-AND-ROLLBACK.md` | lossless/lossy mapping、copy-on-write、downgrade | migration journal、prebackup hash、failure corpus |
| `12-PRIVACY-SECURITY-AND-THREAT-MODEL.md` | trust boundaries与fail-closed | threat test report、redaction scan、no-network trace |
| `13-TEST-EVAL-AND-PRODUCTION-VERIFICATION.md` | 证据分类与追踪无遗漏 | final verification index |
| `14-IMPLEMENTATION-DEPENDENCY-AND-CHANGE-MAP.md` | cutover依赖、无半成品truth | dependency gate log、commit-to-plan map |
| `15-TERMINOLOGY-DOCS-AND-CLAIM-MIGRATION.md` | schema/UI/docs声明一致 | term lint、docs claim diff、locale parity |
| `16-CROSS-PLAN-CONSISTENCY-AND-DECISION-LOG.md` | 单一Kernel/Review/Authority/revision/data flow | consistency report + resolved decision log |

## 6. RED test 建立规则

1. RED test必须在目标实现前提交，并能说明失败是旧缺陷而非测试环境错误。
2. 每个RED test引用发现ID、计划文件、用户后果和目标不变量。
3. RED test不得依赖真实第三方Provider可用；Provider语义内容使用明确标为synthetic的固定fixture。
4. 对网络不确定性，使用可控TCP server模拟“收到请求后断开”“response前kill”“redirect”“超限”“慢响应”。
5. 对视觉缺陷，RED evidence是production build在固定state fixture下的可复现截图/可操作失败，不是设计稿。
6. 对migration，保留不可变`v0.2.0` DB corpus及其SHA；不得由新runtime创建“旧fixture”。
7. 修复测试必须保留，不能在GREEN后改写输入以绕过缺陷。

## 7. Domain unit 与状态机测试

### 7.1 CanonicalEffect exhaustive matrix

每种effect覆盖：valid input、missing target、wrong target kind、stale target version、duplicate idempotency key、invalid user actor、empty reason、oversize content、relationship mismatch、repository failure、Receipt failure、revision head CAS failure。测试断言全部或零写入。

### 7.2 Authority property

对任意Provider状态枚举和任意合法user effect：

- Provider状态不得改变`canProposeEffect`或`canCommitDirectionDecision`；
- `add_evidence`仍必须提供provenance/support status；
- non-user actor始终不能commit；
- user decision不会把support status改为`proven`；
- assessment/Host/Memory都不能成为Authority actor。

### 7.3 Review state machine

使用model-based test生成所有合法/非法transition，验证：

- terminal state不可返回active；
- cancelled/committed/disposed幂等；
- uncertain attempt不自动转completed；
- stale Review只能rebase/clone，不复活旧Manifest；
- provider response不能绕过`manifest_confirmed`；
- effect commit必须引用最新Review version和preview hash；
- crash后从repository恢复的状态与内存model一致。

### 7.4 Revision properties

- 每个canonical transaction恰好`N→N+1`；无跳过的正常transaction，无倒退。
- rollback/compensation仍`N→N+1`。
- non-authoritative workflow、UI prefs、Provider config不推进project revision。
- Provider generation变化单独使Manifest stale。
- 相同canonical snapshot和projection policy产生相同`contextProjectionHash`；字段顺序不影响canonical hash。
- 任何影响body字节的输入改变都改变exact request hash；任何旧Manifest不能自动复活，即使canonical内容补偿后回到相同值。

## 8. Repository、transaction 与 concurrency

### 8.1 Repository contract

对heads/events、Reviews、attempts、Manifests、transition Receipts、corrections和legacy readers执行：create/get/list/CAS、pagination、project isolation、foreign key、unique/idempotency、corrupt JSON、future schema、read-only legacy write denial。

### 8.2 Atomicity fault injection

在UoW每个写点注入失败：target object、revision event、head、Review terminal、Receipt、search outbox。断言transaction rollback后：

- target未部分改变；
- head未推进；
- Receipt不存在；
- Review仍可重试或显示明确失败；
- derived projections可由canonical重建。

### 8.3 Concurrency corpus

- 两个Review修改同一Decision；只有一个target CAS成功，另一个stale。
- Review A prepared，B commit；A send fail closed。
- Provider config在confirm/send之间变更；零网络发送。
- Memory item在selection/confirm/send之间forget；旧Manifest stale且正文不外发。
- migration/backup/restore与project write竞争；maintenance lease阻止写。
- Desktop double-launch；single-instance + project lease，不静默创建第二writer。

## 9. Migration 与恢复测试

### 9.1 Immutable corpus

至少包含：空项目、长Brief、generic accepted/modified accepted、direction change+rollback、Appeal各状态、Room partial/failed/resolved、Memory六态、Closed Pilot各关键状态、1000对象、corrupt DB、future schema、missing Brief binding、WAL未checkpoint、只读目录、多实例lease。每个fixture记录来源schema、预迁移DB hash、预期lossless/lossy分类。

### 9.2 Copy-on-write matrix

对每个migration阶段kill进程：backup完成前、copy中、某migration中、validation前、swap前、swap后journal未完成。重启必须确定：继续验证、丢弃temp或进入Recovery；绝不选择半迁移DB。

### 9.3 Semantic mapping assertions

- legacy `accepted`/`modified_accepted`生成historical Review + `legacy_record_only_unresolved_effect`，不生成Decision/Evidence。
- `direction_changed`绑定历史Brief effect；rollback保留compensation provenance。
- old Appeal/Room/Pilot只读；不能通过新API恢复active。
- Memory internal state保留，UI mapping一致；forgotten不回到Recall/Search/Manifest。
- Search/Attention全部重建并携带当前revision。
- migration baseline只有一个revision 1 event，不伪造历史序列。

### 9.4 Backup/restore/downgrade

验证pre-migration backup、hash、project ID、schema、Brief binding、revision chain、Review/Manifest binding；restore成功后从正确Today/Review恢复。新schema由旧release打开必须`too_new` fail closed；downgrade只能恢复旧backup。

## 10. API、IPC 与 Provider contract

### 10.1 Transport-neutral use case

同一use-case测试套件必须可分别驱动：Kernel直接调用、legacy HTTP compatibility adapter、Electron typed IPC、Host draft bridge。除Transport decoder/error mapping外，结果对象、Authority policy、revision和Receipt完全相同。

### 10.2 API/IPC negative tests

unknown fields、wrong enum、oversize、path injection、stale version、missing session/capability、replayed nonce/idempotency、wrong project、wrong target、renderer-supplied Authority actor、Host请求commit、MCP写请求均fail closed。

### 10.3 Exact Manifest body test

Provider adapter test必须捕获 **exact socket body**，即实际socket写出的HTTP body，断言与用户确认Manifest中的exact body逐字节相同，并检查：endpoint、model、generation、headers exclusion、redirect=`error`、retry=0、response size cap。不能只比较prepare函数的返回值。

### 10.4 Provider failure matrix

not configured、user skipped、timeout before connect、timeout after body sent、connection reset、invalid JSON、valid JSON/wrong IDs、oversize、schema mismatch、quote mismatch、configuration changed、cancelled、DNS/private address/metadata/redirect。每条都验证Review状态、attempt事实、action仍可用、Receipt assessment availability准确。

## 11. No-network、隐私与安全验证

### 11.1 Socket-denial suite

在禁止所有网络socket的环境完成：打开项目、migration dry run、Brief编辑、手工Review、no-assessment canonical effect、Search/Attention、Memory recall但不share、backup/restore、Receipt/History、export。任何意外socket都使测试失败。

### 11.2 Manifest/Memory/privacy

- `never_send`任何路径不进入projection/body/log/error。
- explicit Memory逐项选择，未选/forgotten/stale原因正确。
- raw Receipt、Provider raw output、absolute path、secret、hidden CoT不进入默认payload。
- forget后current DB、FTS/cache/temp无正文；managed backup inventory/外部副本声明准确。
- diagnostics export前预览，redaction pattern扫描body/header/path/token。

### 11.3 Threat tests

覆盖恶意网页、本机其他进程、Host/Origin/CSRF/DNS rebinding/session token、Electron renderer IPC、navigation/custom protocol、path traversal/symlink/junction/TOCTOU、Provider DNS/connect/redirect/private/metadata/proxy、prompt injection、Host instruction、MCP/Skill capability、tampered update/provenance、backup/temp/crash residue。具体攻击路径以`12-PRIVACY-SECURITY-AND-THREAT-MODEL.md`为权威。

## 12. Production E2E 主旅程

每条E2E必须在packaged production build上运行，读取真实SQLite，禁止mock Kernel/repositories。Provider路径可以使用显式标为local deterministic transport fixture；它只证明contract，不证明语义质量。

1. fresh install → language → project create/open → progressive Brief → Today。
2. paste suggestion → draft持久化 → Manifest summary/body → no Provider → `create_decision` → resulting Decision/revision/Receipt → restart。
3. configured Provider → exact body captured → assessment flags → `patch_brief` → Search/Attention/History一致。
4. Provider invalid/timeout/uncertain → user继续`record_only`或effect → Receipt准确。
5. stale by concurrent Decision/Memory/Provider generation → rebuild/reconfirm。
6. crash at everyReview stage → restart recovery，无自动resend。
7. Appeal → skip/get runtime-distinct second opinion → correction effect → original assessment immutable。
8. legacy Room/Pilot project migration → history可读/导出/恢复，新建不可达。
9. Memory suggest/confirm/recall/select/share/forget → Manifest和副本边界。
10. backup → mutate → restore preview → restore → Today/Review/revision正确。
11. upgrade with prebackup → migration success；forced failure → rollback/recovery。
12. uninstall program while preserving project → reinstall/open unchanged data；secret/settings删除选项独立。

## 13. 大项目与性能

### 13.1 Fixture

一个project含：1000 canonical objects、100 persistent Reviews、1000 Receipts/history records、500 Evidence links、300 Attention candidates、50 Memory items、长中文/English Brief各至少100KB、单条Finding/Provider error接近允许上限。fixture由deterministic generator创建并记录seed/hash，不使用私人数据。

### 13.2 `proposed_acceptance_threshold`

在CI公布的reference desktop配置上：

- packaged app冷启动到可交互Today：p95 ≤ 4s；暖启动p95 ≤ 2s；
- Today/Project首屏查询：p95 ≤ 750ms；
- Search首批50结果：p95 ≤ 500ms；翻页p95 ≤ 400ms；
- Review draft/Manifest local prepare（不含Provider）：p95 ≤ 1s；
- canonical transaction（不含大附件I/O）：p95 ≤ 500ms；
- 1000对象列表采用分页/virtualization，无一次性全DOM；
- 200%文本和长内容下主action可达；连续滚动无持续主线程>200ms long task；
- migration/backup按数据量记录吞吐和峰值内存，不设会诱导不安全跳过验证的硬超时；UI持续显示阶段并允许安全取消。

性能未达标不能通过删除Manifest、integrity、Authority或Recovery检查“优化”。

## 14. Accessibility、主题、语言与视觉

### 14.1 自动与人工组合

自动：semantic roles/names、axe规则、contrast、keyboard tab order smoke、focus trap/inert、reduced motion、locale missing key、overflow detector。人工：screen reader读序、因果理解、200% zoom、High Contrast、长文本、overlay focus return、destructive confirmation。

### 14.2 生产视觉矩阵

| 维度 | 必测值 |
|---|---|
| viewport | 1100×760、1280×800、1440×900、1920×1080 |
| text zoom | 100%、200% |
| theme | Light、Dark、High Contrast |
| motion | normal、reduced |
| input | mouse、keyboard-only、screen reader |
| locale | 简体中文、English |
| state | empty、loading、disabled、success、stale、partial、failed、offline/no Provider、recovery、destructive |
| content | long Brief、long Finding、long Provider error、1000 objects、hundreds Attention |

### 14.3 必须捕获的无私人数据截图

1. Start Center：fresh/no recent、open、create confirmation、invalid/permission path、Recovery required。
2. Today：empty project、pending Reviews、blocking issue、recent canonical change、large Attention。
3. Review：draft、context limitations、Manifest summary、technical exact body、no Provider、Provider assessment、stale diff、attempt uncertain、effect preview、commit result、restart recovered。
4. Project：Brief typed form/history/conflict、Decision/Evidence/Issue relationships、History/legacy badges。
5. Appeal：original assessment、second opinion missing/configured/failed、independence label、correction effect。
6. Memory：四态、recall reason、explicit selection、forget inventory/result。
7. Settings：Provider, privacy, Host bridge off/on, recovery, About/release identity。
8. Recovery：too new、corrupt、Brief binding mismatch、migration failed、restore preview/success。
9. 三平台 packaged About和lifecycle状态。

每个截图记录build ID、source commit、OS、viewport、zoom、theme、locale、fixture hash、route、Review/project revision。截图不能替代键盘、写入、重启和恢复测试；Source review、DOM和测试也不能替代真实渲染检查。

## 15. Release artifact 验证

- public tag target = `sourceCommit`；source tree hash、lockfile hash、toolchain、build command、schema/migration identity、asset hash存在。
- unsigned reproducible core bundle在两个隔离builder上内容一致；签名/公证envelope单列。
- Windows installer、macOS DMG、Linux AppImage/包各执行fresh install、start、stop、reopen、single instance、project open、upgrade prebackup、forced failure recovery、uninstall/data preservation。
- official Logo source hash与usage rules gate；不得重绘、反色、裁切、主题变体。
- update index/artifact/signature/source provenance tamper fail closed；无后台下载/上传。
- archive legacy artifact的身份明确为loopback preview，不进入Desktop通过证据。

## 16. Defect fix → recheck 规则

任何高影响测试失败必须：记录failure artifact、最小复现、受影响不变量和修复commit；只修改实现或明确修正合同，不删除/弱化RED输入。修复后重跑：直接测试、同根因相邻测试、完整核心E2E、migration/security/release受影响门。视觉修复需同一fixture前后截图，不能只附新图。

## 17. 完整验收门

整套验证通过必须同时满足：

1. `P0-01`、`P1-01`～`P1-06`、`P2-01`～`P2-02`全部有RED、GREEN和生产/迁移/发行适用证据；
2. 十项核心改进均能由可观察用户结果证明；
3. 17份计划均至少有一条可追踪验证制品；
4. no-network核心闭环通过；
5. crash/restart/concurrency/migration/restore无混合truth或自动重复外发；
6. Search/Attention/Resume/Receipt与resulting object/revision一致；
7. legacy Room/Pilot/generic disposition写路径不可达；
8. packaged production UI完成全部主题、语言、缩放、键盘和长内容矩阵；
9. 三平台lifecycle和release provenance闭合；
10. security/forget/backup/uninstall边界未回归；
11. 测试报告没有把fixture、截图或hash冒充semantic accuracy、external value或market value；
12. `16-CROSS-PLAN-CONSISTENCY-AND-DECISION-LOG.md`无未解决冲突。

## 18. 明确非目标

- 不设真实第三方Provider准确率门槛。
- 不使用外部试用者、Pilot参与者、访谈、问卷、采用、留存、stars、downloads或市场指标作为实现阻塞。
- 不以新增Agent、rubric或合成评测分数替代状态正确性。
- 不保存隐藏思维链。
- 不要求云账号、遥测或后台上传。
- 不把所有测试合并为一个不可诊断的“full suite passed”标签。

## 19. 对其他计划的依赖

本文件的测试对象由`01`～`12`定义；实施切换顺序由`14-IMPLEMENTATION-DEPENDENCY-AND-CHANGE-MAP.md`约束；用户可见名称和文档断言由`15-TERMINOLOGY-DOCS-AND-CLAIM-MIGRATION.md`约束；最终无冲突证明由`16-CROSS-PLAN-CONSISTENCY-AND-DECISION-LOG.md`给出。任何领域计划修改状态、字段、route或release选择后，必须同步更新本矩阵，不能让测试继续验证旧模型。
