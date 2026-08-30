# Sestina Research Room 0.2.0 — public preview

Release channel: `public_preview`
Tag: `v0.2.0`
License: Apache-2.0

## What this release delivers / 本次交付

- A local, bilingual Research Room centered on the current research question,
  structured objects, status, provenance, user-only authority, and the next safe
  action.
- Decision, Issue, Evidence, Episode, Receipt, correction/appeal, bounded blind
  deliberation, Context Manifest, governed project memory, backup, restore, and
  migration-recovery workflows.
- The C **Quiet Instrument** production interface across Chinese/English,
  light/dark themes, long content, desktop viewports, and 200% zoom.
- Deterministic platform archives with embedded release identity, manifest, and
  SHA-256 checksums for Windows x64, macOS arm64, and Ubuntu x64.
- Offline-first behavior and platform-native current-user secret storage.
- A participant-owned, privacy-minimized public-preview evidence kit. No
  telemetry or automatic evidence upload is introduced.

- 本地双语 Research Room，围绕当前研究问题、结构化对象、状态、来源、
  `user_only` 权威与下一安全行动工作。
- 决定、问题、证据、Episode、Receipt、纠偏/申诉、受限盲会商、Context
  Manifest、受治理项目记忆、备份、恢复与迁移失败恢复闭环。
- C **Quiet Instrument** 生产界面，覆盖中英文、明暗主题、长内容、桌面断点与
  200% 缩放。
- Windows x64、macOS arm64、Ubuntu x64 的确定性制品、内嵌身份、Manifest 与
  SHA-256。
- 离线优先与系统原生当前用户密钥存储。
- 参与者持有、隐私最小化的公开预览证据 Kit，不新增遥测或自动上传。

## Important limits / 重要限制

Node.js 24.x is required. This is an archive-based public preview, not a native
desktop installer. It is not signed or notarized and has no updater. npm,
Desktop, tray, daemon, native companion, cloud accounts/sync, telemetry, and
public write-capable MCP are not part of this release.

需要 Node.js 24.x。本版是压缩包公开预览，不是原生桌面安装器；无签名、公证或
更新器。npm、Desktop、托盘、守护进程、原生 companion、云账号/同步、遥测与
公开可写 MCP 均不在本次范围。

Real external-user value, repeat-use value, Provider semantic quality, and
market value remain unproven until independently observed. Release integrity or
test success does not substitute for those facts.

真实外部用户价值、重复使用价值、Provider 语义质量与市场价值仍未证明；发布
完整性或测试通过不能替代这些事实。

## Upgrade / 升级

Projects from `0.2.0-rc.1` are supported when their schema is within 16–20.
Back up first. Failed migration never retries automatically; future schema is
refused without mutation. See `RECOVERY-AND-UPGRADE.md` in the artifact.

schema 16–20 的 `0.2.0-rc.1` 项目可升级。请先备份；迁移失败不自动重试，未来
schema 会在不修改项目的前提下拒绝。详见制品内恢复指南。
