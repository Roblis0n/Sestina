<div align="center">
  <img src="../../apps/research-room/client/public/sestina-logo.png" width="120" height="120" alt="Sestina Logo">
  <h1>Sestina</h1>
  <p><strong>让长期 AI 辅助研究保持聚焦、可核查，并始终由你裁决。</strong></p>

[English](../../README.md) · **简体中文** · [日本語](README.ja.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md)
</div>

---

Sestina 是一个本地交互式科研 App，服务于那些无法在一次聊天中完成的研究。
它把当前问题、Research Brief、决定、问题、证据、纠偏、来源和下一安全行动
放在同一个连续工作空间里。模型可以提出建议，但只有用户可以接受、拒绝、
解决、豁免或改变研究方向。

## 它解决什么问题

长期使用 AI 做研究时，失败往往不是明显报错，而是研究问题悄悄漂移、已经
完成的审计被反复重做、建议被误当成决定、证据边界丢失，或流畅文字掩盖了
论证跳跃。Sestina 把这些风险变成可见的研究对象、明确的状态和可追溯操作。

- **持续显示真实研究问题**：活动研究线与版本化 Research Brief 不会被新对话
  自动替换。
- **建议与决定分离**：所有影响研究权威的操作都必须经过用户直接确认，并产生
  追加式 Receipt。
- **准确知道外发内容**：可选 Provider 调用前，先显示精确 Context Manifest，
  包括包含/排除字段、目的、限制、hash 与运行身份。
- **允许申诉和独立复核**：可以对 AI 评估提出 Correction Appeal，并单独配置
  second-opinion Provider。
- **看清真正分歧**：受限的双参与者盲会商只比较结构化立场与证据，不投票、
  不选赢家，也不自动替用户综合裁决。
- **安全恢复连续性**：项目级受治理记忆、备份、恢复、迁移与失败收缩均保留
  来源和权限边界。

## 不可改变的产品边界

Research Deliberation Kernel 是唯一业务本体；Research Room 是主要交互面。
CLI、Skill、MCP 和宿主适配器只负责接入、自动化、诊断和恢复，不能复制业务
规则或扩大权限。公开 MCP 只有两个只读工具和一个只读 Resource。

用户始终是唯一研究裁决者。Provider 输出、Agent 建议、模型一致意见、签名、
hash、工具成功或测试通过都不能替用户修改 Research Brief、Decision、Issue、
Review、Appeal 或 Deliberation Room。证据不足时必须保持 unknown 或 unproven。

项目状态默认只保存在所选项目的 `.sestina` 目录。Sestina 没有必需的云账号、
后台同步、遥测、崩溃上传、自动内容日志或后台模型请求。只有在用户主动配置
Provider、检查精确 Manifest 并确认该次请求后，绑定的内容才可能外发。

## 当前本地桌面与已发布版本

当前源码默认启动 schema 25 的 Electron Research Room。`pnpm start` 打开桌面，
`pnpm build` 构建桌面，`pnpm package win32` 生成本地安装器。Today / Review、
Project、Search 和 Settings 共用同一个 Kernel。旧 Room/Pilot 执行和 generic
写入已退出正常公开接口及桌面包；旧历史仍可阅读、导出和明确转换为 Draft。
CLI 的 `context` 与 `doctor` 为只读操作，不创建项目、不替用户作研究决定。

这是尚未公开发布的本地候选。已发布的 v0.2.0/schema 20 及历史压缩包保持原样；
本页旧能力示例和下方公开预览安装步骤仍描述该历史版本。当前桌面使用方法见
[桌面说明](../../apps/desktop/README.md)，真实验证范围见
[合并证据索引](../product/restructure/G1-G3-EVIDENCE.md)。其他平台实机、签名、
生产更新信任和完整原生可访问性验收尚未完成。

## 安装 0.2.0 公开预览版

0.2.0 是压缩包分发，不是原生安装器；需要 **Node.js 24.x** 和本地浏览器。

1. 打开 [`v0.2.0` Release](https://github.com/Roblis0n/Sestina/releases/tag/v0.2.0)。
2. 下载 `SHA256SUMS` 和唯一匹配系统的制品：
   - Windows x64：`sestina-research-room-0.2.0-windows-x64.zip`
   - macOS arm64：`sestina-research-room-0.2.0-macos-arm64.tar.gz`
   - Ubuntu x64：`sestina-research-room-0.2.0-ubuntu-x64.tar.gz`
3. 先校验 SHA-256，再解压到新的空目录。
4. 进入解压后的 Sestina 目录并运行：

```text
node start.mjs --version --json
node start.mjs
```

只打开程序打印的 `http://127.0.0.1:...` 地址。详细步骤见
[Windows](../release/INSTALL-WINDOWS.md)、[macOS](../release/INSTALL-MACOS.md)
和 [Ubuntu](../release/INSTALL-LINUX.md) 指南。

## 从源码构建

```text
git clone https://github.com/Roblis0n/Sestina.git
cd Sestina
corepack enable
pnpm install --frozen-lockfile
pnpm verify:public
pnpm start
```

当前桌面的本地 Draft 与用户确认流程无需 Provider。请先阅读
[隐私说明](../../PRIVACY.md)、[安全策略](../../SECURITY.md)、
[产品定义](../product/CURRENT-PRODUCT-DEFINITION.md)和
[文档索引](../README.md)。

## 当前限制

0.2.0 不包含安装器、自动更新、代码签名、公证、后台服务、npm 发布、云同步或
公开可写 MCP。发布验证只能证明实现行为与制品完整性，不能证明 Provider 语义
质量、研究结论正确、外部采用或市场价值。

项目采用 [Apache License 2.0](../../LICENSE)。名称和官方 Logo 的商标边界见
[TRADEMARKS.md](../../TRADEMARKS.md)。参与贡献前请阅读
[CONTRIBUTING.md](../../CONTRIBUTING.md)，并且只使用合成数据。

## 内部桌面候选

当前源码包含 G10 Electron 候选，承接 schema25 的四入口研究界面。它尚未公开发行，不改变已发布的 v0.2.0 预览。开发运行与本地候选构建见[桌面入口](../../apps/desktop/README.md)，实际完成范围见[实施状态](../product/restructure/IMPLEMENTATION-STATUS.md)。三平台安装与生产签名验收尚未完成。

起始页提供备份与恢复、显式旧设置迁移；设置中可以调整应用外观、使用系统加密存储或明确选择仅本次会话保存密钥、获取当前安装的只读 MCP 与配套 Skills 配置，以及手动检查更新。当前没有配置可信更新源，检查会直接说明这一点，不会发送研究内容。
