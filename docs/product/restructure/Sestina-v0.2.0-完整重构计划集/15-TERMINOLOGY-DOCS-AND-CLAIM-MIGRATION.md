---
title: "术语、文档与产品声明迁移计划"
status: proposed_complete_plan
implementation_status: not_started
baseline_release: v0.2.0
baseline_commit: caf893db7928bab91c4098eb04a7e4a8d4c62ffe
source_review: Sestina-v0.2.0-对抗性产品审查.md
source_findings: ["P0-01", "P1-01", "P1-02", "P1-03", "P1-04", "P1-06", "P2-01", "P2-02", "改进项-01", "改进项-02", "改进项-04", "改进项-06", "改进项-07", "改进项-09", "改进项-10"]
depends_on: ["00-MASTER-REFACTOR-PLAN.md", "01-REVIEW-CANONICAL-TRANSITION.md", "02-AUTHORITY-PROVIDER-DECOUPLING.md", "03-PROJECT-STATE-REVISION-AND-MANIFEST.md", "04-PERSISTENT-REVIEW-AND-SEMANTIC-CLAIMS.md", "05-PROGRESSIVE-RESEARCH-BRIEF.md", "06-TASK-ORIENTED-IA-AND-PRODUCTION-UI.md", "07-APPEAL-SECOND-OPINION-AND-DELIBERATION.md", "08-GOVERNED-MEMORY-SIMPLIFICATION.md", "09-HOST-PILOT-AND-AGENT-CORRECTOR-INTEGRATION.md", "10-RELEASE-IDENTITY-AND-LOCAL-LIFECYCLE.md", "11-DATA-MIGRATION-COMPATIBILITY-AND-ROLLBACK.md", "12-PRIVACY-SECURITY-AND-THREAT-MODEL.md"]
blocks: ["13-TEST-EVAL-AND-PRODUCTION-VERIFICATION.md", "16-CROSS-PLAN-CONSISTENCY-AND-DECISION-LOG.md"]
affected_layers: ["domain names", "schema aliases", "API DTOs", "UI copy", "i18n", "README", "architecture docs", "security/privacy", "release docs", "migration docs", "integration docs"]
decision_owner: user
---

# 术语、文档与产品声明迁移计划

> 本文件是中英文术语、兼容名称和公开声明的统一权威。它只描述目标命名和迁移规则，不表示功能已经实现。文档只有在对应实现和验证制品存在后，才可把“计划”改为“当前能力”。

## 1. 计划结果

完成后，UI、Domain、API、Receipt、Migration、README、Architecture、Security、Privacy、Release、Getting Started、Recovery和Agent Corrector文档使用同一组认识论等级与产品身份：Provider只提供assessment；protocol/hash/span只证明各自完整性；用户Authority只决定研究状态；typed `canonical effect`说明真实改变；Receipt只证明transaction；Memory不是Evidence；目标发行是Electron Desktop App，`v0.2.0` archive准确称local loopback research server preview。旧术语仅在legacy读入、历史展示和deprecation decoder中存在，不再驱动新行为。

## 2. 术语迁移总表

| 当前/旧术语 | 目标用户可见中文 | 目标用户可见English | 技术内部名 | 兼容与删除规则 |
|---|---|---|---|---|
| `semantic_ready` | 已取得 Provider 评估 | Provider assessment available | `provider_assessment_available` + validity flags | **弃用。** legacy Receipt/DTO可读；新Schema/API不写；UI不得显示“语义已验证” |
| `ledger_only` | 未取得 Provider 评估；本地状态绑定仍可用 | No Provider assessment; state-bound local review remains available | `provider_assessment_available=false` + reason | **用户表面删除。** legacy enum兼容读；不再是action capability mode |
| Semantic Judge result / Finding（作为系统事实） | Provider 评估／Provider 提出的判断 | Provider assessment / Provider-proposed claim | `ProviderAssessmentEnvelope` | Finding可作为历史名；新UI不把模型意见称canonical finding |
| request identity valid | 请求绑定有效 | Request binding valid | `request_binding_valid` | 只证明assessment对应确认请求和project/Manifest identity |
| schema valid | 响应结构有效 | Response schema valid | `response_schema_valid` | 不证明理由正确 |
| span valid | 引用位置完整 | Quoted span integrity valid | `quoted_span_integrity_valid` | 不称Evidence support |
| assessment exists | 已取得评估 | Provider assessment available | `provider_assessment_available` | 与Authority capability无关 |
| independent second opinion | 运行身份不同的第二意见 | Runtime-distinct second opinion（规范短语：`runtime-distinct second opinion`） | `runtimeDistinctSecondOpinion` | 必须紧邻显示`cognitive independence unproven` |
| cognitive independence | 认知独立性未证明 | Cognitive independence unproven | `cognitive_independence: "unproven"` | 禁止仅凭model/endpoint别名升级 |
| generic `accepted` | 不再作为新动作 | Removed from new actions | legacy disposition only | migration为legacy record-only unresolved effect，除有直接effect evidence |
| `modified_accepted` | 不再作为新动作 | Removed from new actions | legacy disposition only | modified text保存历史，不推断target |
| `rejected`/`deferred` | 仅记录：拒绝／暂缓 | Record only: rejected / deferred | `record_only` + `recordReason` | 不产生Decision/Evidence；仍推进一次canonical review-history revision |
| `direction_changed` | 正式改变研究方向 | Formal direction change | `formal_direction_change` | typed effect，明确Brief target/before/after |
| canonical effect | 规范变更 | Canonical effect | `CanonicalEffect` | 六种effect/target/version；Provider不能决定 |
| `record_only` | 仅记录，不改变研究对象 | Record only; no research object changed | `record_only` | Review/Receipt/History改变；不创建/更新其他对象 |
| state hash / binding | 项目状态修订号 + 上下文投影哈希 | Project state revision + context projection hash | `projectStateRevision`, `contextProjectionHash` | legacy `stateHash`只读；新Manifest不依赖其完整性 |
| `projectStateRevision` | 项目状态修订号 | Project state revision | API camelCase / DB `project_state_revision` | canonical transaction单调递增；UI偏好不递增 |
| `contextProjectionHash` | 上下文投影哈希 | Context projection hash | API camelCase / DB `context_projection_hash` | 证明特定policy/schema下projection bytes identity |
| exact request hash | 精确请求哈希 | Exact request hash | `exactRequestHash` | 与projection hash不同；send前重验证 |
| Context Manifest | 外发内容清单（技术名：Context Manifest） | Outbound context manifest | `ContextManifest` | 保留产品术语；普通摘要先于technical proof |
| Authority Gate | 你的裁决／用户裁决 | Your decision / User authority | `AuthorityPolicy` / `commitCanonicalEffect` | UI避免“Gate”仪式化；内部仍可用policy名 |
| Review Room | 审议／Review | Review | `ResearchReview` | Research Room仍是产品主交互面；对象是Review |
| Today / Review | 今日与审议 | Today / Review | routes `/project/today`, `/project/reviews/:id` | 唯一主工作入口；中文可显示“今日 / 审议” |
| Project Objects | 项目 | Project | `/project/state` | Decision/Evidence/Issue/Brief关系化呈现 |
| Receipt | 变更凭证 | Change Receipt | `ResearchTransitionReceipt` | 证明谁/何时/何上下文/改变什么；不是结果本身 |
| Trace | 技术轨迹 | Technical trace | `TransitionTrace` | 按需展开，不能替代Receipt/result |
| Finding Appeal | 评估纠错 | Assessment correction | `ReviewCorrectionRecord` | 嵌入原Review；不形成第二truth |
| Deliberation Room | 历史会商记录 | Legacy deliberation record | legacy read-only | 新建/active入口删除；不得称默认产品能力 |
| Closed External App Pilot | 历史宿主试运行记录 | Legacy host pilot record | legacy read-only | `Open Pilot`删除；新Host仅Review draft intake |
| Project Working Memory | 项目工作记忆 | Project working memory | internal `ProjectWorkingMemory` | 不称Evidence/knowledge base |
| `candidate` | 建议使用 | Suggested | internal state unchanged | 用户态映射 |
| `active` | 使用中 | In use | internal state unchanged | recall eligible不等于share/promote |
| `stale`/`expired`/`retired` | 未使用（原因：来源过期/到期/已停用） | Not in use (reason: stale/expired/retired) | internal states preserved | 原因，不作为三个一级用户态 |
| `forgotten` | 已忘记 | Forgotten | internal tombstone | 明示可控/不可控副本 |
| `never_send` | 永不外发 | Never send | `never_send` | hard fail-closed，无override |
| archive + Node + browser | 本地回环科研服务器预览 | Local loopback research server preview | `loopback_preview_legacy` | `v0.2.0`和legacy文档身份 |
| target packaged product | Sestina 桌面应用 | Sestina Desktop App | `desktop_production` | 只有packaged Electron lifecycle通过后使用 |
| local-only | 项目默认保存在本机；只有显式Provider/Host动作才会外发 | Project data stays local by default; explicit Provider/Host actions can send selected data | privacy claim | 禁止简化为“完全离线” |
| no telemetry | Sestina 不采集遥测；第三方Provider是显式外发边界 | No Sestina telemetry; third-party Provider calls are explicit outbound actions | privacy claim | 不等于零网络/零第三方数据流 |

## 3. 认识论声明等级

所有表面必须按以下顺序表达，不得跨级：

1. **Local deterministic proof**：版本、hash、bytes、schema、ID、write success、integrity、binding。
2. **Provider assessment**：指定Provider/model在指定exact payload上的结构化意见。
3. **Evidence support status**：结构化Evidence及其provenance/support/dispute状态。
4. **User Authority decision**：用户决定研究如何继续。
5. **Canonical result**：Kernel实际写入的对象和revision。
6. **Receipt/Trace proof**：上述transition的因果证明。

不允许写法：

- “Sestina验证了这条建议是理论贡献”；
- “span证明了结论”；
- “两个模型达成一致，因此事实更可靠”；
- “用户接受后该事实已被证实”；
- “Receipt就是研究结果”；
- “Memory是Evidence”；
- “本地运行，因此没有安全风险”；
- “显式Skill调用评测证明会自动发现并纠偏”。

允许写法：

- “Provider在此确认payload上将其评估为substantive；Sestina验证了请求绑定、响应结构和引用位置完整性。该判断仍是Provider assessment。”
- “用户将该建议采纳为Decision D-014；此决定不证明相关事实为真。”
- “第二意见来自不同runtime identity；认知独立性未证明。”

## 4. Schema 与 API 兼容名

### 4.1 Write contract

新API只接受新名：`canonicalEffect`、`projectStateRevision`、`contextProjectionHash`、`providerAssessmentAvailability`、四个validity flags、`resultingObjects`。旧`disposition`、`providerStatus=semantic_ready|ledger_only`、`stateHash`不能出现在新write DTO。

### 4.2 Read compatibility

Legacy history decoder输出明确namespace：

```ts
interface LegacyReviewDispositionProjection {
  sourceSchema: "research_room_receipt@1";
  legacyDisposition: "accepted" | "modified_accepted" | "rejected" | "deferred" | "direction_changed";
  mappedOutcome: "legacy_record_only_unresolved_effect" | "record_only" | "formal_direction_change";
  mappingConfidence: "direct" | "lossy";
}
```

UI必须显示`Legacy`/`历史记录`，不能把兼容投影反序列化成新`CanonicalEffect`后再保存。

### 4.3 Deprecated aliases

在一个明确的schema compatibility window内，read decoders可以识别旧名并发出local deprecation diagnostics；write endpoints立即拒绝旧名。Compatibility window以支持打开`v0.2.0`项目为界，不以日期或“未来版本”表述。删除read alias的前置条件是：migration后的历史仍能通过normalized legacy payload展示且Recovery不再需要旧decoder。

### 4.4 Error codes

用户文案用可行动语言，technical code稳定：`review_stale_project_revision`、`manifest_stale_projection`、`provider_attempt_uncertain`、`target_version_conflict`、`legacy_action_read_only`、`migration_mapping_lossy`、`recovery_brief_binding_mismatch`。禁止仅返回`semantic_not_ready`或`ledger_only_restricted`。

## 5. UI 文案迁移

### 5.1 Review Thread固定层级

| 层 | 中文主标题 | English | 禁止主标题 |
|---|---|---|---|
| candidate | 建议 | Suggestion | Proposal accepted |
| context | 将使用的项目上下文 | Project context to be used | Semantic context validated |
| Manifest | 将外发什么 | What will be sent | Hash gate |
| assessment | Provider 评估 | Provider assessment | Semantic finding / Validated finding |
| proof | 本地校验 | Local deterministic checks | Semantic proof |
| effect | 将改变什么 | What will change | Accept / Modified accept（无target） |
| authority | 你的裁决 | Your decision | Provider-approved action |
| result | 已写入项目 | Written to project | Receipt created（作为唯一success） |
| proof record | 变更凭证 | Change Receipt | Canonical result |

### 5.2 State copy rules

- loading说明正在读/算/写哪一步；不能只写“Processing”。
- disabled说明缺哪一个user input/permission/version，不因Provider缺失禁用Authority。
- stale列出旧/新revision和changed objects。
- partial只用于Provider/legacy import等局部事实，不把canonical transaction半成功。
- error保留用户输入，说明网络是否发生、写入是否发生、可安全重试的步骤。
- recovery先说明将恢复哪个project/revision及之后变化，再显示hash/schema。

### 5.3 中英文长度与术语策略

中文优先自然语序，English不回译内部camelCase。`Context Manifest`第一次出现可双语，之后用“外发内容清单”；`canonical effect`第一次出现可写“规范变更（canonical effect）”，普通UI只写“将改变什么”。ID/hash/version仅technical proof或对象详情显示。

## 6. 文档迁移矩阵

| 文档/位置 | 目标修改 | 必须删除/降级 | 完成证据 |
|---|---|---|---|
| `README.md` | 一句话产品定义、唯一闭环、Desktop install、explicit outbound、legacy archive说明 | 多Agent/Memory/Pilot平级feature list；semantic validation过强主张 | packaged release与E2E存在 |
| `docs/ARCHITECTURE.md` | Kernel唯一truth、revision/event/UoW、Review aggregate、Manifest/assessment/effect、IPC | `ledger_only deterministic semantic review`；平行Room/Pilot lifecycle | architecture tests/path map |
| `PRIVACY.md` | local-by-default、Provider/Host explicit outbound、Memory/forget副本、logs/secrets/backups/uninstall | “local-only”被误读完全离线 | data-flow/security tests |
| `SECURITY.md` | Electron/IPC、Host bridge、Provider DNS/connect、path/secret/update threat model | “loopback即可安全”式简化 | threat matrix |
| `docs/security/DATA-FLOW.md` | exact source→projection→Manifest→network；明确禁止字段 | raw Receipt/secret/path/CoT进入payload | socket-body capture |
| Getting Started | installer/open/create/Review/no-Provider path/backup | Node 24/terminal作为target App步骤 | fresh install lifecycle |
| Provider docs | assessment非Authority、failure/uncertain、identity/generation、Manifest | semantic-ready、independent model claim | provider contract tests |
| Recovery docs | project revision/event/Review/Manifest binding、migration journal、backup/downgrade | 仅DB字节恢复叙述 | restore matrix |
| Migration docs | 021–025、lossy generic mapping、legacy read-only、no dual-write | 隐式改变历史语义 | fixture mapping report |
| Release docs | tag/source/tree/toolchain/build/schema/assets/sign envelope | hash=source provenance；archive=Desktop | release attestation |
| UI/Design docs | task-first routes/states/a11y/Logo unchanged | object-first nav和装饰性“AI产品味” | production visual matrix |
| MCP/Skill docs | read-only/draft-only、Kernel Authority、capability budget | external adapter可纠正canonical state | capability tests |
| Agent Corrector docs | same-agent ephemeral、explicit invocation boundary、send-to-Review | 独立watchdog、implicit discovery、persistent truth主张 | branch integration tests |
| Deliberation docs | legacy historical protocol、runtime isolation、independence unproven | 默认新建/更可靠/自动synthesis | read-only route tests |

## 7. README 与产品功能表的目标结构

README的功能顺序必须按用户闭环而非对象数量：

1. 打开本地project并看到当前问题/任务；
2. 导入Suggestion并保存为Review draft；
3. 查看将使用和外发的exact context；
4. 可选取得Provider assessment；
5. 预览并由用户提交typed canonical effect；
6. 从resulting object、Receipt、Search/Attention/Resume/Recovery继续。

Appeal、Memory、Host属于“在主闭环中出现的受治理能力”，不列为平级产品。Legacy Room/Pilot只在migration/history文档中说明。

## 8. Release identity 与产品名称

### 当前基线的准确写法

- `Sestina v0.2.0 Public Preview — local loopback research server preview`
- 中文：`Sestina v0.2.0 公共预览——本地回环科研服务器预览`
- 说明：archive、Node.js 24.x、system browser、无installer/updater/signing/notarization；project data local by default；显式Provider例外。

### 目标完成后的准确写法

- `Sestina Desktop App`
- 中文：`Sestina 桌面应用`
- 只有`10`/`13`定义的Electron packaged lifecycle、三平台、provenance、安全和upgrade/recovery全部通过后使用。

不得把开发模式Electron窗口或unsigned zip称正式Desktop发行。

## 9. Agent Corrector 声明边界

必须持续写明：

- companion Skill，不属于`v0.2.0`已发布能力；
- same-agent、same-session的ephemeral correction candidate；
- 无Sestina DB/Memory/Manifest/Authority，除非用户显式发送候选到Research Room；
- explicit invocation/harness成功不证明implicit discovery；
- 不是独立watchdog，不证明认知独立；
- Host可见路径/内容只按宿主自身权限，Skill不能扩权；
- 要持久化的纠偏必须进入同一Review queue。

合入主树只代表代码归属，不改变上述产品边界。

## 10. 文档如何区分事实、计划与验证

每份公开/内部文档的能力陈述使用以下标签或语法：

- **Current in v0.2.0**：必须有精确tag生产证据；
- **Target design**：对应本计划，明确未实现；
- **Legacy compatibility**：只读/migration/history；
- **Verified in release X**：必须引用release artifact/build ID/test evidence；
- **Not established**：Provider semantic accuracy、cognitive independence、external user/market value等。

禁止将本计划的Schema、route、Electron选择写入“现有架构”而不标target；禁止用`status: proposed_complete_plan`文件作为实现证明。

## 11. Deprecation lint 与自动检查

### 11.1 代码/Schema lint

生产new-write路径出现下列tokens应失败：`semantic_ready`、`ledger_only`、generic `accepted`/`modified_accepted`、`Open Pilot`、Room create route、`confidence: 0.66`、`system_derived_from_validated_assessments`。Legacy decoder/fixture必须通过allowlist路径和注释标记。

### 11.2 UI/i18n lint

所有用户可见copy必须在中文/English同时存在；检测`semantic validated`、`independent opinion`、`local-only`无限定、`Receipt`当result、`Memory evidence`、`Desktop App`用于archive。对状态、destructive、recovery、privacy文案做locale parity snapshot，但snapshot不替代真实渲染。

### 11.3 Docs claim lint

建立claim inventory：claim ID、文本、current/target/legacy、source implementation/test/release evidence、allowed docs。Release gate拒绝无证据的`verified/current`声明和过强semantic/market语句。

## 12. 数据迁移与历史展示

- DB历史保留原enum和raw payload hash；UI通过legacy projection显示，不改写历史文本。
- migration log记录每条lossy mapping；用户可从legacy Receipt查看“原始处置”和“目标系统如何解释”。
- old `semantic_ready`显示“Legacy Provider result was available；此标签不证明语义正确”。
- old `ledger_only`显示“Legacy no-Provider path；当时positive actions可能受限”。
- old Room/Pilot保持原状态/identity/protocol facts，不使用目标UI的active语言。
- exported old Receipts继续可验证其旧hash；新Receipt hash不覆盖或伪造旧hash。

## 13. 测试与验收

- term matrix在Domain/API/UI/i18n/docs中逐项有测试。
- new write DTO拒绝旧aliases；legacy read decoder仍可打开`v0.2.0`。
- no-Provider E2E中UI从不出现`ledger_only`，但准确说明assessment unavailable。
- 合法错误assessment fixture不出现semantic validated/0.66/system fact。
- second opinion每个状态都显示identity和independence unproven。
- record-only completion明确“未改变Brief/Decision/Issue/Evidence”；Receipt detail仍存在。
- Today/Review/Project/Search/Settings route/copy中英一致。
- Memory四用户态及stale/expired/retired原因映射一致。
- current archive与target Desktop命名在README/Getting Started/Release/About不交叉。
- Agent Corrector explicit/implicit边界在Skill、docs、eval README一致。
- docs claim lint能故意捕获一条过强声明并阻止release。

## 14. 完整验收标准

1. 用户无需理解`semantic_ready`、`ledger_only`、Authority Gate、ArgumentDelta内部术语即可完成闭环；
2. 所有Provider输出明确是assessment；所有protocol proof只说明对应事实；
3. 用户Decision与Evidence truth分开表达；
4. 每个action名称包含或邻接“将改变什么”；
5. Receipt始终是proof而非result；
6. Memory始终不是Evidence且默认未外发；
7. legacy Room/Pilot/generic disposition只读、明确legacy；
8. `projectStateRevision`、`contextProjectionHash`等技术名在Schema/API一致，普通UI按需显示；
9. 中英文copy完整、无关键含义不对称；
10. README/Architecture/Security/Privacy/Release/Migration/Agent Corrector与实现证据一致；
11. current archive和target Desktop身份不混淆；
12. 没有文档把计划写成已完成或把fixture/截图/hash写成semantic accuracy/产品价值。

## 15. 明确非目标

- 不通过改文案掩盖未实现的Kernel/migration/UI。
- 不为保留旧术语成本而继续暴露第二套状态机。
- 不创造更多品牌化抽象名。
- 不把术语表扩张为通用AI治理词典。
- 不宣传Provider优劣、外部采用或市场价值。
- 不改变、重绘、反色、裁切或生成官方Logo变体。

## 16. 被拒绝方案与重新考虑条件

- **只在旧词旁加免责声明**：拒绝；旧词仍驱动误解。只有外部API无法立即迁移时可保留read alias，write仍拒绝。
- **全部内部名也换成自然语言**：拒绝；技术contract需稳定精准。只有内部名产生安全/语义冲突时重命名。
- **保留`semantic_ready`解释为“结构有效”**：拒绝；名称本身过强，不重开。
- **把Context Manifest改成普通“发送预览”并隐藏exact proof**：拒绝；会丢产品核心保护。只做渐进呈现。
- **继续把archive称Desktop Preview**：拒绝；只有内置runtime/lifecycle达到Desktop门槛才重开称谓。

## 17. 实施风险与失败收缩

- 旧token分散在tests/docs/generated bundles；采用allowlist inventory，未清完release fail，不全仓盲替换。
- API alias移除可能破坏legacy history；read/write decoder分开，migration fixture固定。
- 中文自然化可能丢技术精度；普通摘要+technical proof双层，关键术语首次双语。
- 文档提前更新造成虚假完成；target/current标签和claim gate阻止。
- Agent Corrector合入时宣传边界漂移；Skill canonical source、generated bundle和docs由单源生成并hash测试。
- 如果UI或Desktop尚未切换，current docs继续描述`v0.2.0`真实形态；不使用目标术语冒充。

## 18. 对其他计划的依赖

`01`定义effect名；`02`定义Authority/assessment policy；`03`定义revision/Manifest；`04`定义Review status和validity flags；`05`定义Brief词；`06`定义routes/UI copy；`07`定义second opinion/legacy Room；`08`定义Memory映射；`09`定义Host/Pilot/Agent Corrector；`10`定义发行身份；`11`定义legacy mapping；`12`定义privacy/security claims；`13`提供lint/production verification；`14`定义何时允许从target改为current；`16`记录最终统一裁决。
