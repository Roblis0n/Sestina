# Sestina Research Room 0.2.0 public preview

Sestina is a local, interactive research app. Research Room is the main
interface; the Research Deliberation Kernel is the authority for project state,
decisions, issues, evidence, corrections, manifests, and recovery. The user is
always the only research authority.

Sestina 是本地交互式科研 App。Research Room 是主要界面，Research
Deliberation Kernel 负责项目状态、决定、问题、证据、纠偏、Manifest 与恢复；
用户始终是唯一研究裁决者。

## Supported downloads / 支持的下载

Only these three public-preview artifacts are supported:

- Windows x64: `sestina-research-room-0.2.0-windows-x64.zip`
- macOS arm64 (Apple silicon): `sestina-research-room-0.2.0-macos-arm64.tar.gz`
- Ubuntu x64: `sestina-research-room-0.2.0-ubuntu-x64.tar.gz`

All require Node.js 24.x and a local browser. There is no installer, updater,
background service, npm publication, signing, or notarization in 0.2.0. Do not
use an artifact on a different operating system or architecture.

三个制品均要求 Node.js 24.x 与本地浏览器。0.2.0 没有安装器、自动更新、
后台服务、npm 发布、代码签名或公证；不要跨操作系统或架构使用制品。

## Safe start / 安全启动

1. Download the matching artifact and `SHA256SUMS` from the same GitHub Release.
2. Verify the artifact SHA-256 before extraction.
3. Extract into a new empty directory. Enter the single
   `sestina-research-room-0.2.0-*` directory.
4. Run `node start.mjs --version --json`; confirm version `0.2.0`, channel
   `public_preview`, and the expected platform.
5. Run `node start.mjs`, then open only the printed `http://127.0.0.1:...` URL.
   If port 43148 is occupied, run `node start.mjs --port 0`.

下载制品与同一 Release 中的 `SHA256SUMS`，先校验 SHA-256，再解压到新的空
目录。进入唯一的制品根目录后先运行版本检查，再启动；只打开程序打印的
`127.0.0.1` 地址。

The first session asks for Chinese or English and then asks the user to select
or initialize a local project. Project data is stored in that project's
`.sestina` directory. Deleting the extracted app directory does not delete
project data. The default mode is offline `ledger_only`; Provider use is
blocked until the user separately configures one and explicitly confirms an
exact Context Manifest.

首次启动会选择中文或 English，再选择或初始化本地研究项目。项目数据位于该
项目的 `.sestina` 目录。删除解压后的程序目录不会删除项目数据。默认模式是
离线 `ledger_only`；未单独配置 Provider 并确认精确 Context Manifest 前不会
外发研究内容。

Read the platform guide, [recovery guide](RECOVERY-AND-UPGRADE.md), and
[security boundaries](SECURITY.md). Release identity and hashes prove artifact
integrity, not research correctness, Provider quality, adoption, or market value.

请继续阅读对应平台指南、恢复指南和安全边界。制品身份与 hash 只能证明制品
完整性，不能证明研究结论、Provider 质量、外部采用或市场价值。
