---
title: "用户 Authority、事实真伪与 Provider assessment 解耦计划"
status: proposed_complete_plan
implementation_status: not_started
baseline_release: v0.2.0
baseline_commit: caf893db7928bab91c4098eb04a7e4a8d4c62ffe
source_review: Sestina-v0.2.0-对抗性产品审查.md
source_findings: ["P1-01", "P1-02", "P1-03", "P0-01", "改进项-02"]
depends_on: ["01-REVIEW-CANONICAL-TRANSITION.md"]
blocks: ["04-PERSISTENT-REVIEW-AND-SEMANTIC-CLAIMS.md", "06-TASK-ORIENTED-IA-AND-PRODUCTION-UI.md", "07-APPEAL-SECOND-OPINION-AND-DELIBERATION.md", "09-HOST-PILOT-AND-AGENT-CORRECTOR-INTEGRATION.md"]
affected_layers: ["authority policy", "provider contract", "evidence", "receipt", "UI", "privacy", "tests"]
decision_owner: user
---

# 用户 Authority、事实真伪与 Provider assessment 解耦计划

> 本文件给出该领域的完整目标状态和实施合同。它不是 `v0.2.0` 当前事实，也不是完成证明；标注 `existing_verified` 的内容仅表示基线代码中已直接核对。

## 1. 计划结果

完成后，用户的 action capability 只由本地状态、target 校验和 user Authority 决定，不再由 `semantic_ready`、Provider 配置或调用成功决定。Provider 输出被持久化为带 identity/provenance 的可选 assessment；格式、绑定和引文跨度各自表达，均不自动证明命题。无 Provider、失败、timeout、invalid JSON、用户跳过或 zero-network 时，用户仍可执行全部 `canonical effect`，Receipt 准确记录 assessment availability 与网络事实。

## 2. 来源发现与证据边界

### 对应发现

- `P1-01`：`ResearchRoomService.commit()` 在 `providerStatus === "ledger_only"` 时只允许 `rejected`/`deferred`。
- `P1-02`：`semantic_ready` 由 response parse 成功触发，UI/analysis 又使用“validated semantic criteria”、固定 `0.66` 与 `theoretical_contribution` 映射，容易把协议成功表达成研究事实。
- `P1-03`：`ledgerOnlyAnalysis()` 诚实写 unknown，但实际没有本地 semantic classification；名称和 capability 仍不一致。

### 必须保留的保护

- Provider adapter 只返回结果，不能直接写 Authority。
- `ResearchRoomSemanticJudgeTrace.findings.authority` 为 `model_proposed`，`reasonableIncrement.canMutateAuthority` 为 false。
- exact Manifest/Provider generation/send-time revalidation、redirect error、retry 0。
- `countsAsExternalEvidence` 固定 false。

### 直接代码证据

- `packages/core/src/research-room.ts`：`ledgerOnlyAnalysis()`、`analyze()`、`commit()`。
- `packages/research/src/room/research-room.ts`：provider status、semantic trace、Receipt。
- `packages/review/src/semantic/research-room-semantic-judge.ts`：request/response validation。
- `apps/research-room/src/openai-compatible-provider.ts`：prepared request、exact body、redirect/retry。

真实第三方模型准确率仍不在本计划结论范围；这里规划的是 contract、声明等级、失败与 Authority。

## 3. 当前状态与根因链

```text
Provider 未配置/失败
→ analyzed.providerStatus = ledger_only
→ UI 把正向 action 禁用
→ 用户只能 reject/defer
→ Provider availability 实际控制了 Authority

Provider 返回合法 JSON + 可匹配 span
→ providerStatus = semantic_ready
→ analysis 映射成 Finding/ArgumentDelta/合理增量
→ 用户看到类似系统验证结果
→ 协议完整性被误读为语义/事实正确
```

文案改成“仅供参考”仍不足：只要 capability gate 仍依赖 Provider，或同一个 status 同时承载 binding/schema/span/assessment availability，系统行为仍会反向否定文案。

## 4. 方案空间

| 方案 | Authority 独立 | 事实表达 | zero-network | 迁移/维护 | 风险 |
|---|---:|---:|---:|---:|---|
| A. 保留 `semantic_ready` gate，只加免责声明 | 否 | 弱 | 核心不闭环 | 低 | Provider 继续成为事实上的权限系统 |
| B. 删除 Provider 功能，全部改成人工 Review | 是 | 清楚 | 完整 | 中 | 丢失可选 assessment 与 Manifest 独特增量 |
| C. Provider assessment 与 Authority capability 完全正交；拆分 validity flags | 是 | 强 | 完整 | 中 | 需要 UI/DTO/Receipt 全面迁移 |
| D. 本地 deterministic checker 代替 Provider，并允许它 gate | 仍否 | 规则事实与研究判断混淆 | 部分 | 高 | 伪造本地 semantic certainty |
| E. 用户可绕过 gate，但 UI 默认仍把 Provider 标成“validated” | 行为改善、认识论未闭合 | 弱 | 完整 | 中 | 继续误导 |

### 完全删除 Provider 的反事实

核心 transition 仍可成立，但失去 exact outbound Manifest 的主要使用场景、带来源的第二视角和结构化 unknown。删除不是必要条件；真正要删除的是 Provider 对 action capability 和事实地位的控制。

## 5. 最终推荐裁决

选择 **C：Provider assessment 与 Authority 完全正交，并把有效性拆成可证伪的独立字段**。

- 用户 effect capability = `user actor + valid target + current revision + valid effect`；不读取 Provider status。
- Provider 只增加 `ProviderAssessment`，不改变 Evidence support、Decision authority 或 effect availability。
- `ledger_only` 从用户表面删除；无 assessment 的用户文案是“未取得 Provider 评估”。
- deterministic proof 单独呈现，且只声称 request/version/hash/write 等事实。
- Evidence effect 强制 provenance/support status，阻止“用户点击接受”把 suggestion 变成 verified evidence。
- 牺牲一个“系统已判断好”的简短叙事，换取更诚实且 zero-network 可用的产品。

只有一个 Authority policy 由 Kernel 执行；Provider adapter 和 UI 均消费 policy projection，不复制规则。

## 6. 目标领域模型

### 6.1 Authority classes

| class | `proposed_new`/现有 | 含义 |
|---|---|---|
| `user_direction_authority` | `proposed_new` | 用户可改变问题、范围、决策与工作方向；不证明事实 |
| `user_recorded_evidence` | `proposed_new` projection | 用户授权保存 Evidence；仍需 provenance/support status |
| `model_proposed_assessment` | 基线已有等价语义 | Provider 的结构化判断 |
| `system_deterministic_proof` | `proposed_new` | hash、binding、schema、transaction、integrity 等机器可证明事实 |
| `working_memory_non_authoritative` | `existing_verified` | 记忆上下文，不是 Evidence |
| `host_candidate_non_authoritative` | `proposed_new` | Host/Skill 建议 |
| `migration_translated_history` | `proposed_new` | 迁移保留的旧语义，不新建事实 |

### 6.2 Provider validity/availability

```ts
interface ProviderAssessmentEnvelope {
  assessmentId: string;
  reviewId: string;
  providerIdentity: ProviderIdentitySnapshot;
  manifestId: string;
  request_binding_valid: boolean;
  response_schema_valid: boolean;
  quoted_span_integrity_valid: boolean;
  provider_assessment_available: boolean;
  assessment?: StructuredProviderAssessment;
  failure?: ProviderFailureRecord;
  receivedAt?: string;
  authorityClass: "model_proposed_assessment";
  canMutateAuthority: false;
}
```

这些 flags 不能合并为 `semantic_ready`。`quoted_span_integrity_valid` 只说明 quote 与原文位置/hash 对应，不说明 quote 支持 rationale。

### 6.3 Evidence support

目标 `add_evidence` 使用：

- provenance：source kind、source locator、capturedAt、recorder；
- Evidence state：尽量复用 `packages/research/src/argument/evidence.ts` 的 `current|stale|disputed`；
- link support status：复用 `proven|unproven|disputed|stale`，但由合法证据链接/规则产生，不能从 Provider verdict 自动提升；
- inference capacity：复用现有 Evidence domain；
- user direction decision 与 support status 分栏展示。

### 6.4 Receipt assessment facts

Receipt 记录：

- `assessmentRequested`；
- `assessmentAvailability: available|not_requested|provider_not_configured|failed|timeout|invalid_response|cancelled|uncertain`；
- validity flags；
- Provider identity + manifest/request hashes；
- `networkUsed`；
- canonical effect 独立字段。

Receipt 不记录“assessment correct=true”。

## 7. 状态机与 transition

### 7.1 Provider-independent path

| event | actor | precondition | state change | failure/retry |
|---|---|---|---|---|
| skip assessment | user | Manifest 可为 local no-send snapshot | Review 保持可形成 effect；availability=`not_requested` | 不要求 Provider |
| no Provider configured | Kernel projection | Provider config absent | availability=`provider_not_configured` | effect 全可用 |
| prepare Provider attempt | user | exact Manifest confirmed、Provider snapshot valid | attempt prepared | 不写 Authority |
| Provider fail/timeout/invalid JSON | Kernel | attempt started | failure record；Review 可继续 | retry 必须新 Manifest/新 attempt/显式确认 |
| Provider result valid | Kernel | request binding/schema/span checks | assessment recorded | 仍不解锁/锁定 effect |
| user disputes assessment | user | assessment immutable | correction record | 不改原 assessment |
| commit effect | user | 仅 target/revision/effect valid | canonical mutation | Provider flags不参与 capability |

### 7.2 Authority policy table

| Actor / object | 提交 Review draft | 确认 Manifest | 发起 Provider | 创建 assessment | 选择 effect | commit canonical state | 宣称事实已证明 |
|---|---:|---:|---:|---:|---:|---:|---:|
| User | 是 | 是 | 是/跳过 | 否 | 是 | 是（由 Kernel 执行） | 否；需证据关系 |
| Kernel deterministic code | 可从输入持久化 | 验证但不代替确认 | 执行已确认请求 | 仅记录/验证 | 生成 preview | 验证并原子执行 | 只对协议/状态事实 |
| Provider | 否 | 否 | 否 | 是，non-authoritative | 否 | 否 | 否 |
| Host/Skill/MCP | draft-only 或 read-only | 否 | 否 | 可提供 candidate text，非 Provider assessment | 否 | 否 | 否 |
| Memory | 否 | 需用户逐项选择 | 否 | 否 | 否 | 否 | 否 |
| Receipt | 否 | 否 | 否 | 记录 availability | 否 | 否 | 仅证明 transaction |
| Migration | 翻译历史 | 否 | 否 | 仅映射已有 trace | 否 | 否 | 否 |

### 7.3 stale/cancellation

Provider attempt cancellation 不取消 Review；只将 attempt terminal。Provider configuration generation 变化使 Manifest/attempt stale，但 effect preview若只依赖本地 state仍可重新计算并提交。

## 8. 数据流与 Authority 流

```text
Suggestion
→ local Review draft
→ local project context / deterministic proof
→ Exact Manifest (network still off)
→ [optional explicit Provider send]
→ ProviderAssessmentEnvelope (non-authoritative)
→ canonical effect preview
→ user Authority
→ canonical mutation + Receipt(assessment availability)
```

- 允许网络：仅显式 Provider send；Provider test 只能 metadata-only，且与研究 Review 分离。
- 允许 Authority write：effect commit。
- derived：assessment coverage、Finding presentation、Attention。
- fail closed：request binding/schema/size/redirect/config generation 不符时 assessment unavailable，但不阻塞 user action。
- Provider payload 排除 secret、absolute path、hidden reasoning、Authority nonce、其他项目、未选择 Memory、旧 raw Provider outputs、UI prefs。

## 9. API、Schema、Repository 与代码边界

| 文件/模块 | 当前 | 目标 | 修改 | 证据 |
|---|---|---|---|---|
| `packages/core/src/research-room.ts` | `providerStatus` 与 commit gate | 删除 gate；attempt outcome 只写 assessment envelope | 重构 | `existing_verified` |
| `packages/research/src/room/research-room.ts` | `semantic_ready|ledger_only` | legacy decoder；新 envelope/availability types | 弃用/新增 | `existing_verified` |
| `packages/review/src/semantic/submit-semantic-review.ts` 与 Judge | parse/validate response | 返回分离的 validation facts + assessment，不命名 semantic-ready | 重构 | `existing_verified` |
| `packages/review/src/semantic/stable-text-span.ts` | span integrity | 保留；明确不生成 support status | 保留/重命名 projection | `existing_verified` |
| `packages/core/src/authority-policy.ts` | 不存在 | 单一 action capability matrix | `proposed_new` | 计划对象 |
| `apps/research-room/client/src/components/product/ReviewWorkspace.tsx` | Provider status 决定按钮 | 始终允许 effect；assessment 区独立 | 重构 | `existing_verified` |
| `apps/research-room/client/src/i18n/copy.ts` | semantic/ledger 文案 | 新中英文 claims | 重构 | `existing_verified` |
| `apps/research-room/src/openai-compatible-provider.ts` | exact request + send | 保留；返回 immutable identity/attempt facts | 保留/扩展 | `existing_verified` |
| `apps/research-room/src/provider-settings.ts` | config/generation/secret | 保留 generation；不参与 Authority | 保留 | `existing_verified` |
| `ProviderAssessmentPanel.tsx` | 不存在 | assessment、validity、unknown、identity | `proposed_new` | 计划对象 |

新 DTO 不再暴露 `canSemanticDisposition`。服务端返回 `allowedEffects`，该值只由 Authority policy 和本地 target capability产生。

## 10. UI 与交互

- **默认**：Manifest 后直接出现 effect 区；Provider 区显示“可选”。
- **无 Provider**：显示“未取得 Provider 评估。你仍可根据当前项目状态记录决定；这不会证明事实为真。”并提供 Settings 链接，非阻塞。
- **assessment loading**：只锁 Provider attempt 的 cancel/retry，不锁 effect draft；若用户提交 effect，明确该 attempt 将取消或 assessment 后到达只作为历史记录。
- **invalid JSON**：显示 `响应格式无效`、Provider identity、attempt time；隐藏 untrusted raw output 的可执行链接，允许安全查看经过转义的原文 technical proof。
- **valid response**：分三层：Provider 评估摘要；“协议检查”flags；technical proof。不得把三个绿色 check 合并成“通过语义验证”。
- **用户跳过**：记录 `not_requested`，不显示警告级错误。
- **offline**：Provider 区显示网络未使用；核心 effect 仍可用。
- **Evidence action**：表单强制选择 provenance/support relation；旁注“保存为证据记录不等于已证明”。
- **Receipt**：第一行是 canonical effect/result；assessment availability 是次级元数据。
- **screen reader**：assessment、protocol proof、Authority outcome 使用不同 landmark/heading；不靠颜色区分。
- **长错误**：用户摘要限制长度，完整 Provider error 在 technical panel，secret/header/body 自动 redaction。

## 11. 中文／English 与术语

- `semantic_ready` → 不再用户可见；兼容字段映射为 `provider_assessment_available=true` 加各 validity flags。
- `ledger_only` → 用户文案“未使用/未取得 Provider 评估”；内部仅 `legacy_ledger_only`。
- `validated semantic result` → `格式有效的 Provider assessment`。
- `reasonable increment` → `Provider 认为这是合理增量` 或 deterministic derivation 明确来源。
- `confidence 0.66` → 删除；不以固定数字装饰不确定性。
- `Evidence verified` → 仅当现有 Evidence/link domain 满足支持规则；不能来自用户点击或 Provider verdict。

完整中英迁移在 `15-TERMINOLOGY-DOCS-AND-CLAIM-MIGRATION.md`。

## 12. 隐私、安全与权限

- Provider output、imported research text 和 Host suggestion 都是不可信文本，Renderer 必须文本化渲染，不得解释 HTML/Markdown action links 为权限命令。
- Provider 端点不获得 project filesystem、tools、Host token 或 Authority nonce；payload 只能来自 confirmed Manifest。
- secret 存 OS secret store；Provider error/log 不保留 Authorization header。
- redirect=error、retry=0、response size cap 保留；DNS/private address控制见 `12`。
- 用户跳过 assessment 不应被暗示为低安全；安全来自 Manifest/Authority/target validation，不来自模型评审。
- Provider assessment 不得自动进入未来 payload；如用户显式选择，必须作为带来源对象显示在 Manifest。
- capability budget：Provider adapter只有 `prepare` 和 `invoke`；无 file/tool/commit port。

## 13. 数据迁移与向后兼容

- legacy `semantic_ready` Receipt 映射：`provider_assessment_available=true`；根据已有 manifest/trace 填 `request_binding_valid`、`response_schema_valid`、`quoted_span_integrity_valid`。不能从 trace 推断 semantic support。
- legacy `ledger_only` 映射为 availability reason；原词只保留在历史 raw JSON/compatibility API。
- fixed confidence `0.66` 作为 legacy presentation data 不进入新 assessment；保留原 hash 供审计。
- 旧 Finding/ArgumentDelta 保持 immutable historical provider projection，不自动转 Evidence/Decision。
- Provider settings generation 继续独立；migration 不推进 project revision，除非其配置当前被错误存进 project canonical data（实施前核对 `provider-settings.ts` storage location；答案只影响设置迁移，不改变 policy）。
- 新 UI 读取 legacy assessment 时必须显示 `migrated legacy assessment` 与 claim boundary。
- rollback/downgrade遵循 `11`；旧 release 不应读取新 flags。

## 14. 测试与验证

- RED：无 Provider 时所有六种 effect 的 server contract 应成功进入 preview/commit。
- RED：`provider_assessment_available=false` 不改变 `allowedEffects`。
- RED：合法 JSON、有效 span、语义自相矛盾 fixture 只能得到格式/跨度 flags，不得到“正确”。
- unit：Authority policy 全矩阵；任何 Provider/Host actor 的 commit 都失败。
- property：随机 Provider outcome 与 effect capability 独立；只有本地 target/revision影响 capability。
- provider contract：exact body、generation、redirect、retry、timeout、size、cancel、invalid response。
- Receipt：所有 availability reason 与 `networkUsed` 真实一致。
- E2E：no Provider、skip、timeout、invalid JSON、available assessment 五条路径完成相同 effect。
- crash：Provider response 到达而 assessment write 不确定，恢复为 `provider_attempt_uncertain`，不自动重发；user仍可 effect。
- privacy：raw error/header/secret redaction；no-network assertion以 socket阻断验证。
- accessibility/visual：三层信息不靠颜色；长 rationale/error；中文/English。
- 测试不得把 fixture 命中率冒充真实 Provider质量。

## 15. 完整验收标准

- 全新项目不配置 Provider也能完整闭环并重启恢复。
- Provider失败、timeout、invalid JSON、用户跳过均不禁用 effect。
- UI在任何页面都不再显示 `semantic_ready`/`ledger_only` 作为研究质量状态。
- 每个 assessment显示 Provider/model/origin/generation/time/Manifest identity与 `assessment only`。
- request/schema/span三个事实分开，且没有“因此结论正确”的 derived badge。
- Evidence action缺 provenance/support status 时不能提交；用户方向决定旁显示不证明事实。
- Receipt 首先说明 canonical result，再说明 assessment availability/network。
- Search/Attention 不把 Provider Finding 排在 canonical Decision/Evidence之上，也不去掉来源标签。
- Provider、Host、Skill、MCP 无 Authority write path。
- zero-network E2E捕获不到外发连接；现有 exact Manifest、安全和 recovery不回归。

## 16. 明确非目标

- 不本地伪造 Semantic Judge。
- 不评价具体模型准确率或选择最佳 Provider。
- 不让用户 Authority替代 evidence support规则。
- 不把每个 Provider输出保存为 Evidence。
- 不增加自动事实核查网络服务。
- 不删除可选 Provider assessment。
- 不允许后台 Provider调用或隐式重试。
- 不建立云账户或共享 Authority。

## 17. 被拒绝方案与重新考虑条件

- **保留 gate + 免责声明**：只有法律/安全外部动作需要 Provider作为强制审批者时才重开；研究方向决定不属于该场景。
- **完全删除 Provider**：只有维护成本压倒 Exact Manifest/assessment的直接价值，且产品选择纯本地状态管理时重开。
- **本地 deterministic semantic gate**：只有某个判断可被明确、稳定、可验证的规则定义时，可作为 deterministic proof单项加入；不得用“本地模型”替代认识论边界。
- **软绕过但保留 semantic-ready**：不能重开，因为仍制造两套声明等级。

## 18. 实施风险与失败收缩

- 若先删 UI gate、后端仍 gate，会出现按钮可点但409；切换必须同一集成边界完成。
- 若先改 status 名称但 Receipt/migration 未改，会丢失历史外发事实；legacy decoder须先落地。
- Provider结果写入不确定时，不能把“可能已调用”包装为失败可重试；状态必须 uncertain。
- Evidence领域存在多套历史模型时，支持状态统一前禁止从 assessment自动创建 Evidence。
- 文档仍使用 semantic validation会逆向污染 UI/测试；`15`与代码同步合并。
- 实施中 Provider adapter可临时停用，但核心 Review必须保持可用，避免混合 capability truth。

## 19. 对其他计划的依赖

- `01-REVIEW-CANONICAL-TRANSITION.md` 定义 Provider-independent effect。
- `04-PERSISTENT-REVIEW-AND-SEMANTIC-CLAIMS.md` 定义 assessment envelope/attempt状态。
- `03-PROJECT-STATE-REVISION-AND-MANIFEST.md` 定义 exact request 与 Provider generation stale。
- `05-PROGRESSIVE-RESEARCH-BRIEF.md` 让缺失 context显示 limitation/unknown，不由 Provider猜测。
- `07-APPEAL-SECOND-OPINION-AND-DELIBERATION.md` 使用同一 assessment声明等级。
- `08-GOVERNED-MEMORY-SIMPLIFICATION.md` 保证 Memory不成为 Evidence。
- `09-HOST-PILOT-AND-AGENT-CORRECTOR-INTEGRATION.md` 应用同一 Authority表。
- `12-PRIVACY-SECURITY-AND-THREAT-MODEL.md` 定义 Provider/Host网络边界。
- `15-TERMINOLOGY-DOCS-AND-CLAIM-MIGRATION.md` 统一中英文和旧字段。
- `13-TEST-EVAL-AND-PRODUCTION-VERIFICATION.md` 区分 protocol测试与真实模型质量。
