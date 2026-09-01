# Sestina `v0.2.0 Public Preview` 对抗性产品审查

> **审查对象**：`Roblis0n/Sestina` 精确发行版 `v0.2.0`  
> **公共 tag / target commit**：`caf893db7928bab91c4098eb04a7e4a8d4c62ffe`  
> **发行渠道**：`public_preview`  
> **许可证**：`Apache-2.0`  
> **审查性质**：只读、产品本体审查；不修改代码，不使用试用者反馈，不判断市场、采用与真实 Provider 质量  
> **最终裁决**：**问题定义成立，但当前 Kernel／对象模型需要重构。**

---

## 0. 审查范围与证据覆盖

### 0.1 实际读取与核对的材料

本次审查严格以精确发行物和 `v0.2.0` 生产代码为主，实际覆盖：

1. **精确源码树**：从 `caf893db7928bab91c4098eb04a7e4a8d4c62ffe` 导出，重点追踪：
   - `packages/core/src/research-room.ts`
   - `packages/review/src/semantic/research-room-semantic-judge.ts`
   - `packages/core/src/correction-appeal.ts`
   - `packages/core/src/deliberation-room.ts`
   - `packages/core/src/project-memory.ts`
   - `packages/storage/src/backup.ts`、`restore.ts` 及 migration／projection
   - `apps/research-room/src/server.ts`
   - `apps/research-room/src/openai-compatible-provider.ts`
   - `apps/research-room/src/provider-settings.ts`
   - Research Room React 生产界面、路由、DTO、CSS 与本地化文案。
2. **公开发行制品**：读取 Windows x64、macOS arm64、Ubuntu x64 的 release index、manifest、hash；解包 Ubuntu x64 archive，核对 `start.mjs`、编译产物、`RELEASE-IDENTITY.json` 和附带文档。
3. **发行完整性与来源链**：对 `public-release/SHA256SUMS` 执行校验，列出的三平台制品和 manifest 均通过；同时比较 `release-index.json.sourceCommit`、公开 tag target 与对应 Git diff。
4. **生产测试、schema 与 migration**：检查 Review、Semantic Judge、Provider、Appeal、Deliberation、Memory、Recovery、MCP、Release contract 等测试。测试只证明其实际覆盖的合同，不被当作语义正确、产品有用或视觉可用的替代证据。
5. **生产截图**：读取 `docs/assets/research-room-overview.png`。它支持对三栏布局、导航密度、Manifest 与 Inspector 呈现的判断，不等同于完整交互渲染。
6. **发布后独立分支**：单独读取 `codex/agent-corrector` commit `74c62c5f4ab22cc8267a4edc74cfaa34b078a3a8`，只在附录中评价，未将其计入 `v0.2.0` 能力。

### 0.2 运行与渲染边界

当前审查环境只有 Node.js `22.16.0`，发行启动器明确要求 Node.js `24.x`。执行 Ubuntu 制品的 `node start.mjs --version --json` 时，启动器正确 fail closed，并输出 `Sestina Research Room requires Node.js 24.x.`。该结果证明版本门禁存在，不证明 Node 24 下的完整产品旅程。

为核对 loopback 壳层，在**不受支持的 Node 22** 下直接启动编译后的 `app/main.js`，可观察到：

- 只监听 `127.0.0.1`；
- `/` 与 `/api/status` 可访问；
- `localOnly: true`、`telemetry: false`；
- 随机 session token、CSP、COOP、no-referrer、nosniff、`X-Frame-Options: DENY`；
- 项目初始化返回 `infrastructure_failure`。

最后一项不列为发行版缺陷，因为运行时不受支持。本报告没有声称完成 Node 24 下的全页面、全主题、全错误态、全恢复旅程运行复现。

### 0.3 UI 证据等级

- `rendered_confirmed`：本次没有获得足够完整的生产页面来授予该等级；
- `screenshot_supported`：由现有生产截图支持；
- `source_inferred`：由生产 React、路由、DTO、CSS 与 Core projection 推断；
- `unverified_visual_hypothesis`：必须通过真实渲染、缩放、超长内容或键盘操作验证。

### 0.4 明确排除

本次没有读取、概括、引用或据以判断任何外部试用者反馈、Pilot 参与者记录、session 配对结果、访谈、观察、问卷、反馈表、GitHub 用户评论、stars、forks、downloads、访问量、采用、留存、市场价值、商业价值、RI-55 门槛或第二次真实使用证据。真实第三方 Provider 的准确率、模型能力高低以及用户是否配置真实 API 也不在结论范围内。

---

## 1. 最终产品裁决

### 1.1 明确结论

**最接近的裁决是：问题定义成立，但当前 Kernel／对象模型需要重构。**

Sestina 所针对的问题真实且不应被轻视：长周期、跨会话、跨宿主的 AI 辅助研究容易发生目标替换、有效决定丢失、证据边界冲淡、重复审计以及“模型说过”被误当成“研究状态已经改变”。普通聊天记录无法稳定提供确定性的状态绑定、显式用户 Authority、精确外发 payload、可验证 Receipt 和 fail-closed 恢复。

但 `v0.2.0` 没有把这些独特能力连成一个无歧义结果：

- `accepted` 与 `modified_accepted` 通常只新增 Receipt，没有形成明确 Decision、Evidence、Issue、Brief 或其他可继续工作的 canonical 改变；
- Context Manifest 的实际 payload 包含 `receiptSummary`，而 stale gate 的 `stateBinding` 排除 Receipt，导致“当前状态精确绑定”存在确定性缺口；
- Provider 未配置或失败时，用户不能执行接受、修改后接受或正式改向，Semantic Judge 实际成为用户 Authority 的前置条件；
- Semantic Judge 严格验证的是 request identity、JSON schema、IDs、hash 与字符串 span，Core／UI 却将结果上提为 `semantic_ready`、`validated semantic criteria`、`theoretical_contribution` 等更强语义；
- UI 围绕 Brief、Decision、Issue、Evidence、Episode、Receipt、Finding、Appeal、Memory、Room、Manifest、ArgumentDelta 等内部对象与协议组织，而不是围绕“收到建议—理解影响—作出裁决—得到可恢复研究改变”的单一任务组织。

因此，Sestina 不是“产品本体完全不成立”，也不是只需调整颜色和 onboarding。值得保留的基础设施已经存在；需要重构的是 Review transition、状态真相、Provider 结果的认识论表达和主信息架构。

### 1.2 最强的反对论证

**一个谨慎用户用 ChatGPT／Codex，加一份维护良好的 `PROJECT.md`、Markdown 决策日志和 Git，可以复现当前大部分可见使用价值；Sestina 为剩余的确定性保证付出了显著对象、状态和仪式成本，但最关键的“接受后形成什么 canonical 结果”和“Manifest 是否绑定全部当前上下文”仍未闭合。**

换言之，当前复杂度不是完全没有价值，而是独特增量尚未成为用户每次使用都能直接得到的结果。

### 1.3 最强的支持论证

**Sestina 已实现普通提示词与笔记难以可靠复制的若干确定性保证**：exact Provider request body 的预览与发送前再绑定、用户直达命令才能写 Authority、loopback-only 与只读宿主边界、DB 与 Research Brief 联合绑定的备份／恢复、future-schema fail-closed、Project Working Memory 的 `Store ≠ Recall ≠ Share ≠ Promote`。

这些不是仅存在于文档的概念，而有生产代码支撑。

### 1.4 哪一方更有证据

对“问题是否值得解决”，支持论证更有证据；对“`v0.2.0` 是否已形成内在成立、功能闭环、认知成本合理的本地科研 App”，反对论证更有证据。当前应保留 Kernel 中的确定性边界，但重写其对用户暴露的对象模型与处置语义。

---

## 2. 实际产品模型

### 2.1 不可约简的用户任务

用户真正需要完成的任务可以压缩为：

> **在已有研究问题、决定和证据边界下，判断一条新的 AI 建议是否值得改变当前研究，并把这次改变以可解释、可撤销、可恢复的方式保存下来。**

用户进入 Sestina 时通常带着：

- 一个正在持续推进的本地研究项目；
- 当前研究问题与当前任务；
- 已接受或冻结的决定；
- 已知 Issue、Evidence 与 unknown；
- 一条来自 ChatGPT、Codex、其他 Agent 或人工来源的新建议；
- 对这条建议究竟是增量、重复审计、论证跳跃还是目标替换的不确定。

用户应得到的不可替代结果不是九项 rubric 或一张 Receipt 本身，而是：

1. 我准确看见系统准备把什么发给谁；
2. 我看见这条建议与当前研究状态的关系及不确定性；
3. 我明确决定采纳、修改、拒绝、暂缓或改向；
4. 系统明确告诉我这次决定改变了哪个 canonical 对象；
5. 下次打开项目时，恢复的是改变后的研究状态，而不是一堆需要重新解释的审计记录。

| 类别 | 当前内容 | 产品判断 |
|---|---|---|
| 用户真正要完成的研究任务 | 理解一条建议、决定是否改变研究、继续推进 | 必须成为主界面与主状态机 |
| 为连续性增加的必要结构 | versioned Brief、Decision、Evidence、state binding、Manifest、Receipt、Recovery | 值得保留，但应退居任务之后 |
| 仅为系统治理增加的步骤 | rubric／protocol hash、Provider generation、canonical IDs、多个 Authority Gate、对象状态工作区 | 只在风险相关时展示 |
| 没有直接用户结果的复杂度 | 多套会商／申诉仪式、Closed External App Pilot 独立生命周期、平级对象导航 | 删除、暂停或折叠 |

### 2.2 从代码恢复的实际最小闭环

```text
本地项目目录
→ 选择／初始化项目
→ 输入 Research Question + Current Task
→ 形成 Active Research Brief
→ 粘贴一条 AI suggestion
→ 生成 Context Manifest（尚未发送）
→ 用户在 Inspector 检查 exact request
→ Provider 路径：严格 JSON Semantic Judge
   或 ledger_only：provider_unavailable 通用分析
→ 展示 Finding / ArgumentDelta / alternatives / unknowns
→ 进入 Authority Gate
→ accepted / rejected / modified_accepted / deferred / direction_changed
→ 生成 Receipt
→ 仅 direction_changed 必然改变 Active Brief
→ 刷新 projection、Search、Attention、Receipt / Trace
→ 重启后从 SQLite 与 Research Brief 恢复已提交状态
```

闭环在两个位置断裂：

1. **处置 → canonical 研究结果不完整。** `accepted` 与 `modified_accepted` 没有定义要改变哪个研究对象；Receipt 成为处置存在的证明，却不是可继续工作的研究结果。
2. **当前状态 → Manifest stale gate 不完整。** Provider context 含 Receipt history，而 stale gate 不感知 Receipt history 变化。

### 2.3 Authority 与 Truth 的实际数据流

| 来源 | 能否直接写研究 Authority | 实际能证明什么 | 当前风险 |
|---|---:|---|---|
| 用户直接命令 | 是 | 用户作出了方向或处置决定 | 决定不能把错误事实变成真实事实；UI 需分开“选择”与“事实” |
| Semantic Provider | 否 | 一个绑定到固定 request 的模型 assessment | 被呈现成 canonical-looking Finding 与 `semantic_ready` |
| deterministic code | 执行已定义 transition | hash、ID、版本、字符串 span、写入是否成功 | 协议完整性与语义有效性被混同 |
| Evidence 对象 | 否 | 一条结构化证据记录存在 | Memory、Receipt、Finding 不应自动等于 Evidence |
| Receipt／Trace | 否 | 某命令、上下文与结果被记录 | 承担了过多“研究结果”职责 |
| Tool／host result | 否 | 某个受限执行发生 | Closed Pilot 增加第二套候选与连续性过程 |
| 未证明项 | 否 | 当前材料不足以支持结论 | 应在主界面持续可见，而不是埋在 Inspector |

### 2.4 与 ChatGPT／Codex + Markdown + Git 的反事实比较

下表是基于功能关系的对抗性估计，不是使用数据：**对谨慎用户可感知的日常生产力价值，普通聊天 + Markdown + Git 可以复现约 70%～80%；对确定性保证，只能复现较少部分。**

| 能力 | Markdown／Git／严格提示词 | Sestina 的真实增量 | `v0.2.0` 是否突出 |
|---|---|---|---|
| 保存问题与任务 | 可以 | versioned active binding | 部分突出 |
| 记录决定、未知项、证据边界 | 可以 | 类型约束、关系、状态机、检索 | 被对象复杂度抵消 |
| 防止模型擅自改向 | 提示词可降低概率 | user-only write、expected version、Authority Gate | 有实现，但 Provider gate 反向削弱 |
| 看见实际外发内容 | 通常困难 | exact body、hash、bytes、endpoint、0 retry、redirect error | 最强独特价值 |
| 证明一次接受改变了什么 | 手工写 Git diff | 理应由 canonical transition + Receipt 自动完成 | 当前未闭合 |
| 崩溃／迁移／损坏恢复 | Git 只覆盖已提交文件 | SQLite integrity、Brief binding、managed backup、future schema fail-closed | 强，但非主入口价值 |
| 跨宿主一致状态 | 需人工同步 prompt 与文件 | Core state + read-only MCP／Manifest | 有基础，UI 表达不直接 |
| 多 Agent 独立增量 | 可手工开多个会话 | protocol blindness、bounded calls、identity checks | 复杂度高，认知独立仍 unproven |

最独特的产品增量应被表述为：

> **任何外发与状态改变都绑定到一个用户可见、版本化、可恢复的本地研究状态，并留下可核验的因果证明。**

当前最大的结构化成本是：这项增量被拆成了过多对象、状态、协议和工作区，用户必须先学习 Sestina 的内部本体，才能完成一个本应直接的研究决定。

### 2.5 当前产品的实际身份

从实现看，`v0.2.0` 同时是：

1. versioned research-state database；
2. optional Provider semantic-review protocol；
3. Authority／Manifest／Receipt 治理协议可视化；
4. archive-based loopback local web application。

因此更准确的当前身份是：

> **一个拥有可靠本地状态与恢复基础的研究治理协议工作台，而非已经成熟的直接科研工作 App。**

### 2.6 十四项反事实攻击

| 场景 | 当前反应 | 风险与证据状态 | 修正方式 |
|---|---|---|---|
| 1. 谨慎用户只用 ChatGPT／Codex、Markdown、Git，能否获得 80% 价值？ | 可复现问题、决定、证据、日志与回滚的大部分可见流程；难以复制 exact request binding、原子状态机与 recovery。 | **推断：**可见价值接近 80%，独特保证远低于 80%；当前 UI 未把独特保证压缩为主要结果。 | 把主产品收缩为 state-bound review-to-decision transition。 |
| 2. 完全不配置 Provider，是否仍值得独立使用？ | 能管理 Brief、对象、搜索、备份和恢复；Review 只返回通用 `provider_unavailable`，且不能接受、修改接受或改向。 | `confirmed_defect`。 | `ledger_only` 允许所有用户处置，仅标明没有 Provider assessment。 |
| 3. Provider 返回格式合法但语义错误，span 也匹配？ | 通过 schema、hash、ID、span 后进入 `semantic_ready`，生成 Finding／ArgumentDelta。 | `probable_risk`：只能证明模型按格式说了什么。 | 改名为 `provider_assessment_available`，分开 request／schema／span integrity 与 semantic support。 |
| 4. 两个所谓独立 Provider 实际高度相关？ | 相同 connection/runtime/endpoint/secret 被阻止；不同别名、镜像或网关可通过。 | `probable_risk`；代码诚实保留 `cognitiveIndependence: unproven`。 | 统一称 `runtime-distinct second opinion`。 |
| 5. 用户错误接受候选，之后如何撤销？ | Receipt 可 rollback；只有 `direction_changed` 真正恢复 Brief，其他接受本来就未改变 canonical object。 | `confirmed_defect`。 | 每种 disposition 绑定明确 target 与 before/after diff。 |
| 6. Brief 已变化，但旧 Manifest／Finding／Appeal 仍在？ | Brief、Decision、Issue、Episode 变化会 stale；Receipt history 变化不会。 | `confirmed_defect`。 | 单调 `projectStateRevision` 覆盖全部 outbound-relevant projection。 |
| 7. 项目有 1000 对象、长 Brief、数百 Attention？ | 列表有分页和上限；Review 可加载大量 Memory；响应式源码存在。 | `unverified_hypothesis`：数据库边界较好，认知与渲染扩展性未证明。 | 任务首页、关系聚合、虚拟化、对象退居 History。 |
| 8. DB 损坏、迁移中断、备份不完整、future schema？ | 有 integrity check、managed bundle、Brief binding、pre-upgrade／pre-restore、too_new／too_old／migration_failed fail-closed。 | `survived_adversarial_review`，运行 UI 未完整复现。 | 保留，增加普通语言诊断与恢复结果预览。 |
| 9. `forget` 后正文能否从索引、Receipt、Trace、备份回来？ | 当前 store、recall、Manifest 排除 forgotten；UI 说明旧 Provider receipt、导出、旧备份可能保留副本。 | `survived_adversarial_review`。 | 保留边界，简化状态并列出可控／不可控副本。 |
| 10. 导入文本含恶意指令，能否越过 Context、Authority 或工具边界？ | 研究文本视为不可信数据；Provider 无工具与 Authority；host 使用只读／受限能力。 | 未发现直接越权路径；模型建议仍可能受污染。 | 所有 adapter 复用不可信输入分类与 capability budget。 |
| 11. 新用户不懂 `ledger_only`、Manifest、Finding、ArgumentDelta、Authority Gate，能否完成核心闭环？ | 可到达 Review 与 Manifest；默认无 Provider 时正向处置被禁用，术语密度高。 | `confirmed_defect`。 | 用“将发送什么／系统发现什么／你决定什么／会改变什么”组织界面。 |
| 12. 1100px、200% 文本、High Contrast、键盘、超长中文？ | CSS 有断点、overlay、focus、reduced motion、High Contrast；有部分 focus trap。 | `unverified_visual_hypothesis`。 | 建立真实页面与状态矩阵，不能以 CSS/DOM 替代。 |
| 13. App 突然退出后恢复可信状态还是旧状态？ | committed SQLite／Brief 可恢复；prepared、in-flight、analyzed Review 存于进程内 Map。 | `confirmed_defect`：恢复最后提交状态，但不能恢复正在审议的因果位置。 | 持久化 Review snapshot、Manifest confirmation 与 analysis。 |
| 14. 删除 multi-agent、Appeal、Memory、MCP 后核心是否更清楚？ | 核心会明显更清楚；Manifest、versioned state、Receipt、Recovery 仍具独特价值。 | Deliberation 与 Closed Pilot 最应退出主产品；Memory 简化；Appeal 二级化；MCP 保持薄层。 | 先闭合单条 Review，再保留证明有非冗余增量的外围能力。 |

---

## 3. 产品主张—发行现实矩阵

| 产品主张 | 真实发行行为 | 证据等级 | 主要缺口 | 是否应保留 |
|---|---|---|---|---|
| Start Center、本地项目选择与初始化 | 有语言页、directory picker 可选与手工路径回退；初始化前确认将创建的本地状态。 | 生产实现；局部 HTTP runtime | Node 24 全流程未复现；入口更偏“打开目录”，没有立即展示独特用户结果。 | 保留，改成任务导向 |
| 中文／English | 文案表与首启语言持久化存在。 | 生产实现 | 对象和协议术语仍重。 | 保留 |
| Light／Dark／High Contrast | appearance state、tokens、High Contrast、reduced motion 与断点存在。 | 生产实现；`source_inferred` | 缺全页面、长内容、200% 缩放实测。 | 保留并补真实验证 |
| Research Brief | versioned、candidate、diff、explicit activation、YAML projection。 | 生产实现 | 首次只采集 question/task；高级编辑暴露 JSON 与 IDs。 | 保留，重做编辑器 |
| Decision／Issue／Evidence／Episode | 独立 store、projection、分页、搜索与 Inspector。 | 生产实现 | Review 接受不自动产生这些对象；用户需自行理解关系。 | 归入 Project 二级面 |
| Receipt／Trace | 记录 disposition、before/after、Manifest、analysis、rollback 与 trace。 | 生产实现 | Receipt 被当成结果替代物；多数 disposition 的 before/after 相同。 | 保留为证明 |
| Overview／Search／Attention／Inspector | 有生产路由和 typed projection；截图显示三栏。 | 生产实现；截图支持 | 对象类型、hash 和状态徽章与下一步竞争注意力。 | 保留能力，重组 IA |
| 单条 AI 建议 Review | 输入、Manifest、analysis、Authority Gate、Receipt 路径存在。 | 生产实现；截图支持 | 默认无 Provider 不能正向处置；接受后 canonical effect 不明。 | 必须保留并成为唯一主闭环 |
| Context Manifest exact preview／hash／显式确认 | 显示 endpoint、exact request body、bytes、hash、included/excluded fields；发送前重算与逐字段比较。 | 生产实现，强证据 | stale binding 不覆盖 Receipt history。 | 核心保留并修复 |
| Semantic Judge 九项准则 | 固定 protocol/prompt/rubric、strict JSON、unknown、span、identity validation。 | 生产实现；语义效果未证明 | 证明协议与 span，不证明结论；固定 `0.66`；UI 过度实体化。 | 保留为可选 Provider assessment |
| Provider 未配置时 `ledger_only` | 生成 `provider_unavailable` Finding、`unproven` delta 与通用 unknown。 | 生产实现 | 与文档声称的本地 deterministic scope/evidence/repeated-audit checks 不一致；正向处置被阻止。 | 保留模式，重定义 |
| Finding Appeal | 原 Finding 保留；Appeal append-only；Resolution 独立记录。 | 生产实现 | 流程复杂，Resolution 不修正来源对象。 | 折叠为 Review 二级路径 |
| 一次独立第二意见 | 阻止同 connection/endpoint；排除原 verdict/reason/confidence/raw response。 | 生产实现 | 只能证明 runtime/context isolation，不能证明认知独立。 | 更名并弱化主张 |
| 两参与者、互盲、有限轮次 Room | 恰好两个 Provider；初始请求先冻结；互盲；有限调用；无投票、无赢家。 | 生产实现；测试合同 | Difference 是结构化文本比较；认知独立 `unproven`；Resolution 不改来源对象。 | 暂停主产品入口 |
| 用户处置与 Authority Gate | 只有 direct user actor 可 commit，Provider 不能写 Authority。 | 生产实现 | `semantic_ready` 又成为接受／修改／改向前提。 | 保留 user-only mutation，删除 Provider gate |
| Project Working Memory | candidate/active/stale/expired/retired/forgotten；默认 `never_send`；显式 Manifest 才可发。 | 生产实现 | 用户可见生命周期过细，形成第二套待维护知识库。 | 保留边界，简化 UI |
| `Memory ≠ Evidence` | Memory 使用非权威 authority class，Provider payload 标为 context-only；forgotten 不召回。 | 生产实现 | Search／Inspector 中仍需持续以普通语言区分。 | 保留 |
| 备份、恢复、升级、future-schema fail-closed | SQLite native backup、integrity、sidecar、containment、DB+Brief binding、managed restore、pre-upgrade/pre-restore。 | 生产实现，强证据 | Node 24 下完整 UI 未实测。 | 核心保留 |
| Codex／MCP／Skill 外部接入 | 公共 MCP 只读；host 受限；Skill 薄。 | 生产实现 | Closed External App Pilot 已形成完整第二生命周期。 | 保留薄 adapter，移出 Pilot |
| Windows／macOS／Ubuntu archives | 三平台制品与 manifest 存在，SHA-256 全部通过；启动器检查平台、架构与 Node 24。 | 发行制品；运行门禁 | 仍需用户装 Node、命令行启动、浏览器打开；非普通 Desktop App。 | 预览可保留，但改身份或自带 runtime |
| 本地状态、无 Sestina 云账号、无 Sestina 遥测 | 项目 `.sestina`、loopback-only、`telemetry:false`、无自动同步。 | 生产实现；局部 runtime | “无 Sestina 遥测”不等于完全离线，Provider/host 是显式网络例外。 | 保留 |
| Release manifest 可追溯到 tag | `release-index.json.sourceCommit` 为 `13334a3…`，公开 `v0.2.0` target 为 `caf893…`。 | 发行证据直接冲突 | tag 不能精确复现声称的发行来源；未发现足以证明主要 runtime 行为不同的证据，但 provenance 不闭合。 | 必须修复 |

---

## 4. 按严重度排序的正式发现

本次发现一项有直接证据支持的 `P0`。它不是数据已被证明损坏，而是产品的核心“当前状态绑定—用户处置—可恢复改变”承诺在确定性路径上使用了两套状态定义。除此之外，没有发现足够证据支持第二项 `P0`；其余高影响问题按 `P1`、`P2` 排列。

### P0-01 — Review 处置没有形成完备 canonical transition，Manifest stale gate 又绑定了不完整状态

**ID 与标题：** `P0-01` Review 结果与 Context Manifest 使用两套不同的“当前状态”定义  
**严重度：** `P0`  
**证据状态：** `confirmed_defect`  
**影响表面：** Review、Authority Gate、Context Manifest、Semantic Judge、Repeated Audit、Receipt、Rollback、Search、恢复后的研究连续性  
**结论：** Sestina 的中心承诺是把一条建议绑定到当前研究状态，并在用户处置后形成可证明、可恢复的改变。生产实现却让 `accepted`／`modified_accepted` 通常只写 Receipt，而 `stateBinding` 不包含 Receipt；Provider context 又明确包含 `receiptSummary`。因此，系统既不能清楚说明“接受”改变了哪个 canonical 研究对象，也可能在 Receipt history 已变化后继续发送旧 Manifest，并把它视为未 stale。

**被违反的第一性原则：** 产生 Provider context、判断 stale、提交 Authority、恢复状态与解释结果必须共享同一份 canonical truth。Receipt 可以证明 transition，但不能在影响下一次 context 时又被排除在 state binding 之外。

**直接证据：**

- `packages/core/src/research-room.ts:338-369`：`prepare()` 把 Brief、Decision、Issue 与 `receiptSummary` 一并传入 Semantic Judge context。
- 同文件 `:413-426`：Manifest 把 `receipt_summary` 声明为已包含的 `versioned_research_state` 字段。
- 同文件 `:681-689`：`stateHash` 只包含 Brief、Decision、Issue、Episode；`stateBinding` 同样没有 Receipt revision/count/hash。
- 同文件 `:483-489`：`analyze()` 只比较该不完整 binding 判断 stale。
- 同文件 `:544-573`：除 `direction_changed` 外，其他 disposition 不改变 Brief、Decision、Issue、Evidence 或 Episode，只创建 Receipt；before／after binding 相同。
- 同文件 `:595-610`：Rollback 只有 `direction_changed` 会恢复 Brief；其他处置只是改变 Receipt 状态。

**对抗路径／失败场景：**

1. 用户准备 Review A，Manifest A 捕获 Receipt history `R0`；
2. 另一条 Review B 提交处置，新增 Receipt `R1`；
3. 因 Receipt 不在 `stateHash` 中，A 的 binding 仍与当前状态相等；
4. 用户继续 A，旧 `receiptSummary=R0` 被发送；
5. repeated-audit／history 判断基于过时上下文，却仍可成为 `semantic_ready`；
6. 用户再选择 `accepted`，系统只新增另一张 Receipt，仍没有明确的 accepted Decision 或 target diff。

**用户或产品后果：** “当前状态已绑定”的证明不成立；历史一致性和 repeated-audit 可能基于旧上下文；用户看到接受成功，却无法回答研究具体改变了什么；rollback 多数撤销的是记录而非研究内容；Receipt 与 state binding 形成两套 truth。

**成立概率与置信度：** 路径由代码确定，置信度高。无论 Receipt 被定义为 canonical 结果还是审计证明，当前实现都不自洽：若是结果，它必须进入 binding；若不是，接受必须写入真正的 canonical object。

**可能的反证或现有保护：** exact request body、Manifest hash、用户确认和 `direction_changed` 的 Brief version 都是真实保护；Receipt 也持久化、可追踪。这些保护不能消除 Receipt history 与 stale gate 的不一致。

**根因：** Kernel 缺少完整的 disposition transition table；`stateBinding` 仍沿用早期 Brief／Decision／Issue／Episode 视角，而后续 Review 又把 Receipt history 纳入 Provider context。

**具体改进：** 为每种 disposition 定义显式 canonical effect：创建／更新 Decision、Evidence、Issue、Brief，或明确 `record_only`；引入覆盖全部 outbound-relevant state 的单调 `projectStateRevision`；Manifest 绑定 revision + exact context projection hash；canonical mutation 与 Receipt 在同一事务提交；Receipt 保存 resulting object IDs 和 before／after revision。

**完整验收标准：** 每种处置提交前都显示 target、字段和 before／after；提交后 Project、Search、Attention、Resume 与 Receipt 对结果解释一致；任何进入下一次 Provider payload 的 Receipt／Memory／object 变化都使旧 Manifest fail closed；并发 Review、rollback、重启与恢复均有生产路径测试；用户能从 Receipt 导航到真正改变的对象；`record_only` 明示没有改变研究状态。

**不要采用的表面修补：** 不要只增加 toast；不要只把 Receipt count 放进 UI；不要只把一个未版本化数组长度塞进 hash；不要用文档解释两套状态真相。

### P1-01 — `semantic_ready` 被用作用户正向处置的必要许可

**ID 与标题：** `P1-01` Provider 不能写 Authority，却成为用户行使 Authority 的先决条件  
**严重度：** `P1`  
**证据状态：** `confirmed_defect`  
**影响表面：** 默认 `ledger_only`、Authority Gate、离线使用、Review、产品身份  
**结论：** Core 和 UI 都禁止用户在 `ledger_only` 下执行 `accepted`、`modified_accepted` 与 `direction_changed`。用户虽然是唯一能写 disposition 的 actor，却不是充分 Authority；Semantic Judge 是否成功成为改变研究的制度性前置条件。

**被违反的第一性原则：** 用户决定研究方向，系统负责显示证据、未知和风险。缺少模型 assessment 可以降低信息量，但不能剥夺用户记录决定的能力。

**直接证据：**

- `packages/core/src/research-room.ts:530-542`：只允许 user actor，但 `:537` 在 `ledger_only` 下只允许 `rejected`、`deferred`。
- `apps/research-room/client/src/components/product/ReviewWorkspace.tsx:167-170`：`canSemanticDisposition` 仅在 `semantic_ready` 为真。
- 同文件 Authority Gate 中，接受、修改接受与方向改变按钮使用该 gate；页面同时宣称 `Authority: user_only`。
- `README.md:112-113` 声称默认 deterministic path 无 Provider 也能工作；实际中心 Review 不能完成正向处置。

**对抗路径／失败场景：** 用户刻意不配置 Provider，或 Provider 超时／invalid JSON。Sestina 可以保存 Brief 和 suggestion，也可以拒绝或暂缓，却不能记录“我理解风险后仍采纳为 Decision”或“我决定正式改向”。用户只能离开 App 手工修改对象，或先恢复第三方 Provider。

**用户或产品后果：** 默认模式不是完整产品；用户 Authority 被错误转化为“模型先许可、用户再确认”；Provider outage 阻断研究工作；本地性和独立 App 主张被削弱。

**成立概率与置信度：** 常见默认路径，代码直接证明，置信度高。

**可能的反证或现有保护：** 拒绝和暂缓仍可记录；系统没有伪造 Provider 成功；用户可在其他对象工作区手工修改 Brief／Decision。后者恰恰说明主 Review 未闭环。

**根因：** 设计把 `semantic_ready` 当作 action safety，而没有分开“是否有 assessment”和“用户是否有权决定”。

**具体改进：** 删除 positive disposition 对 Provider 状态的硬 gate。`ledger_only` 应展示 deterministic context snapshot、缺失 assessment 和当前 unknown；用户可选择任何明确 canonical effect。对 Evidence 相关动作保留 provenance／support 要求，但不要把用户方向决定等同为事实验证。

**完整验收标准：** 全新无 Provider 项目能完成 suggestion → zero-network Manifest → user disposition → canonical effect → Receipt → restart；Provider timeout、invalid response、用户跳过四条路径均可处置；Receipt 准确记录 `assessment_unavailable`，UI 同时说明“用户决定不证明事实为真”。

**不要采用的表面修补：** 不要新增一个“强制继续”危险按钮绕过原 gate；不要用本地伪 Judge 填充 `semantic_ready`；不要把 Provider failure 改成更柔和的文案后继续禁用 action。

### P1-02 — Semantic Judge 证明协议完整性，却被呈现为语义事实

**ID 与标题：** `P1-02` 严格 decoder 被过度解释为目标替换、论证增量和理论贡献已被系统验证  
**严重度：** `P1`  
**证据状态：** `confirmed_defect`（产品表达）；真实判断准确性为 `out_of_scope`  
**影响表面：** Semantic Judge、Finding、ArgumentDelta、confidence、Inspector、Attention、Appeal  
**结论：** 生产实现认真验证 request identity、provider identity、schema、criterion completeness、IDs 与 stable text span；但这些只能证明一份 Provider assessment 与固定请求相绑定、引用位置存在。Core／UI 使用 `semantic_ready`、`validated semantic criteria`、`system_derived_from_validated_assessments`，并将 `argument-delta: substantive` 映射为 `theoretical_contribution`，把 protocol validity 实体化为更强的 semantic truth。

**被违反的第一性原则：** Schema 规定答题格式，hash 证明字节身份，span 证明字符串位置；三者都不能替代“理由是否真正支持结论”的语义判断。

**直接证据：**

- `packages/review/src/semantic/research-room-semantic-judge.ts:33-65`：定义 protocol、prompt 与九项 rubric。
- 同文件 `:600-643`：验证 verdict、missing context、span 数量、字符串位置、已知 Decision／Issue IDs。
- 同文件 `:657-690`：positive assessment 转为 Finding，并写入固定 `confidence: { source: "model", value: 0.66 }`。
- 同文件 `:693-780`：严格校验 request／provider hashes，派生 `argumentDelta` 与 `reasonableIncrement`，derivation 命名为 `system_derived_from_validated_assessments`。
- `packages/core/src/research-room.ts` 的 semantic projection 文案写入“All required semantic criteria were validated”，并把 substantive delta 投影为更强的贡献标签。

**对抗路径／失败场景：** Provider 返回完全符合 schema 的判断，引用 suggestion 中真实存在的句子，但理由误读上下文。所有确定性校验通过，系统生成 foreground Finding、`0.66` confidence 和 `semantic_ready`。用户看到的是“系统已验证”的对象，而不是“模型在这个 payload 上给出的意见”。

**用户或产品后果：** 用户可能高估模型 judgment；Appeal 变成“推翻系统 Finding”而非质疑 Provider opinion；Authority Gate 的负担被转嫁给用户，但 UI 仍给出过强确定性；后续 Search／Attention 把 assessment 作为实体对象持续放大。

**成立概率与置信度：** 产品表达与代码映射确定，置信度高；真实 Provider 是否经常错误不判断。

**可能的反证或现有保护：** 输出 provenance 标为 `model_proposed`，`canMutateAuthority=false`；unknown、alternatives、missing context 被保留；用户最终处置仍必要。这些保护不足以抵消 `semantic_ready`、Finding 和固定 confidence 的系统事实感。

**根因：** 为了让严格协议在 UI 中产生可操作结果，系统将“可安全解析的 assessment”与“可信的 semantic finding”合并成一个状态。

**具体改进：** 将状态拆成 `request_binding_valid`、`response_schema_valid`、`quoted_span_integrity_valid`、`provider_assessment_available`；主标题使用 `Provider assessment`；取消固定 `0.66`；不自动把 substantive 映射为 canonical contribution；span 只标为 quoted support location；保留 alternatives／unknowns，并显示 Provider/model identity。

**完整验收标准：** 合法但语义矛盾的 fixture 只能显示“格式有效的 Provider assessment”；任何 UI 不再声称语义已被系统验证；用户能一眼区分 protocol proof、Provider claim、Evidence 与 user Decision；Search／Attention 默认不把 assessment 当 canonical research fact。

**不要采用的表面修补：** 不要增加更多 rubric 或更复杂 JSON；不要把 `0.66` 改为另一任意数字；不要只加一个免责声明，同时继续用 `semantic_ready` 和“validated”主标题。

### P1-03 — `ledger_only` 既没有实现文档声称的本地审查，也没有独立完成核心任务

**ID 与标题：** `P1-03` 默认模式是诚实降级，但不是文档所称的 deterministic scope／evidence／repeated-audit review  
**严重度：** `P1`  
**证据状态：** `confirmed_defect`  
**影响表面：** 默认首次使用、离线价值、Architecture、README、Review output  
**结论：** Provider 不可用时，`ledger_only` 返回通用 `provider_unavailable`／`unproven` 结果和固定未知项；它没有对当前 Brief、Evidence boundary、Receipt history 或 repeated audit 做本地语义比较。文档却声称用户会得到针对 scope、evidence boundaries、repeated audit 和 object state 的 deterministic checks。

**被违反的第一性原则：** 降级路径必须准确说明保留了什么能力，不能把“状态绑定与记录仍可用”写成“本地系统完成了语义审查”。

**直接证据：**

- `packages/core/src/research-room.ts` 中 `ledgerOnlyAnalysis()` 生成通用 Provider unavailable 分析，不实现九项 criterion 的本地判断。
- `docs/ARCHITECTURE.md:20-25`：明确声称无网络即可获得 scope、evidence boundary、repeated audit 与 research-object state 检查。
- `README.md:112-113`：声称 default deterministic path works without semantic Provider。
- `ReviewWorkspace.tsx:176-179` 将无 Provider 状态作为 `ledger_only` runtime boundary 呈现；正向 disposition 同时被禁用。

**对抗路径／失败场景：** 新用户按默认设置输入明显重复的建议，系统只说 Provider 不可用和语义未证明；用户却从产品文档期待本地 repeated-audit 检查。随后用户又不能接受该建议，只能拒绝或暂缓。

**用户或产品后果：** 默认价值被高估；用户无法判断缺失的是“模型语义判断”还是“整个 Review”；产品在无 Provider 时退化为对象数据库 + 日志，而不是完整的研究审议工具。

**成立概率与置信度：** 默认配置直接触发，置信度高。

**可能的反证或现有保护：** 本地 freshness、version、hash、Authority、Manifest、Receipt 与恢复仍然是确定性的；系统没有伪造 semantic proof。问题在于产品把这些治理检查与 scope／evidence 等语义检查混称为 deterministic review。

**根因：** “deterministic review”同时指状态协议验证和研究语义判断，文档与 UI 没有建立边界。

**具体改进：** 将默认模式明确改为 `state_bound_review` 或 `no_provider_assessment`；展示本地真正可证明的内容：context revision、已有 Decision／Issue、重复对象引用、Manifest diff、target effect；删除未实现的本地语义主张。若确实实现规则检查，必须逐项定义可证伪基准，不得用关键词启发式冒充 semantic Judge。

**完整验收标准：** 文档、UI、Receipt 对无 Provider 能力描述一致；用户能看到哪些是 deterministic proof、哪些未评估；默认模式可完成完整 Authority transition；测试分别验证状态检查，不使用“semantic”名称覆盖其边界。

**不要采用的表面修补：** 不要把通用 unknown 文案写得更像分析；不要用几个关键词 regex 宣称完成目标替换检测；不要保留架构文档中的过强表述。

### P1-04 — Brief 输入不足以支撑 Judge，完整编辑器又要求用户操作内部 JSON

**ID 与标题：** `P1-04` 初始 Research Brief 过薄，高级维护又暴露 canonical IDs 与 JSON  
**严重度：** `P1`  
**证据状态：** `confirmed_defect`  
**影响表面：** 首次项目初始化、Brief、Semantic Judge context、对象工作区、认知负担  
**结论：** 首次 Brief 只要求 Research Question 和 Current Task；服务器把 fixed decisions、boundaries、non-goals 等初始化为空，却立即允许运行九项 Judge。用户若要补全结构，Candidate editor 要求逐行 canonical ID 和手写 JSON arrays。产品在“上下文不足”与“开发者级编辑”之间缺少正常研究者可用的中间层。

**被违反的第一性原则：** 系统不得用空字段制造“完整结构已存在”的假象；用户也不应为了给模型提供研究边界而编辑内部存储格式。

**直接证据：**

- `apps/research-room/client/src/screens/BriefSetup.tsx:15-36`：首启主要收集 question 与 current task。
- `apps/research-room/src/server.ts` 的 Brief 初始化路径把结构化数组设为空，expected delta 主要来自当前 task。
- `apps/research-room/client/src/components/product/ResearchObjectWorkspace.tsx:160-168`：Candidate editor 要求 `one canonical ID per line` 和多个 `JSON array` textarea。
- Semantic Judge context 依赖 fixed decisions、expected deltas、evidence boundaries、explicit non-goals；空字段会直接进入请求。

**对抗路径／失败场景：** 用户只完成两项首启输入，提交一条可能越过证据边界的建议。Judge 得到的 evidence boundary 和 non-goal 为空，仍返回九项结构化 assessment。用户试图补充边界，却遇到 JSON schema 和 IDs。

**用户或产品后果：** 模型 assessment 显得比输入条件更成熟；unknown 可能被空值掩盖；用户要么接受薄 context，要么承担高结构化维护成本；Brief 成为数据库记录而非可持续研究约束。

**成立概率与置信度：** 首次路径确定，置信度高。

**可能的反证或现有保护：** Candidate 不会自动覆盖 active Brief；激活前有 field diff、impact 与 Authority Gate。这是强保护，但没有解决录入方式和初始上下文不足。

**根因：** Domain schema 先于用户编辑体验完成；首启为降低摩擦被压缩过度，后续编辑直接复用了内部结构。

**具体改进：** 建立渐进式 Brief：question／task 后按需补 in-scope、out-of-scope、accepted decisions、evidence threshold、known unknowns、expected change；系统生成 IDs，关系用搜索选择器；JSON 只读并放在 technical view；缺失字段进入 Manifest 的 `context limitations`，Judge 必须视为 unknown。

**完整验收标准：** 用户不写 JSON／ID 可完成所有正常 Brief 操作；只填两项时 UI 明确 assessment coverage；补充边界后 Manifest diff 可见；长中文、空值、冲突关系和 stale candidate 都有明确处理。

**不要采用的表面修补：** 不要只增加字段说明；不要在首启一次性要求填写十几项；不要用 LLM 自动猜测并提升为 accepted decision。

### P1-05 — Review 在 commit 前全部是进程内临时状态，重启无法续接

**ID 与标题：** `P1-05` 项目恢复可信，正在审议的工作却不属于可恢复状态  
**严重度：** `P1`  
**证据状态：** `confirmed_defect`  
**影响表面：** prepared Manifest、in-flight Provider request、analyzed Review、Attention、重启、崩溃恢复  
**结论：** `pending`、`inFlight`、`analyzed` 与 rollback conflict 都由 Core 内存 Map 保存；只有 commit 后 Receipt 进入 SQLite。App 退出、进程崩溃或启动器重启后，用户正在审议的 suggestion、Manifest confirmation、analysis 与 Authority nonce 都丢失。恢复系统能恢复最后提交的研究状态，却不能恢复用户所处的研究决策位置。

**被违反的第一性原则：** 长周期科研连续性不仅是数据库字节正确，还包括未完成但已由用户投入认知成本的审议状态能够被安全恢复或明确标记失效。

**直接证据：**

- `packages/core/src/research-room.ts:277-280`：`#pending`、`#inFlight`、`#analyzed`、`#rollbackConflicts` 均为 `new Map()`。
- 同文件 `:466`、`:499-500`、`:524-526`：prepared、in-flight、analyzed 分别写入这些 Map。
- commit 成功后才在 `:562-576` 创建持久 Receipt 并删除 analyzed entry。
- Attention 对 pending/analyzed 的提示也从这些临时 Map 派生，重启后无法重建。

**对抗路径／失败场景：** 用户检查了 exact Manifest，等待 Provider 返回，或已阅读长 Finding 正准备处置；App 意外退出。重启后 canonical Brief 未损坏，但 Review 页面回到空白，用户必须重新粘贴建议、重选 Memory、重查 Manifest，且无法确认旧 Provider request 是否已实际完成。

**用户或产品后果：** 直接违背“跨会话保存当前问题和有效判断”的产品承诺；重复外发风险上升；用户对 Receipt／Trace 完整性的理解错误；长审议的认知成本丢失。

**成立概率与置信度：** 任何进程重启均会发生，置信度高；真实 Provider 是否已收到请求取决于退出时点。

**可能的反证或现有保护：** 未 commit 的状态不被伪装成已提交，避免半写入 Authority；Provider 请求有 request hash 与 no retry。保护正确，但“全部丢弃”不是唯一安全设计。

**根因：** 早期把 Review 当作短事务，以 nonce／Map 防重放；产品后来转向长周期 App，却没有把 Review lifecycle 纳入持久化模型。

**具体改进：** 持久化 `draft`、`manifest_confirmed`、`assessment_recorded`、`disposed/cancelled`；保存 suggestion、target hint、project revision、Manifest identity、Provider attempt identity 和失败原因；重启后不自动重发；revision 相同则续接，变化则给出 precise stale reason 和重新生成入口。

**完整验收标准：** 在每个阶段强制终止进程，重启后恢复正确 Review 或明确 stale；不存在自动重复 Provider 请求；已发送但未收到响应的 attempt 标为 uncertain，不伪造 success；取消、超时、重试与 commit 幂等。

**不要采用的表面修补：** 不要仅用浏览器 localStorage；不要把 suggestion 自动写进 Receipt；不要在重启后只显示“上次会话中断”而不恢复绑定与 payload identity。

### P1-06 — 主信息架构按对象和协议展开，Closed External App Pilot 又建立第二条产品主线

**ID 与标题：** `P1-06` Research Room 名义上是主要交互面，实际却同时暴露状态数据库、治理协议和外部宿主 Pilot  
**严重度：** `P1`  
**证据状态：** `confirmed_defect`  
**影响表面：** Start Center、Project Shell、左栏、Search、Thread、Inspector、Rooms、Pilot、产品身份  
**结论：** 主导航把 Review 与大量领域对象、Memory、Rooms、Attention、Settings 并列，Search placeholder 直接枚举 Brief、Decision、Issue、Evidence、Episode、Receipt、Appeal、Deliberation、Memory、Pilot。Closed External App Pilot 还拥有独立 UI、domain、Core 与 migration。产品因此更像治理协议与研究状态数据库的综合工作台，而不是围绕一次研究决定组织的 App。

**被违反的第一性原则：** 信息架构应先服务不可约简用户任务；内部对象完整性不能替代清晰的因果路径。外部宿主接入应薄，不应形成第二套产品真相。

**直接证据：**

- `apps/research-room/client/src/screens/ProjectShell.tsx` 的 nav registry 将多个对象／Room 作为一级入口，并提供 `Open Pilot`。
- 同文件 `:229-234`：Project search 直接覆盖 Brief、Decision、Issue、Evidence、Episode、Receipt、Appeal、Deliberation、Memory、Pilot，并按 route 进入不同 workspace。
- `docs/assets/research-room-overview.png`：截图显示三栏中同时存在对象导航、Review protocol 与 hash／Authority Inspector。
- Closed Pilot 有独立 `ExternalAppPilotWorkspace`、domain、Core、schema/migration 和 architecture 文档，不是薄按钮或单一 adapter。

**对抗路径／失败场景：** 新用户打开项目，面对 Review、十余对象与 Room；输入建议后又需理解 evidence class、Memory eligibility、Manifest、Semantic Judge、ArgumentDelta、Authority Gate、Receipt。若从外部 host 进入 Pilot，还会遇到另一套 session／continuity／import 生命周期。

**用户或产品后果：** 核心价值难以发现；用户需先学习本体；关键下一步与状态徽章竞争注意力；主 App 与外部 Pilot 相互稀释定位；复杂度被 UI 完整暴露而非由系统吸收。

**成立概率与置信度：** 生产路由和截图直接证明，置信度高；视觉疲劳程度在缺少全量渲染下为中高置信。

**可能的反证或现有保护：** Thread + Inspector 比纯对象表更接近因果旅程；左栏有当前对象、状态、Authority、Source 和 next safe action；`Quiet Instrument` 视觉方向克制。问题不是没有设计，而是设计仍服务内部协议优先。

**根因：** 产品从通用治理 Agent／CLI 转向本地 App 后，旧能力没有退场；每个新能力都获得独立对象、工作区和导航权重。

**具体改进：** 一级导航收缩为 `Today/Review`、`Project`、`Search`、`Settings`；对象进入关系化 Project／History；Appeal、Memory 在相关 Review／Brief 上下文出现；Inspector 默认关闭，普通摘要优先；Closed Pilot 从默认产品移除，所有宿主只提交 Review draft。

**完整验收标准：** 未读 README 的用户可完成核心闭环并回答“发生了什么、为什么、我能做什么、会改变什么”；主导航不直接暴露 Receipt／Room／Memory／Pilot；外部 host suggestion 与手工输入进入同一 Review lifecycle；响应式与键盘矩阵通过真实渲染。

**不要采用的表面修补：** 不要只重命名左栏；不要继续增加折叠组；不要用更多 onboarding 卡片解释十几个入口；不要把 Pilot 换一张漂亮卡片后保留第二生命周期。

### P2-01 — Appeal 与 Deliberation 的隔离是真实的，但“独立意见”与研究修正效果被高估

**ID 与标题：** `P2-01` runtime isolation 被正确实现，却没有产生与复杂度相称的 epistemic 和 canonical 增量  
**严重度：** `P2`  
**证据状态：** source effect 为 `confirmed_defect`；虚假认知独立为 `probable_risk`  
**影响表面：** Appeal、第二意见、Deliberation Room、Difference、Resolution、Provider 设置  
**结论：** 系统确实阻止相同 connection/runtime/endpoint/secret，冻结两个 blind request，限制轮次与调用数，也明确记录 `cognitiveIndependence: unproven`。但不同别名或镜像仍可能是同一基础模型；Difference 主要来自结构化文本比较；用户 Resolution 只追加 Room Receipt，不修改来源 Issue、Appeal、Decision、Brief 或 Evidence。它形成了完整仪式，却没有完成研究对象修正。

**被违反的第一性原则：** Multi-Agent 只有在产生可识别、非冗余、能进入 canonical work 的增量时才有正当性；两份输出不是独立性，也不是研究改变。

**直接证据：**

- `packages/core/src/deliberation-room.ts:423-434`：两个 canonical requests 在任一 adapter prepare 前形成，初始 blind protocol 真实。
- 同文件 `:689-706`：要求恰好两个 Provider，并校验 connection/runtime/endpoint/secret distinct。
- `apps/research-room/src/openai-compatible-provider.ts:438-452`：identity 基于 base URL、model、generation 等 hash；别名／镜像仍可能相关。
- `packages/research/src/deliberation/deliberation-room.ts` 多处明确 `cognitiveIndependence: "unproven"`。
- `DeliberationRoomWorkspace.tsx` 明示 protocol isolation 已执行、认知独立未证明；Resolution 只追加 receipt，不修改 source objects。
- `packages/core/src/correction-appeal.ts:310-322`：第二意见排除原 verdict/reason/confidence/raw response，并阻止同 connection／endpoint。

**对抗路径／失败场景：** 用户配置同一模型服务的两个不同网关或别名；系统判定 runtime distinct，生成高度相关文本；Difference 提取措辞差异；用户完成 Resolution 后，来源 Issue 仍未解决，必须另行手工修改。

**用户或产品后果：** token 与认知成本增加；用户可能把 runtime distinct 误读为独立证据；Room 完成不等于研究状态修正。

**成立概率与置信度：** source effect 确定；Provider 相关性的实际发生率不判断。置信度中高。

**可能的反证或现有保护：** 系统在身份、互盲、有限轮次和无投票上比多数多 Agent 产品诚实；manual opinion 标记 non-blind；partial／failed 不伪造结果。问题是当前产品杠杆不足，而非协议隔离虚假。

**根因：** 单条 Review 到 canonical Decision 尚未闭合时，提前实现完整二次审议制度；Resolution 为避免越权被设计成只对 Room 生效，也因此失去直接结果。

**具体改进：** 暂停 Room 默认入口；Appeal 折叠进原 Review；第二意见统一称 `runtime-distinct second opinion`；任何 correction 必须通过同一 canonical effect preview 由用户确认后写入来源对象。

**完整验收标准：** 默认主导航不能新建 Room；原 Finding 不可变；第二意见始终显示 cognitive independence 未证明；用户确认 correction 后可从同一因果链导航到 resulting object；不存在平行 Resolution truth。

**不要采用的表面修补：** 不要增加第三个 synthesis Agent；不要以不同模型名证明独立；不要用 agreement score 替代可区分证据。

### P2-02 — 发行形态与“本地交互式科研 App”身份不完全一致，发行来源也无法由公开 tag 精确复现

**ID 与标题：** `P2-02` archive + Node + browser 是诚实的 Public Preview，但不是普通 App；Release provenance 又指向 tag 之外的 commit  
**严重度：** `P2`  
**证据状态：** `confirmed_defect`  
**影响表面：** 安装、启动、停止、升级、卸载、供应链可验证性、产品身份  
**结论：** 文档诚实说明制品不是 installer，需要 Node 24 与浏览器，也无签名、公证和自动更新，因此预览边界本身不应被升级为 P0。问题是产品持续称自己为本地科研 App，而实际形态是打包的 loopback server；更重要的是，`release-index.json.sourceCommit` 为 `13334a3694c172adda2f7cfcac64088e452ef074`，公开 `v0.2.0` target 为 `caf893db7928bab91c4098eb04a7e4a8d4c62ffe`。

**被违反的第一性原则：** 产品身份必须与实际启动形态一致；公开 tag、source commit、build recipe 与制品 hash 必须闭合为同一条可复现证据链。

**直接证据：**

- `README.md:69-96`：明确为 archive、Node 24、local browser；无 installer、updater、signing、notarization、background service。
- `public-release/release-index.json:3-11`：version/tag 为 `v0.2.0`，sourceCommit 为 `13334a3…`。
- Ubuntu 制品 `RELEASE-IDENTITY.json` 自称 `local-interactive-research-app`、`primaryInterface: research-room`、Node range `>=24 <25`。
- 对 `caf893…` 与 `13334a3…` 的 diff 有大量发行、私有文档与构建相关变化；本报告未取得足够证据声称主要 runtime 行为被替换，只确认 provenance 不能由公开 tag 精确复现。
- 三平台 archive 与 manifest 的 SHA-256 校验通过，证明现有字节完整，不证明其来源链闭合。

**对抗路径／失败场景：** 审计者从公开 tag 构建，无法严格复现 release index 声称的 source commit；普通研究者下载“App”后仍需安装准确 Node major、使用终端管理进程、记住 loopback URL，并手工处理再次打开、停止与升级。

**用户或产品后果：** 发行可信度与产品身份打折；技术用户能理解，普通用户可能把预览边界误判为安装失败；公开审计无法从 tag 完成同源重建。

**成立概率与置信度：** 发行文件直接证明，置信度高。

**可能的反证或现有保护：** 文档对预览边界诚实；启动器严格校验 Node、平台和架构；loopback 与数据目录设计合理；制品 hashes 完整。问题不是隐藏限制，而是身份与 provenance 不闭合。

**根因：** Release 由公开 tag 之外 commit 构建，同时 archive-based web app 沿用了完整 Desktop App 的产品称谓。

**具体改进：** 二选一并保持一致：继续 archive preview 时正式称 `local loopback research server preview`，公开 exact source commit 和可复现 recipe；保持 Desktop App 身份时自带 runtime、lifecycle launcher、reopen/stop、平台签名或清晰预览边界。无论哪条，release 必须从公开 tag exact commit 构建，并记录 source tree hash、toolchain、build command 和 asset hashes。

**完整验收标准：** `release-index.json.sourceCommit` 与 tag target 完全一致；从公开 tag 在文档化环境中生成同源 build identity；普通用户不猜 Node major、工作目录、URL 或停止方式；升级失败可恢复；卸载不误删项目数据。

**不要采用的表面修补：** 不要只把 README 的“App”改为“Preview”；不要给 sourceCommit 加解释注释；不要把 hash 校验当作源码可复现证明。

---

## 5. 跨功能根因图

九项正式发现并非彼此独立，而是六项根因在不同页面、状态机和发行表面的重复投影：

```text
用户任务没有被压缩成单一“建议 → 判断 → 裁决 → 研究状态改变”闭环
        │
        ├─→ Review disposition 没有统一 canonical effect
        │       ├─ Receipt 被迫承担结果职责
        │       ├─ rollback 多数只能撤回记录
        │       ├─ Appeal / Room 另起 resolution truth
        │       └─ Search / Attention 看见对象，却看不见一次决定改变了什么
        │
        ├─→ Provider assessment 与用户 Authority 被耦合
        │       ├─ ledger_only 不能正向处置
        │       ├─ protocol-valid JSON 被呈现成 semantic-ready truth
        │       └─ 用户承担最终确认责任，却受模型可用性限制
        │
        ├─→ state binding 与持久化边界不是同一条真相
        │       ├─ receiptSummary 进入 payload，却不进入 stale gate
        │       ├─ pending / analyzed Review 仅在内存
        │       └─ 重启恢复 DB，却不能恢复审议位置
        │
        ├─→ 页面围绕领域对象与治理协议组织
        │       ├─ 新用户先学习术语，再完成任务
        │       ├─ Thread + Inspector 变成协议可视化
        │       └─ 多工作区争夺主导航
        │
        └─→ 核心闭环未闭合前继续扩张范围
                ├─ Memory 六态、Appeal、第二意见、Deliberation Room
                ├─ Closed External App Pilot 第二套生命周期
                └─ archive/server 形态仍使用完整 Desktop App 身份
```

### 根因 1：Authority decision 与 epistemic assessment 被错误耦合

**影响范围：** `ResearchRoomCore.commit`、`ReviewWorkspace`、`ledger_only`、Semantic Judge、Appeal、Provider 设置、Receipt。

“用户是唯一 Authority”本应意味着 Provider 只能提出候选，用户决定是否改变研究状态。当前实现却把 `semantic_ready` 作为 `accepted`、`modified_accepted` 与 `direction_changed` 的前置条件。Provider 既不能成为 Authority，又在事实上控制用户能否执行最重要的 Authority action。该耦合同时削弱默认模式、放大 Provider 格式有效性的产品地位，并把模型错误的最终责任留给用户。

### 根因 2：Review 没有统一、显式、可逆的 canonical effect

**影响范围：** Review、Decision、Evidence、Issue、Brief、Receipt、rollback、Search、Attention、Appeal、Deliberation Resolution。

`accepted` 没有说明接受为 Decision、Evidence、Issue resolution、Brief patch，还是仅记录“用户已阅并同意”。Core 为避免模型越权而只写 Receipt，但因此缺少可继续工作的研究结果；Appeal 与 Room 同样只追加自己的记录。它是回滚含义不清、对象重复和纠错流程无法落地的共同来源。

### 根因 3：Manifest binding 与持久化边界不是同一条状态真相

**影响范围：** `receiptSummary`、`stateBinding`、Context Manifest、stale gate、pending Review、重启、Trace。

Manifest 展示 exact payload 的实现很强，但其 context projection 比 stale gate 的 semantic hash 更宽。Receipt 变化可以改变请求内容，却不一定让旧 Manifest stale；pending／analyzed Review 又只存在进程内。于是“精确请求”“当前项目状态”“可恢复 Review 生命周期”没有形成一个原子版本边界。

### 根因 4：Provider protocol validity 被实体化为产品级 semantic truth

**影响范围：** Semantic Judge、Finding、ArgumentDelta、rubric、confidence、Inspector、Attention、Appeal。

生产实现严格校验 JSON、IDs、hashes 与字符串 span；这些保护值得保留。但严格校验只能证明某个模型在固定 payload 上给出一份格式合规的 assessment，不能证明目标替换、重复审计、论证增量或理论贡献判断成立。`semantic_ready`、Finding 与固定 confidence 把受约束意见提升为看似由系统验证的事实。

### 根因 5：Domain Model 与 UI 以对象完整性替代任务清晰度

**影响范围：** Start Center、Project Shell、Review Thread、Inspector、对象工作区、Search、Attention、Settings、Rooms。

Project、Brief、Decision、Issue、Evidence、Episode、Receipt、Finding、Appeal、Room、Memory、Manifest、ArgumentDelta 各有设计理由，但用户不需要同时理解它们才能判断一条建议。当前一级导航直接暴露领域模型；中央 Thread 混合 suggestion、Manifest、Provider Finding、Authority Gate 与 Receipt；右栏长期承担协议、hash、payload 和 Memory。`Quiet Instrument` 降低了视觉噪声，没有降低概念数量。

### 根因 6：主要闭环未闭合前，范围与发行身份继续扩张

**影响范围：** Deliberation Room、Closed External App Pilot、MCP／Skill／Hooks、Memory lifecycle、Release archive、安装／升级／卸载。

项目已实现多个技术含量较高的子系统，但这些子系统没有共同强化一个最小结果。Closed Pilot 引入第二套 host/session/continuity/receipt；Deliberation 引入两 Provider、blind round、Difference 与 Resolution；Memory 引入六态；发行又采用 Node + browser archive。每项局部都可解释，合在一起却使产品更像治理协议平台。

---

## 6. 整体 UI／UX 对抗审查

### 6.1 整体身份判断

**当前 UI 最准确的分类是：治理协议可视化 + 研究状态数据库界面；它已经超过普通开发者后台，但尚不是成熟、直接的科研工作产品。**

现有截图支持 `Quiet Instrument` 的表面方向：低饱和、三栏、细粒度状态、少装饰，视觉上没有明显营销 landing page 感。源码也包含 focus 样式、响应式断点、High Contrast、reduced motion、Inspector overlay 与部分 focus trap。然而，主界面仍把内部协议当作天然工作单位：左栏是对象与 Room，中央 Thread 是 Review protocol 的逐阶段投影，右栏是 Manifest／hash／Authority／Memory Inspector。

界面能帮助熟悉 Sestina 本体的人审计系统，却不能让第一次进入的研究者自然回答：

1. 现在发生了什么？
2. 为什么需要我处理？
3. 我有哪些实际选择？
4. 选择之后，研究状态具体改变什么？

这不是字体、颜色或圆角不足，而是因果层级不足。当前 UI 让“系统如何治理自己”比“用户如何推进研究”更可见。

### 6.2 十六条生产旅程

| 生产路径 | 证据等级 | 已成立的部分 | 主要断点或负担 |
|---|---|---|---|
| 1. 首次启动与语言选择 | `source_inferred`；loopback 壳层局部确认 | 可切换中文／English；语言持久化；无云账号前置。 | archive 要求终端、Node 24、browser；无 Node 24 首启完整渲染。产品价值仍需说明文案解释。 |
| 2. 选择／初始化项目 | `source_inferred` | 不扫描磁盘；picker 可选；不可用时手工路径；初始化前显示创建内容。 | 手工绝对路径负担高；“选择目录”与“初始化 Sestina 状态”的结果差异不够直观。 |
| 3. 查看 Brief 与当前问题 | `source_inferred` | Active Brief 有版本与 binding。 | 首次只收集 question/task；关键边界默认空；高级编辑要求 JSON/IDs。 |
| 4. 导入或输入 AI 建议 | `screenshot_supported` + `source_inferred` | Review 是当前主入口；可粘贴或导入文本。 | 输入前不选择建议准备改变什么，后续 generic `accepted` 无 target effect。 |
| 5. 查看并确认 Context Manifest | `screenshot_supported` + `source_inferred` | 可见 endpoint、protocol/prompt/rubric hash、bytes、exact body；发送前再校验。 | 核心价值藏在技术 Inspector；难区分字节一致与语义正确；Receipt 变化不触发 stale。 |
| 6. Provider 可用与不可用 | `source_inferred` | 可配置 OpenAI-compatible Provider；失败时 fail closed 到 `ledger_only`。 | `ledger_only` 给通用说明，并禁用接受／修改／改向；默认模式不闭环。 |
| 7. Finding、ArgumentDelta、替代解释、unknowns | `screenshot_supported` + `source_inferred` | 能并列展示 verdict、criteria、spans、alternatives、unknowns。 | `semantic_ready` 与 canonical-looking Finding 容易被误认系统事实；九项 rubric 密度高。 |
| 8. 接受、拒绝、修改、暂缓、申诉、改向 | `source_inferred` | 有 Authority Gate；只有用户 action 可 commit；拒绝／暂缓在 ledger_only 可用。 | positive dispositions 受 Provider gate；多数接受只写 Receipt；修改后接受无结构化 target diff。 |
| 9. Receipt／Trace | `screenshot_supported` + `source_inferred` | 记录 command、version、binding、Manifest、Provider 元数据与结果；失败不写成成功。 | Receipt 同时承担证明与结果；数量上升后成为日志仓；binding 不覆盖其 outbound 影响。 |
| 10. 重启恢复 | `source_inferred` | committed SQLite、Brief binding、managed recovery 有实现；future schema fail closed。 | pending／analyzed Review 在内存，重启不能恢复正在审议的因果位置。 |
| 11. Search／Attention | `source_inferred` | 能跨对象检索并汇聚 stale／failed／needs-attention。 | 所有对象和 protocol state 混合；更容易找到记录，而非找到下一研究动作；大规模视觉未验证。 |
| 12. Appeal／第二意见 | `source_inferred` | 原 Finding 保留；第二意见隔离原输出；相同 connection/endpoint 被阻止。 | 多一条 state machine；runtime distinct ≠ cognitive independent；结果需手工转成对象改变。 |
| 13. Deliberation Room | `source_inferred` | 初始互盲、有限轮次、无投票无赢家；partial／failed 保留。 | 默认导航暴露高成本仪式；Resolution 只写 receipt，不修正来源对象。 |
| 14. Resume／Memory | `source_inferred` | `never_send` 默认、显式 Manifest 才可分享、forgotten 排除；历史副本边界诚实。 | 六态对普通用户过细；形成第二套知识库；未证明节省大于维护成本。 |
| 15. Settings、Provider、隐私 | `source_inferred` | loopback HTTP 限制、外部 HTTPS、Provider identity、无 Sestina telemetry、local-only 可见。 | 配置语言偏实现；“无遥测”不等于第三方 Provider 不外发，应在 action 时说明。 |
| 16. 备份、恢复、升级、卸载 | `source_inferred`；hash 校验为发行证据 | managed backup、integrity、Brief binding、pre-restore、too_new／too_old／migration_failed。 | 无完整 Node 24 UI 旅程；archive 的启动、停止、再次打开、升级、卸载依赖文档和文件操作。 |

### 6.3 主要页面与信息架构

#### Start Center

**证据：`source_inferred`。**

优点是不会自动扫描磁盘，也不把最近路径悄然上传；picker 不可用时有手工路径回退，初始化前显示将创建的本地文件。问题是它主要回答“怎样打开项目”，没有在用户作出目录决定前回答“打开后能完成什么独特任务”。对 archive 用户还叠加终端启动、Node major、browser URL 三层概念。

Start Center 不需要更多抽象品牌文案，而需要一条真实 demo-shaped path：选择示例或空项目后，立即看到“当前问题—待审建议—决定后会改变的对象”。

#### Project Shell 与左栏

**证据：`screenshot_supported` + `source_inferred`。**

左栏同时承载 Review、Brief、Decision、Issue、Evidence、Episode、Receipt、Memory、Rooms、Search／Attention、Settings 与 Pilot。它在对象覆盖上完整，在任务优先级上失焦。问题不是对象数量本身，而是近似平级的导航权重。

一级导航应收缩为 `Today／Review`、`Project`、`Search`、`Settings`。Decision、Evidence、Issue、Receipt、Memory 进入 `Project` 下的关系视图；Appeal 与 second opinion 只在对应 Review 中出现；Room 不应默认展示。

#### 中央 Thread

**证据：`screenshot_supported` + `source_inferred`。**

Thread 按因果顺序显示 suggestion、Manifest、analysis、Authority Gate、Receipt，这一方向比对象表格更接近用户任务。失败在于它仍用协议阶段作为卡片主标题，并让 Provider Finding 与用户 Decision 处于相近视觉语义中。用户输入、Provider assessment、deterministic proof、Authority outcome 与 canonical state 必须有不同视觉语法。

最关键的缺失是 action effect preview。Authority Gate 应先显示：

```text
将此建议采纳为：Decision
将创建：D-014
将关联：Research Brief v7、Evidence E-022
不会改变：Current Question
```

而不是只显示 `Accept`、`Modified accept` 等抽象 disposition。

#### 右侧 Inspector

**证据：`screenshot_supported` + `source_inferred`。**

Inspector 承担了 exact Manifest 这一最独特价值，也承载 protocol hash、bytes、endpoint、state binding、Memory eligibility 与 Authority。较窄宽度下转 overlay 是正确方向；正常宽度持续占位则让协议细节与研究内容竞争。

Inspector 应是按需验证面。默认只显示：`将外发给谁`、`包含哪些研究内容`、`为什么当前版本仍有效`。Exact body、hash、bytes、generation 与 rubric version 放在 `Technical proof` 展开区。

#### 对象工作区、Search 与 Attention

**证据：`source_inferred`。**

对象工作区适合作为审计与修复入口，不适合作为普通工作入口。高级 Brief 编辑要求 JSON 与 IDs，显示开发者工作台遗留。Search 能跨对象查找，但把内部记录数量转化为用户分类工作。Attention 应只收集有明确 action 和 consequence 的项，如 Manifest stale、恢复包不匹配、Issue 阻塞 task，而非泛化 badge 集合。

#### Appeal、Deliberation 与 Memory

**证据：`source_inferred`。**

三类页面状态完整，却共同放大产品仪式感：用户先审查建议，再申诉 Finding，再请求第二意见，再开 Room，再 Resolution，最后仍回原对象手工修正。Memory 又要求管理候选、激活、过期、退役与忘记。

Appeal 应折叠为 Review 内“标记 assessment 有问题／请求另一份 assessment”；Memory 应在 Brief、Review 和 Manifest 上下文中显示“为何召回、是否外发、如何停用”；Deliberation 暂停默认入口。

#### Recovery

**证据：`source_inferred`。**

Recovery 是少数同时满足技术可信和直接结果明确的工作区：验证 DB integrity、项目身份、Brief binding 与 schema compatibility；恢复前保留当前副本；失败不包装成成功。需要补足的是普通语言结果：先告诉用户会恢复到哪个研究状态、会丢失哪些之后改变、当前副本如何保留，再显示 schema 与 hash。

### 6.4 状态因果与视觉语义

| 状态类型 | 应表达的含义 | 当前混淆风险 | 建议规则 |
|---|---|---|---|
| 用户输入／候选 | 尚未成为研究状态 | 与 Finding、Decision 同处 Thread，可能被误认已进入项目 | 使用 `Candidate` 语义，不使用 success/authoritative badge |
| Provider assessment | 模型在固定 payload 上的意见 | `semantic_ready`、Finding、confidence 看似系统事实 | 明示 Provider/model/time/`assessment only`；protocol validity 单列 |
| deterministic proof | request/version/hash/write 是否一致 | 易与语义正确混同 | 只用于“请求一致”“写入成功”等可证事实 |
| user Authority outcome | 用户决定研究如何继续 | positive action 被 Provider gate；effect 不清 | action 前显示 target diff；完成后显示 object/revision |
| canonical research state | 下次恢复时有效的状态 | Receipt 数量可能被误认为状态改变 | 首页以 question、decisions、blocking issues、next task 为主 |

所有成功状态必须回答“成功写入了什么”；所有 stale 必须回答“由哪项变化导致、需重做哪一步”；所有失败必须保留原输入并提供可执行收缩路径。单纯显示 `failed`、`partial`、`semantic_ready` 或 `ledger_only` 不足以完成因果反馈。

### 6.5 响应式、可访问性与长时间使用

**已有源码保护：** `app.css` 包含 `:focus-visible`、High Contrast、reduced motion 和多个断点；约 `80rem` 以下 Inspector 转 overlay；`ContextInspector` 有焦点约束；多个状态含文本而非只靠颜色。

这些只是 `source_inferred` 优点，不能证明下列条件可操作：

- 1100px + 200% 文本；
- 1440px 下超长中文 Brief、Finding、Provider error；
- High Contrast 下 badge 与 disabled state 区分；
- 仅键盘完成 Manifest、发送、处置、申诉与恢复；
- Inspector overlay 的焦点返回、背景 inert、Escape 与 accessible name；
- 数百 Attention、1000 对象、长 Evidence／Receipt；
- English／中文长度差异；
- 长时间三栏高密度使用的视觉疲劳。

这些均为 `unverified_visual_hypothesis`，不得用 CSS、DOM 测试或单张截图宣告通过。

### 6.6 仍需的无私人数据视觉证据

1. Start Center：picker 可用／不可用、手工路径、初始化确认、路径错误；
2. Review：无 Provider 的 `ledger_only`、可用与禁用 action、明确失败恢复；
3. `semantic_ready` 下超长 Finding、alternatives、unknowns 与长 Provider error；
4. 1100px + 200% 文本，Inspector 打开／关闭，完整键盘焦点序列；
5. Light／Dark／High Contrast 下长中文、disabled、stale、failed、success、provider unavailable；
6. 1000 对象、数百 Attention 和长 Search results；
7. Recovery：`too_new`、`migration_failed`、DB 损坏、Brief binding mismatch、成功恢复；
8. Appeal／second opinion／Room：缺第二 Provider、相同 identity 被阻止、partial、cancelled、Resolution 不改 source object。

---

## 7. 经受住攻击的部分

以下优点均有生产实现支撑，并直接保护产品结果；它们不是因为文件、测试或文档数量而成立。

### 7.1 Exact Context Manifest 是真实、不可被普通提示词稳定替代的保证

`openai-compatible-provider.ts` 先生成 canonical request preview，Manifest 保存 exact body／bytes／hash；发送前重新读取 Provider generation 并校验 preview 与 prepared request 完全一致；固定 body，redirect 为错误且不自动 retry。`ContextInspector` 可展示 endpoint、protocol／prompt／rubric hash 与 exact request body。

**证据状态：`survived_adversarial_review`。**

它经受住“摘要不等于 payload”“Provider 配置可能在确认后变化”的攻击。保留条件是修复 Receipt/state revision 缺口，并将字节一致与语义正确分开。

### 7.2 Provider、host 与 Agent 不能直接写 Authority

生产路径要求 user actor 才能 commit disposition；Provider adapter 只返回 assessment；MCP／Skill／host 是只读或候选式，不能自行提升为 Decision。导入文本与 Provider 返回没有直接文件／工具能力。

**证据状态：`survived_adversarial_review`。**

这应继续作为 Kernel 核心。要修复的是 `semantic_ready` 对用户 action 的反向 gate，不是取消 user-only mutation。

### 7.3 Loopback、本地 HTTP 与 Provider endpoint 边界具有实质保护

`server.ts` 绑定 `127.0.0.1`，校验 Host，写请求需要随机 session token，设置 CSP、COOP、no-referrer、nosniff 与 frame denial；静态路径有 containment。Provider 设置要求外部 HTTPS，只允许 loopback HTTP，拒绝私有字面地址与 metadata host。

**证据状态：`survived_adversarial_review`。**

本次未发现研究文本直接越过 Authority 或调用工具的路径。DNS rebinding、Origin／CSRF 与本机其他进程仍需回归，但设计并非“本地即安全”。

### 7.4 Recovery 恢复的是受验证的研究状态，不只是数据库字节

备份使用 SQLite native backup、integrity check 与 hash sidecar；恢复验证 DB、project identity、schema compatibility 与 Brief binding，并在恢复前保留当前副本。UI 区分 `too_new`、`too_old`、`migration_failed`。

**证据状态：`survived_adversarial_review`。**

这比复制 sqlite 文件更强，直接服务长周期连续性。仍需 Node 24 下完整 UI 验证，但生产设计成立。

### 7.5 Project Working Memory 的外发与 forget 边界总体诚实

Memory 默认 `never_send`；只有 active 且 `explicit_manifest_only`、version/hash/policy/sensitivity 有效才进入 Manifest；forgotten 排除 recall 和 eligibility。UI 说明旧 Provider receipt、手工导出、旧备份可能保留副本，不承诺全球删除。

**证据状态：`survived_adversarial_review`。**

值得保留的是边界，不是六个用户可见 lifecycle status。

### 7.6 Deliberation 的初始互盲与有限执行不是伪装

两个初始 canonical requests 在任一 Provider prepare 前生成；系统要求 distinct runtime identities，限制参与者、轮次和调用数，没有投票、赢家或自动 synthesis，并将 `cognitiveIndependence` 标为 `unproven`。

**证据状态：`survived_adversarial_review`（仅限 protocol isolation）。**

它不证明多 Agent 应成为主产品，也不证明认知独立；可保留实验实现，暂不占主导航。

### 7.7 Schema、migration 与未来版本采用 fail-closed

发行身份记录 schema／migration version；打开与恢复能区分 too-new、too-old、migration failure；future schema 不会被未知旧代码静默解释。

**证据状态：`survived_adversarial_review`。**

应继续作为基础设施存在，但普通用户旅程不应暴露大量 schema 术语。

---

## 8. 单一、完整、按因果优先级排列的改进清单

以下十项不是十个平行功能，也不是多个版本计划。它们按依赖关系排列：前四项重建唯一状态真相，第五至第八项把产品表面收缩到该真相，第九项删除旁路，第十项使发行身份与产品承诺一致。

### 8.1 重定义 Review 的 canonical outcome，取消无目标的 generic `accepted`

**改进结果：** 每次用户处置都明确产生“无状态改变”或“对某个 canonical object 的原子改变”；Receipt 只证明结果，不再代替结果。

**它闭合的根因：** Review 缺少统一 canonical effect；Receipt、rollback、Appeal、Room 形成多套完成真相。

**涉及的产品对象／页面／代码边界：** `ResearchRoomCore.commit`、Review DTO、Decision／Evidence／Issue／Brief repositories、Receipt、rollback、`ReviewWorkspace`、Search／Attention projection。

**完整范围：**

- 将 `accepted`／`modified_accepted` 改为用户可理解的 effect：
  - `record_only`：只记录审阅，不改变研究；
  - `create_decision`：创建或更新 Decision；
  - `add_evidence`：创建 Evidence 并记录 provenance；
  - `create_or_resolve_issue`：创建或解决 Issue；
  - `patch_brief`：修改 task、boundary、unknown 或 question；
  - `formal_direction_change`：新 question 生效并 supersede 旧 question。
- action 前显示 before／after preview、target IDs、关系以及不会改变的对象；
- canonical mutation 与 Receipt 同事务提交；
- Receipt 保存 resulting object IDs、before/after revision、effect summary；
- rollback 有类型化定义；不能安全逆转时创建 compensating transition，不删除历史。

**明确非目标：** 不让 Provider 自动选择 effect；不把所有 suggestion 强制变成 Decision；不新增一级可见 `Proposal` 对象。

**验收方式：** 每种 effect 有生产 contract test；用户提交前能准确复述改变内容；提交后首页、Search、Attention、Receipt 显示同一 object/revision；重启、恢复和 rollback 后关系一致；不存在“UI 显示 accepted，但除 Receipt 外无结果”的路径。

**如果不做的后果：** 其他 UI、Memory、Appeal 与 multi-agent 改进都会继续围绕语义不完整的处置动作堆叠。

### 8.2 把用户 Authority 与 Provider assessment 完全解耦

**改进结果：** 无论 Provider 未配置、失败或被用户质疑，用户都能记录研究决定；同时 UI 不把决定包装成事实真伪证明。

**它闭合的根因：** `semantic_ready` 成为 Authority 前置；默认模式不闭环。

**涉及的产品对象／页面／代码边界：** commit guard、`ReviewWorkspace.canSemanticDisposition`、`ledger_only`、Authority Gate、Receipt、Provider status copy。

**完整范围：**

- 删除 positive disposition 对 `semantic_ready` 的硬 gate；
- 无 Provider 时展示 deterministic context diff、已有 Decisions/Issues/Evidence、可能受影响对象与缺失 assessment；
- 用户可选择任一 canonical effect，但页面明确 `No provider assessment was available`；
- Provider 只影响参考信息，不影响 action capability；
- 方向决定旁显示“该决定不证明事实为真”；
- Evidence effect 要求 provenance 与 support status，避免 Authority 把候选直接变成 verified evidence。

**明确非目标：** 不本地伪造 Semantic Judge；不降低 Evidence 要求；不允许外部 Agent 写 Authority。

**验收方式：** 全新无 Provider 项目能完成 suggestion → zero-network Manifest → effect → Receipt → restart；Provider timeout、invalid JSON、用户跳过 assessment 均可完成相同 action，并在 Receipt 中准确记录 assessment availability。

**如果不做的后果：** Sestina 仍无法在默认状态作为独立 App 完成中心任务。

### 8.3 建立单一 `projectStateRevision`，让 Manifest、stale gate、Receipt 与恢复共享版本边界

**改进结果：** 任何会改变实际外发 context 或 canonical 研究状态的提交都推进同一单调 revision；payload 已变化时旧 Manifest 不可能继续有效。

**它闭合的根因：** Context projection 比 state binding 更宽；Receipt、Memory eligibility 等可在 stale gate 之外变化。

**涉及的产品对象／页面／代码边界：** state binding builder、Manifest builder、Receipt/Memory projections、repositories、Provider prepare/send、Trace、migration。

**完整范围：**

- 定义 `projectStateRevision` 为所有 canonical transaction 的单调序列；
- Manifest 保存 revision、`contextProjectionHash` 与 exact request hash；
- context projection 所有输入从同一 transaction snapshot 读取；
- 凡进入 payload 的 Brief、Decision、Issue、Evidence、Receipt、Memory、Episode 变化均推进 revision；
- send 前校验 revision、projection hash、Provider generation、exact request hash；
- stale reason 精确指出哪一对象／revision 变化；
- 旧项目 migration 生成明确 baseline，不静默重算历史语义。

**明确非目标：** 不把无关 UI 偏好纳入研究 revision；不以单一 hash 取代对象版本和 transaction log。

**验收方式：** 逐项变更所有 outbound-relevant state；会改变请求字节者旧 Manifest 必须 fail closed；不改变请求的 UI 偏好不得 stale；并发写入不能形成 mixed-version payload。

**如果不做的后果：** Exact Manifest 这一最强独特价值会继续被确定性 stale 漏洞削弱。

### 8.4 持久化 Review lifecycle，并分层表达 protocol validity 与 semantic claim

**改进结果：** 崩溃或重启后恢复到同一 suggestion 的同一审查阶段；系统只声称真正验证过的内容。

**它闭合的根因：** pending／analyzed Review 只在内存；valid JSON／span 被实体化为 `semantic_ready`。

**涉及的产品对象／页面／代码边界：** Review Maps、schema/migration、Semantic Judge decoder、Finding／ArgumentDelta projection、Inspector、Attention、Receipt。

**完整范围：**

- 持久化 `draft`、`manifest_confirmed`、`assessment_recorded`、`disposed/cancelled`；
- 保存 suggestion、target hint、revision、Manifest identity、assessment identity、失败原因；
- 重启时 revision 未变则续接，已变则显示 precise stale reason；
- 将 `semantic_ready` 拆为：`request_binding_valid`、`response_schema_valid`、`quoted_span_integrity_valid`、`provider_assessment_available`；
- 主标题改为 `Provider assessment`；
- 删除固定 `0.66`；
- 不把 `substantive` 自动映射成 `theoretical_contribution`；
- ArgumentDelta 明示由 Provider 提出的结构化比较。

**明确非目标：** 不声称更多 schema/rubric 会得到模型准确率；不保存隐藏思维链；不在重启后自动重发 Provider。

**验收方式：** 每阶段强制退出并恢复；合法但自相矛盾的 fixture 只能显示“格式有效的 Provider assessment”；span 存在但不支持结论时，不把 span integrity 表达为 evidence support。

**如果不做的后果：** 用户仍会把成功解析误认成语义确认，崩溃仍丢失审议上下文。

### 8.5 将 Research Brief 重构为渐进式研究约束面

**改进结果：** 用户不理解 schema/IDs 也能提供足够边界；缺失信息被标为 unknown，而不是以空结构支撑成熟 Finding。

**它闭合的根因：** Brief 初始信息过薄，高级维护过度开发者化。

**涉及的产品对象／页面／代码边界：** `BriefSetup`、Brief workspace、schema、relationship picker、Review preflight、migration。

**完整范围：**

- 首次只要求 question/task，但明确 assessment coverage 限制；
- Review 前渐进补充 in scope、out of scope、accepted decisions、evidence threshold、known unknowns、expected change；
- IDs 由系统生成，关系通过搜索选择器；
- JSON 默认只读，编辑使用 typed form；
- 长 Brief 支持 section collapse、diff、history；
- 缺失字段进入 Manifest 的 `context limitations`，Provider 必须反映为 unknown。

**明确非目标：** 不用十页 onboarding 强迫一次填满；不以字段数量替代研究质量；不自动猜测并提升为 accepted decision。

**验收方式：** 用户全流程不手写 JSON/ID；只填两项时 coverage 清楚；补充边界后 Manifest diff 可见；长中文、空字段、冲突关系有明确错误与恢复。

**如果不做的后果：** Judge 会继续对稀薄 context 输出过度结构化结论，用户也继续在简单首启与内部编辑器间跳跃。

### 8.6 以用户旅程重建主信息架构

**改进结果：** 进入项目后先看当前问题、待审建议、阻塞项与下一步；内部对象仍可审计，但不再争夺一级导航。

**它闭合的根因：** object-first IA、Thread + Inspector 协议化、术语与注意力负担。

**涉及的产品对象／页面／代码边界：** `ProjectShell`、navigation registry、Review Thread、Inspector、Project overview、Search、Attention、workspaces、responsive CSS。

**完整范围：**

- 一级导航收缩为 `Today/Review`、`Project`、`Search`、`Settings`；
- `Today` 显示 current question/task、pending Review、blocking Issue、recent canonical changes；
- `Project` 关系化展示 Decisions/Evidence/Issues/History，Receipt/Trace 进入 History；
- Appeal、second opinion、Memory 只在相关对象上下文出现；
- Inspector 默认关闭，普通摘要优先，technical proof 按需展开；
- user input、Provider assessment、deterministic proof、Authority outcome、canonical state 使用不同视觉语法；
- action 后显示 resulting object/revision；
- 建立 1100/1280/1440/1920、200% 文本、三主题、键盘、长中文、长错误、1000 对象的真实渲染矩阵。

**明确非目标：** 不用更多卡片和分组保留全部一级入口；不把视觉重设计与领域重构分离；不以营销 hero 替代 project state。

**验收方式：** 未读 README 的操作者能完成核心闭环，并准确回答发生了什么、为什么、能做什么、会改变什么；一级导航不直接暴露 Room/Receipt/Memory；全部视觉矩阵无不可达 action、焦点丢失、裁切或颜色唯一表达。

**如果不做的后果：** 即使 Kernel 修复，产品仍会被感知为数据库后台或治理协议工作台。

### 8.7 将 Appeal 与第二意见折叠进同一 correction transition，暂停 Deliberation 默认产品面

**改进结果：** 用户质疑 assessment 后，在原 Review 保留记录、取得 runtime-distinct second opinion，并把纠正应用到同一 canonical target；不再产生第二套 Resolution truth。

**它闭合的根因：** Appeal/Room 仪式多、source effect 弱、runtime independence 被误读为 cognitive independence。

**涉及的产品对象／页面／代码边界：** Appeal core、second-opinion adapter、Room routes/nav、Resolution、Review history、canonical effect transaction。

**完整范围：**

- 原 assessment 不可变，Appeal 作为 correction record 嵌入 Review history；
- second opinion 始终称 `runtime-distinct second opinion`，显示 identity 与 `cognitive independence unproven`；
- correction 必须选择 8.1 的 canonical effect，并重新走 Authority preview；
- Room 从默认导航、onboarding、普通项目状态中移除；
- 现有 Room 数据保持可读、可导出、可恢复；
- 不增加第三个 synthesis Agent、agreement score 或自动赢家。

**明确非目标：** 不删除历史 Room 数据；不否认互盲 protocol 的技术价值；不把 multi-agent 默认标成更可靠。

**验收方式：** 从错误 assessment 发起 Appeal、取得或跳过 second opinion、确认 correction 后，原 Finding、Appeal、Receipt、resulting object 位于同一因果链；默认不能新建 Room；任何 Resolution 不得绕过统一 transition。

**如果不做的后果：** 用户会完成越来越复杂的纠错流程，却仍需手工修改真正对象。

### 8.8 保留 Memory 安全边界，压缩用户可见生命周期与入口

**改进结果：** Memory 直接回答“记住什么、为何召回、是否外发、怎样停用”，而不是让用户管理六态知识库。

**它闭合的根因：** Memory 形成第二套待维护对象，其状态成本可能高于减少的重复解释成本。

**涉及的产品对象／页面／代码边界：** `project-memory.ts`、Memory workspace、Recall projection、Manifest eligibility、Search、Receipt/Trace、forget、backup notice。

**完整范围：**

- 内部可保留精细状态，默认 UI 压缩为 `Suggested`、`In use`、`Not in use`、`Forgotten`；stale/expired/retired 是原因而非同级 action；
- 每次 recall 显示来源、触发规则、最后确认 revision 与“未自动外发”；
- 进入 Manifest 必须逐项可见并显式选择；
- forget 前列出当前 DB、search index、managed backups、Provider receipts/外部副本的可控和不可控范围；
- Memory 不作为一级导航，改为 Brief/Review contextual drawer 与 Project history。

**明确非目标：** 不把 Memory 自动提升为 Evidence；不承诺删除 Provider 或旧导出；不采用隐式“AI 觉得相关就外发”。

**验收方式：** 用户不学习六个 status 也能理解 Memory 为何出现、是否进入 payload、如何停用与忘记；forgotten 不能从 current store、search、recall、新 Manifest 恢复；历史副本限制始终可见。

**如果不做的后果：** Memory 会继续成为产品本体之外的知识管理系统。

### 8.9 删除 Closed External App Pilot 的默认生命周期，把宿主接入统一为薄候选入口

**改进结果：** Codex／MCP／Skill／Hooks 只把 suggestion、context reference 或诊断送入同一 Review queue；Research Room 不再拥有第二套 session/continuity/pilot truth。

**它闭合的根因：** 旧通用 Agent／外部宿主路线回流，稀释 Research Room 主产品。

**涉及的产品对象／页面／代码边界：** `Open Pilot`、pilot domain/core/migration、MCP/Skill/Hooks adapters、host capabilities、docs。

**完整范围：**

- 从默认导航、普通 Settings、onboarding 移除 Closed Pilot；
- 外部宿主只提交 suggestion、source host identity、optional file references、requested target；
- Core 保存为 `Review draft`，不自动建立第二 session、Authority 或 memory；
- adapter 默认 read-only、最小 capability、忽略不可信 host instruction；
- 诊断／恢复命令保留 CLI/MCP，但业务 transition 只在 Kernel；
- 历史 Pilot 数据只读迁移到 Review history，保留 provenance。

**明确非目标：** 不取消所有集成；不把 App 变成必须复制粘贴的孤岛；不让外部 host 获得写 Authority 的便利。

**验收方式：** 来自 Codex、Skill、MCP、手工粘贴的同一 suggestion 进入相同 Review lifecycle、Manifest、Authority、Receipt；主 App 不存在独立 Pilot state machine；业务规则测试只针对 Kernel 一份实现。

**如果不做的后果：** 项目会继续同时维护“主要 App”与“外部 Agent 连续性产品”，身份无法收口。

### 8.10 统一发行身份、公开 provenance 与完整本地生命周期

**改进结果：** 用户下载的东西、产品声称的形态、公开 tag、构建来源、启动／停止／升级／卸载成为同一条可验证链。

**它闭合的根因：** archive server 与 Desktop App 身份不一致；release index 指向 tag 之外 commit；恢复能力与安装生命周期分离。

**涉及的产品对象／页面／代码边界：** Release workflow、`release-index.json`、`RELEASE-IDENTITY.json`、`start.mjs`、build recipe、platform launcher、Settings/Recovery、Security docs。

**完整范围：**

- 二选一并坚持：若称 Desktop App，内置支持 runtime 与 lifecycle launcher；若继续 archive，准确称 `local loopback research server preview`；
- 发布由公开 tag exact commit 构建，sourceCommit 与 tag target 一致；
- manifest 记录 source tree hash、toolchain/lockfile、build command、schema/migration identity、asset hashes；
- 提供可复现 build 验证；
- upgrade 前受管备份，失败可恢复；
- uninstall 区分程序、settings、Provider secret、project data，不默认删除研究数据；
- 回归 Host/Origin/session token、loopback、path containment、symlink/junction、Provider redirect 与 DNS resolution；
- 三平台验收启动、停止、再次打开、升级、卸载、恢复和错误文案。

**明确非目标：** 不把 code signing 当成核心闭环修复；不以 SHA-256 替代 source provenance；不因 Public Preview 隐藏依赖。

**验收方式：** 从公开 tag 在文档化工具链产生同源 identity；三平台用户按单一路径完成生命周期；升级中断可恢复绑定正确的研究状态；数据保留策略在 action 前可见。

**如果不做的后果：** 即使内部重构完成，用户仍会把启动与升级摩擦误认成 App 不可靠，公开审计也无法闭合源码到制品。

---

## 9. 停止做什么

| Stop Doing | 为什么必须停止 | 替代原则 |
|---|---|---|
| 停止把 schema-valid、hash-valid、span-present 称为 semantic validation | 制造“系统已确认研究结论”的虚假完成感 | 只声明 request/protocol/span integrity；结论始终是 Provider assessment |
| 停止在 `ledger_only` 禁止用户接受、修改或改向 | 让 Provider 事实上控制 Authority | 用户决定永远可用；Provider 只增加参考信息 |
| 停止新增没有 canonical effect 的 disposition、Receipt、Resolution、Room state | 完成流程不等于改变研究 | 每个 action 指向 target、before/after 或明确 `record_only` |
| 停止把 Receipt 同时当审计证明、研究结果和恢复真相 | 日志数量替代研究状态 | canonical objects 是结果，Receipt 是证明 |
| 停止扩张 Deliberation 参与者、轮次、synthesis、agreement score | 当前两 Agent 已未证明直接增量 | 先证明 correction 能进入统一 transition |
| 停止把 Appeal、Memory、Room、Receipt、Pilot 都做成一级入口 | 领域模型支配用户任务 | 一级导航围绕 Today/Review/Project/Search/Settings |
| 停止让用户手写 JSON、IDs 或理解 migration/schema 才能正常工作 | 属于开发者工作台遗留 | typed form、关系选择器、普通语言错误、按需 technical proof |
| 停止用 fixture、mock、测试数量、截图成功、hash、schema 覆盖替代产品成立 | 只能证明各自合同 | 以真实 transition、失败、恢复、完整 UI 旅程验收 |
| 停止扩张 Closed External App Pilot 独立生命周期 | 形成第二套 continuity/correction truth | 所有 host 只提交候选，统一进入 Review |
| 停止把 archive + Node + browser 默认称普通 Desktop App | 身份不一致制造安装误判 | 内置 runtime 的 App，或准确命名的 server preview |
| 停止重新引入“通用治理 Agent／可替换 Kernel 插件”路线 | Authority、Manifest、persistence、recovery 必须唯一 | 外部集成保持薄；Kernel 服务明确 research transition |
| 停止用低饱和卡片、badge、折叠组掩盖对象关系 | 视觉克制不能替代因果层级 | 每页先回答状态、下一 action、resulting change |

---

## 附录 A. 发布后独立分支 `codex/agent-corrector`

> **分支**：`codex/agent-corrector`  
> **commit**：`74c62c5f4ab22cc8267a4edc74cfaa34b078a3a8`  
> **归属说明**：该分支属于发布后独立成果，以下能力**不计入** `v0.2.0`，也不反向列为发行版缺陷。

### A.1 是否构成低摩擦、真实有用的轻量入口

**是，但它提供的是同一 Agent、同一会话中的窄幅任务纠偏，不是 Research Room 的轻量完整形态。**

`integrations/skills/agent-corrector/SKILL.md` 将流程压缩为从用户任务提取 ephemeral task anchor，检测 material deviation，执行 `correct → resume`；它不要求 MCP、Provider、数据库、网络、遥测或持久记忆，也明确不是独立 watchdog。`docs/integrations/AGENT-CORRECTOR.md` 将其定义为 lightweight standalone same-agent correction。对模型开始重复审计、换目标、解释流程或扩张输出的即时问题，它比先建立 Sestina project/Brief/Manifest/Review 低摩擦得多。

**证据状态：`survived_adversarial_review`（作为窄 Skill）。**

### A.2 是否形成第二套纠偏真相

**一旦被品牌化为 Sestina 的同等产品面，就会形成第二套纠偏真相。**

Skill 的 task anchor、material transition 与检查项存在于 prompt protocol 中，没有 Kernel 的 versioned Brief、Manifest、Authority、Receipt、state binding、recovery。它可以说“已纠正并继续”，却不能证明研究状态改变了哪个 canonical object。因此适合作为 ephemeral behavior control，不适合作为第二权威纠偏内核。

**证据状态：`probable_risk`。**

### A.3 是否削弱“Research Room 是主要产品”

**存在明显定位压力。**

Agent Corrector 最易理解的价值——发现偏离后拉回并继续——不需要安装 App、建立项目或配置 Provider。若把它直接宣传为 Sestina 主能力，用户会合理追问为何需要 Research Room 的对象、状态与恢复系统。这迫使主产品把独特增量明确收口为**跨会话、跨宿主、可恢复的 canonical research-state transition**，而非一般 prompt correction。

**证据状态：`probable_risk`。**

### A.4 显式调用评测是否被错误解释为隐式触发能力

**当前材料没有作出这种错误解释，反而明确限制了结论。**

`integrations/skills/evals/agent-corrector/README.md` 说明 invocation accuracy 只是 advisory，显式调用 corpus 不能证明 implicit discovery；测试也将 `implicitDiscovery` 标为未测量。因此不能把显式 `@skill` 或 harness 成功调用解释成自然任务中会自动发现并触发。

**证据状态：`survived_adversarial_review`。**

### A.5 最合适的产品位置

**裁决：作为独立 companion Skill／试用入口／宿主集成层保留，不进入主产品 Authority，也不进入 Research Room 默认导航。**

边界应为：

1. 输出只是一条 ephemeral correction candidate，不写 canonical state；
2. 需持久化的纠偏结果显式送入 Research Room Review queue，由统一 Manifest／Authority／Receipt transition 处理；
3. 文档持续区分显式调用、宿主可能的自动发现与真正的隐式触发证据。

---

## 10. 最终优先裁决

### 1. 最应该保留的三项东西

1. **Exact Context Manifest 与发送前再绑定**：让用户看到实际外发 payload，并绑定 Provider generation、request bytes 与当前状态，是普通聊天／Markdown 难以稳定复制的核心增量。
2. **本地 versioned canonical state + user-only Authority**：Brief、Decision、Issue、Evidence 等必须由统一 Kernel 管理，外部 Agent／Provider 只能提出候选。
3. **受验证的备份、恢复与 future-schema fail-closed**：恢复继续校验数据库完整性、项目身份与 Brief binding，而不是只恢复文件字节。

### 2. 最应该改变的三项根因

1. **Authority 与 Provider assessment 的耦合**：用户决定不能依赖 `semantic_ready`，Provider 结果也不能呈现为系统事实。
2. **Review disposition 无 canonical effect、state binding 又不完整**：每个处置必须明确改变什么，并与 Manifest、Receipt、rollback、restart 共用单一 revision。
3. **object-first、protocol-first 的产品组织方式**：主界面围绕“建议 → 理解 → 裁决 → 状态改变 → 恢复”组织，内部对象退居审计与历史。

### 3. 最应该删除或暂停的一项东西

**暂停 Deliberation Room 作为默认主产品功能。** 保留历史数据与互盲 protocol 实现，但移出主导航和普通旅程；在单条 Review、Appeal、canonical correction 尚未闭合前，多 Agent 会商主要产生额外仪式，而非不可替代研究结果。

### 4. 如果只能完成一项改进

**完成“统一、可持久化、Provider-independent 的 Review-to-canonical-state transition”。**

它必须同时做到：用户无 Provider 也能处置；每个 disposition 提交前显示 target effect；提交时原子写入 canonical object、Receipt 与单一 `projectStateRevision`；旧 Manifest 对任何 outbound-relevant change fail closed；重启后恢复同一 Review 因果位置。它具有最大产品杠杆，因为一次性修复 Authority、默认模式、Receipt 含义、rollback、Manifest stale、Appeal source effect、Search／Attention 结果和 UI 因果反馈，并把 Sestina 与“聊天 + Markdown 日志”的真正差异直接交付给用户。
