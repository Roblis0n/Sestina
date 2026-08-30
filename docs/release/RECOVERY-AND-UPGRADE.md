# Backup, restore, continuity, and upgrade / 备份、恢复、连续性与升级

Open **Backup & recovery / 备份与恢复** from Research Room.

## Backup / 备份

**Create backup** writes a verified managed bundle under the selected project's
local `.sestina` recovery area. It includes the SQLite authority state and exact
Research Brief binding. No network request is made. The UI reports integrity,
schema version, runtime version, Manifest hash, and verification status.

“创建备份”会在项目本地 `.sestina` 恢复区生成经过验证的托管备份，包含 SQLite
权威状态与精确 Research Brief 绑定，不访问网络；界面会显示完整性、schema、
运行时版本、Manifest hash 与验证状态。

## Restore / 恢复

Preview is read-only. Restore requires the exact managed backup, a second
explicit checkbox, and a short-lived session-bound confirmation. Sestina first
preserves the current healthy state (or a forensic copy when damaged), then
replaces and verifies database and Brief atomically. Expired, replayed,
cross-session, cross-backup, or state-drifted confirmations are rejected.

恢复预览只读。正式恢复必须选择精确托管备份、再次勾选确认，并使用短期且与
会话绑定的确认。Sestina 会先保留当前健康状态（损坏时保留取证副本），再原子
替换并验证数据库与 Brief。过期、重放、跨会话、跨备份或状态漂移确认均拒绝。

## 0.2 continuity / 0.2 连续性

The public `0.2.0` runtime opens projects created by the private
`0.2.0-rc.1` release when their schema is within 16–20. Before a supported
upgrade, Sestina creates and verifies one complete pre-upgrade backup and runs
the ordered migration journal. A successful upgrade reopens only after schema
and canonical-state verification.

公开版 `0.2.0` 可打开私有 `0.2.0-rc.1` 创建且 schema 位于 16–20 的项目。
支持的升级会先创建并校验完整升级前备份，再按顺序运行迁移；只有 schema 与
canonical state 验证成功才重新打开。

If a migration fails, Sestina records the failed version, enters
`recovery_required`, and does not retry automatically—not even after restart.
Use the verified pre-upgrade backup or an explicitly chosen recovery action.

迁移失败时记录失败版本，进入 `recovery_required`，且不会自动重试，重启也不
例外。应使用已验证的升级前备份或明确选择恢复动作。

Schema versions above 20 are refused before writable open and remain unchanged.
Downgrade is unsupported. / 高于 20 的未来 schema 在写入前拒绝并保持不变；
不支持降级。

Removing and re-extracting the runtime does not remove project state. Always
verify the replacement artifact SHA-256 before opening an existing project.

删除并重新解压运行时不会删除项目状态；打开既有项目之前必须先校验新制品。
