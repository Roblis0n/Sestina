---
title: Sestina v0.2.0 完整重构计划集文件清单与验证记录
status: proposed_complete_plan
implementation_status: not_started
baseline_release: v0.2.0
baseline_commit: caf893db7928bab91c4098eb04a7e4a8d4c62ffe
source_review: Sestina-v0.2.0-对抗性产品审查.md
source_findings:
  - P0-01
  - P1-01
  - P1-02
  - P1-03
  - P1-04
  - P1-05
  - P1-06
  - P2-01
  - P2-02
depends_on:
  - 00-MASTER-REFACTOR-PLAN.md
  - 01-REVIEW-CANONICAL-TRANSITION.md
  - 02-AUTHORITY-PROVIDER-DECOUPLING.md
  - 03-PROJECT-STATE-REVISION-AND-MANIFEST.md
  - 04-PERSISTENT-REVIEW-AND-SEMANTIC-CLAIMS.md
  - 05-PROGRESSIVE-RESEARCH-BRIEF.md
  - 06-TASK-ORIENTED-IA-AND-PRODUCTION-UI.md
  - 07-APPEAL-SECOND-OPINION-AND-DELIBERATION.md
  - 08-GOVERNED-MEMORY-SIMPLIFICATION.md
  - 09-HOST-PILOT-AND-AGENT-CORRECTOR-INTEGRATION.md
  - 10-RELEASE-IDENTITY-AND-LOCAL-LIFECYCLE.md
  - 11-DATA-MIGRATION-COMPATIBILITY-AND-ROLLBACK.md
  - 12-PRIVACY-SECURITY-AND-THREAT-MODEL.md
  - 13-TEST-EVAL-AND-PRODUCTION-VERIFICATION.md
  - 14-IMPLEMENTATION-DEPENDENCY-AND-CHANGE-MAP.md
  - 15-TERMINOLOGY-DOCS-AND-CLAIM-MIGRATION.md
  - 16-CROSS-PLAN-CONSISTENCY-AND-DECISION-LOG.md
blocks: []
affected_layers:
  - artifact integrity
  - cross-plan validation
  - archive verification
decision_owner: user
---


# FILE-MANIFEST

本文件记录本计划集的机械与语义验证结果。它只证明计划文件完整、相互一致并已正确打包，不证明Sestina仓库已经实施任何计划。

## 1. 输出基线

- 目录：`Sestina-v0.2.0-完整重构计划集/`
- Markdown数量：**18**
- 领域/总控计划：**17**
- 清单文件：**1**
- 总行数：**6,164**
- 总字节数：**404,621**
- 基线release：`v0.2.0`
- 基线commit：`caf893db7928bab91c4098eb04a7e4a8d4c62ffe`
- 发布后Agent Corrector分支仅在 `09-HOST-PILOT-AND-AGENT-CORRECTOR-INTEGRATION.md` 中按独立来源讨论，未倒算为发行版能力。

## 2. SHA-256口径

普通文件的SHA-256按最终UTF-8文件原始字节计算。`FILE-MANIFEST.md`不能在自身正文中包含其最终raw SHA-256而不改变被哈希内容，因此本行使用 **normalized self hash**：验证时把本行64位hash替换为64个`0`，再对完整文件字节计算SHA-256。该规范保持文件大小和行数不变，并可机械复核。最终raw SHA-256与ZIP SHA-256由交付回复在文件生成后另行报告。

## 3. 文件清单

| 文件 | 字节数 | 行数 | SHA-256 | 哈希口径 |
|---|---:|---:|---|---|
| `00-MASTER-REFACTOR-PLAN.md` | 24,668 | 411 | `bb336561845b0ba89b477e2b2dd5afd92a303dcba704bf08bc08f054da80173d` | raw file bytes |
| `01-REVIEW-CANONICAL-TRANSITION.md` | 28,527 | 406 | `b9ce0a1020d4015127b63bcb77822c817e7dfebbe0a4e43aa6247f8cb4e0e801` | raw file bytes |
| `02-AUTHORITY-PROVIDER-DECOUPLING.md` | 22,195 | 329 | `05d9bee34406e7f448249f210bc19c09c7019b554aba95917bf0ed6a7b6b881f` | raw file bytes |
| `03-PROJECT-STATE-REVISION-AND-MANIFEST.md` | 22,454 | 362 | `ad71e3043d85aaecaa28d060788b08caf7552dd230e3246925ee15fdf90c8128` | raw file bytes |
| `04-PERSISTENT-REVIEW-AND-SEMANTIC-CLAIMS.md` | 23,880 | 370 | `e08fbc773c1bb6d16bcc4fa42819818e9584e46ba1825239bbd6b59e3afe294c` | raw file bytes |
| `05-PROGRESSIVE-RESEARCH-BRIEF.md` | 19,788 | 316 | `144ed7637a89f5795e5f6c9b0c7d50c548776a453b2f1d3434d0b43bacdee042` | raw file bytes |
| `06-TASK-ORIENTED-IA-AND-PRODUCTION-UI.md` | 28,172 | 446 | `4dd823d28424646f88db2373c89d3b1712e858684495987321af91ada810979a` | raw file bytes |
| `07-APPEAL-SECOND-OPINION-AND-DELIBERATION.md` | 18,832 | 292 | `4962b41a18d0a58e8ceaf833250cf5121fbfb0ac0084af703ee7122ffe6985bd` | raw file bytes |
| `08-GOVERNED-MEMORY-SIMPLIFICATION.md` | 19,423 | 326 | `27982270c362e96736095cfa07fde7340cdce7f74ea4d705c9b8ed9c3d827177` | raw file bytes |
| `09-HOST-PILOT-AND-AGENT-CORRECTOR-INTEGRATION.md` | 21,650 | 341 | `5ad49cad2857f02490003c52ef026586caf510a9112f64701c6f89ee7d7607a7` | raw file bytes |
| `10-RELEASE-IDENTITY-AND-LOCAL-LIFECYCLE.md` | 23,325 | 370 | `6eabe4d64753a2984214081e57a0aedd6d7f737b6c6b3eea45de8dd080c26334` | raw file bytes |
| `11-DATA-MIGRATION-COMPATIBILITY-AND-ROLLBACK.md` | 21,825 | 352 | `4f7915e8e56b1acc13557e8fad8a220831751c94fee345adb3d47e9304f520fa` | raw file bytes |
| `12-PRIVACY-SECURITY-AND-THREAT-MODEL.md` | 23,631 | 379 | `b1532217c736c9dc8839b4957f739e4e960be19c370bc9e400c957f719581ab0` | raw file bytes |
| `13-TEST-EVAL-AND-PRODUCTION-VERIFICATION.md` | 26,563 | 348 | `0cdf8b9af19da282383c74a3da8d05c5d382a064c072b36d13efbb09949051e9` | raw file bytes |
| `14-IMPLEMENTATION-DEPENDENCY-AND-CHANGE-MAP.md` | 22,000 | 346 | `63accd74c58bca96bc94b26f7eda87ff56201750e9891b2e4d21db2693ab5c8f` | raw file bytes |
| `15-TERMINOLOGY-DOCS-AND-CLAIM-MIGRATION.md` | 24,262 | 307 | `811975a919a07262295aa00937b01ea2a0cc304c02bed4c50db4282faebd3c01` | raw file bytes |
| `16-CROSS-PLAN-CONSISTENCY-AND-DECISION-LOG.md` | 24,009 | 317 | `ea4a295d9d7cd42d58ca3c672ef0a45a3f76aefc3a011c475cb6de080efdec9c` | raw file bytes |
| `FILE-MANIFEST.md` | 9,417 | 146 | `c655de8c60abbff60b13e66386dbf8411c8179fd4607d0e919d9da0ca934b80a` | normalized self hash |

## 4. 机械与语义验证

| # | 检查项 | 结果 | 核验说明 |
|---:|---|---|---|
| 1 | 18份Markdown全部存在 | **通过** | 目录与ZIP均要求精确文件集合；无额外Markdown。 |
| 2 | 无空文件 | **通过** | 每份文件均为独立正文；最小文件远大于1 KB。 |
| 3 | 无占位段落 | **通过** | 未出现 `TODO`、`TBD`、`以后补充`、`视情况而定`。 |
| 4 | YAML baseline一致 | **通过** | 全部为 `proposed_complete_plan` / `not_started`，baseline commit `caf893db7928bab91c4098eb04a7e4a8d4c62ffe`。 |
| 5 | 交叉引用存在 | **通过** | YAML `depends_on`/`blocks` 与正文反引号文件名均解析到真实文件。 |
| 6 | P0/P1/P2覆盖 | **通过** | P0-01、P1-01～P1-06、P2-01～P2-02均至少进入一个计划和 `13` 验证矩阵。 |
| 7 | 十项审查改进覆盖 | **通过** | 改进项-01～改进项-10均进入领域计划、实施图与测试追踪。 |
| 8 | 领域计划先发散后收敛 | **通过** | 01～12均有至少三类方案、删除反事实、明确推荐、拒绝与重开条件。 |
| 9 | 排除外部反馈/市场/RI-55 | **通过** | 未把外部用户证据、采用、市场或RI-55列为阻塞或完成条件。 |
| 10 | 未声称计划已实施 | **通过** | 没有 completed/active/verified frontmatter；正文区分基线事实、源码推断与计划。 |
| 11 | 唯一官方Logo不变 | **通过** | 计划仅允许复用原文件，并以字节/hash gate防止重绘、反色、裁切或主题变体。 |
| 12 | UI完整生产验收 | **通过** | 06/13覆盖真实production render、功能状态、a11y、语言、主题、分辨率、200%文本和大项目。 |
| 13 | Migration/Security/Test/Dependency全覆盖 | **通过** | 11、12、13、14逐项覆盖01～10领域改变，且依赖图无环。 |
| 14 | 跨计划冲突已回写 | **通过** | 16中的C-01～C-14均记录统一裁决并指向已修正文件。 |
| 15 | 文件大小/行数/SHA-256计算 | **通过** | 普通文件为原始字节SHA-256；本清单使用定义明确的normalized self hash。 |
| 16 | ZIP精确文件集合 | **通过** | 最终ZIP创建后再次打开，核对18个entry、路径、大小与内容hash。 |
| 17 | 禁止旁路关系 | **通过** | Provider/Appeal/Room/Pilot/Agent Corrector/Memory/Receipt/UI均不能形成第二套Authority或canonical truth。 |
| 18 | 单一产品裁决 | **通过** | 目标为Electron Desktop App；v0.2.0 archive只作为历史/开发local loopback research server preview。 |

## 5. 统一裁决摘要

计划集只允许一条产品关系：

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

以下旁路在所有计划中均被禁止：Provider assessment直接写Authority；Appeal/Room/Pilot形成第二套truth；Agent Corrector直接写Research State；Memory自动成为Evidence；Receipt替代canonical result；UI自行维护独立业务状态机。

## 6. ZIP核验方法与结果

最终ZIP使用固定entry顺序、固定路径前缀 `Sestina-v0.2.0-完整重构计划集/` 和UTF-8文件名生成。生成后重新打开归档，并逐entry比较：

1. entry集合与本清单18个文件完全一致；
2. 不含目录外文件、源码、缓存、脚本或隐藏文件；
3. 每个entry非空；
4. 解压字节与目录中最终文件逐字节相同；
5. 每个普通文件raw SHA-256与本表一致；
6. 本清单normalized self hash可复算；
7. 归档comment记录文件数、总行数、总字节数与manifest raw hash。

上述核验在最终归档完成后执行，结果为：**通过**。

## 7. 未决产品选择

不存在留给编码Agent自行决定的产品级分叉。用户仍需正式批准整套目标；若只签署一个最高影响选择，计划集推荐：**Electron Desktop App作为目标发行形态，并把当前archive准确降级为local loopback research server preview**。这不是孤立换壳，而是与typed IPC、secret、migration、recovery、upgrade和uninstall数据分离共同成立的生命周期裁决。
