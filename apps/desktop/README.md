# Sestina internal desktop candidate

This Electron candidate uses the schema-25 Research Room and shared application
service. It is not a public release. The published v0.2.0/schema-20 preview remains
unchanged. G10/G11 acceptance is tracked in the
[current evidence](../../docs/product/restructure/G1-G3-EVIDENCE.md#g12-entry-prerequisites-2026-09-13).

## Use the candidate / 使用候选

Choose a project folder, then open or create a project. A Provider is optional:
save a Review draft, inspect changes and confirm a research decision locally.
Only saved drafts and results return after restart. Closing or suspending the
application revokes project and Host sessions; no uncertain request is resent.

选择项目文件夹，再打开或创建项目。没有模型服务也可以保存草稿、查看修改、
保存研究决定。重启恢复的是已经保存的内容。安装器、模型和宿主不替用户裁决。

| Location | Action and result |
| --- | --- |
| Start page → Backup & recovery | Close the project, create/check a schema-25 backup, open its directory, preview/confirm restore, recover an interrupted swap and reopen. |
| Start page → Earlier settings | Inspect the supported earlier application directory, migrate Provider configuration/credentials and language, or paste/export preferences. Source copies are retained; browser databases are never scanned. |
| Settings → Recovery & data | Close the project with the unsaved-input guard and return to maintenance. |
| Settings → Integrations → Read-only MCP and companion Skills | Copy installation-specific MCP JSON/TOML or open bundled companion Skills. The dedicated Node runtime needs no development checkout. Generating configuration does not establish a host connection. |
| Settings → About | Explicit update check, download, cancel, verify, install and previous-program recovery. No trusted source/root is configured in this build, so the available result is “source unavailable.” |
| Settings → Appearance | Application-level language, themes, reduced motion and transparency preferences. |

旧设置迁移在宿主内读取密钥，写入桌面加密存储后实际读回验证。配置 generation
会更新，旧外发清单不会恢复有效。原副本保留；密钥失败时已迁移配置仍保留，
可以重新输入密钥。无法访问的旧浏览器偏好可通过偏好文本导入或重新设置。
旧令牌、用户裁决能力、Host bridge 和后台运行状态不导入。

If secure storage is unavailable, the native prompt offers explicit session-only
use. Its key stays in memory until project close, suspension or exit; local
research remains usable. Linux basic_text and unknown backends are refused.
Preferences and Provider configuration do not advance the research revision.

## Recovery, updates and storage

Project databases and backups stay in the selected project folder. Installation,
application preferences, encrypted credentials, update staging and preserved
programs have separate locations. Windows uninstall preserves projects and app
settings. Delete a saved key through Provider settings as a separate action.

Schema-25 restore verifies project, Brief, revision/event/workflow and privacy
identity, creates a pre-restore backup and rechecks source/current files under
maintenance and writer locks. Interrupted swap/cleanup blocks project opening
until explicit recovery. Unknown/corrupt replacements and different Forget
history are refused. An older program cannot write newer schema. See
[backup instructions](../../docs/recovery/BACKUP-RESTORE.md).

The updater accepts signed metadata from installed roots only. It checks channel,
sequence, version, target, source and migration identity, installer size/hash and
the signed unsigned-core identity. Startup/status never fetch. Restart reports
interrupted work without resuming it. An explicit new check removes recognized
abandoned partial downloads. Before launch it protects saved project state,
verifies a preserved program and records the phase. New schema/migration identity
is refused pending an applicable verified migration contract.

Synthetic tests inject trust/source/installer functions through service construction.
The app exposes no test-root switch or environment trust override. Synthetic tests
are not a signed release or native installer acceptance. See
[upgrade scope](../../docs/release/RECOVERY-AND-UPGRADE.md).

## Contributor build and verification

From the repository root:

```text
pnpm install --frozen-lockfile
pnpm desktop:build
pnpm --filter @sestina/desktop start
pnpm desktop:runtime
pnpm test:desktop
```

Resources load through sestina://app/ without an HTTP server. Main owns files,
leases, secrets, native dialogs and installation. Preload exposes named methods;
the renderer consumes typed projections and uses the shared Kernel service.

Package committed source with `pnpm desktop:package win32`, `darwin` or `linux`.
Targets remain Windows x64, macOS arm64 and Linux x64. Each invocation creates a
fresh staging directory and produces a deterministic unsigned core, manifest and
installer under release/desktop/platform-arch. The companion pins Node 24.13.0,
ships its full license and includes platform native credential modules.
Cross-building requires an explicit target Node runtime (SESTINA_COMPANION_NODE)
and native dependencies. Prefer a target-system build; Windows cannot verify
another OS's installed lifecycle.

`node scripts/verify-desktop-artifact.mjs <installed-directory> <manifest> <source-commit>`
checks actual ASAR, unpacked native resources, companion runtime, source, lockfile,
migration and unchanged official Logo. Independent clean cores must match;
installer signatures remain a separate outer-artifact requirement.

Set SESTINA_TEST_INSTALLED_EXECUTABLE to the installed executable for installed
IPC/layout tests. The installed visual journey is:

```text
node node_modules/vite-node/vite-node.mjs --config tests/post-0.2/vitest.foundation.config.ts tests/desktop/installed-visual.ts
```

This journey uses synthetic picker/confirmation answers. It checks the installed
renderer, IPC, Kernel and SQLite; native-dialog acceptance requires actual
Computer Use operation. Product Design must inspect captured images and running
transitions, focus, rapid interruption and reduced motion. This continues into
G12/G13 installed acceptance.

The local `node scripts/verify-desktop-upgrade.mjs` acceptance runner expects the
existing isolated `.tmp/g10-g11/installed` application, synthetic `install-project`
and a newer committed Windows candidate. It verifies real backup, installer launch,
restart reconciliation and preserved-program opening. Synthetic trust is confined
to service construction; it is never installed into the application. The runner
reads the earlier identity outside Electron to avoid retaining a Windows archive
handle while the installer replaces it. Choose a separate
SESTINA_DESKTOP_VISUAL_OUTPUT directory when preserving earlier image evidence.

No macOS/Linux machine, signing/notarization account or authorized production
update root is available for this task. Their actual acceptance remains open;
local implementation and Windows evidence are recorded separately in the
[implementation status](../../docs/product/restructure/IMPLEMENTATION-STATUS.md).
No push, tag, publication or G12/G13 cutover is part of this candidate.

## Remaining prerequisite check

```text
pnpm verify:desktop:readiness --inventory <local-inventory.json> --installed <installed-directory> --manifest <candidate-manifest.json> --output <local-result.json>
```

This is G10 verification preparation. It executes the existing Windows x64
installed-resource verifier when both installed/manifest arguments are supplied,
then reports outstanding G10/G11 observation bindings. The source is the
inventory's explicit 40-character `sourceCommit`, never an inferred current HEAD.
The current installed verifier supports the unsigned internal Windows candidate;
it does not verify signed/macOS/Linux packages or establish a production signature.
The separate `verify:platform` still checks Public Preview archives, and can
replace release output while building. It is not target-desktop acceptance.

Inventory format is `{schema: 1, sourceCommit, artifacts, observations}`.
`artifacts` maps `win32-x64`, `darwin-arm64` and `linux-x64` to installer
`{path, sha256}`. Each observation index entry is `{requirement, path, sha256}`.
Requirement IDs and required case IDs are exported by
[`remainingDesktopRequirements`](../../scripts/lib/desktop-readiness.mjs).
An observation file contains `schema: 1`, `requirement`, `target`, `sourceCommit`,
`installerSha256`, a nonempty `environment` description, `status: "passed"`,
`skipped: 0`, `todo: 0`, `cases: [{id, status: "passed"}]` and a nonempty
`evidence: [{path, sha256}]` list of actual raw records. All paths resolve from
the inventory's directory. Keep local machine paths and raw records outside Git.

Missing files, wrong hashes/source/target, duplicate observations, missing/zero
cases, skipped/todo/not-run/failed cases and absent raw records return exit 1.
Malformed replacement inventory writes a failed output instead of retaining an
earlier successful result when the requested output remains writable.
Hashes establish byte identity only. Reviewers must still inspect actual native
observations, platform signature results and configuration provenance; synthetic
fixtures, browser captures and dialog stubs cannot supply those results.
Passing this narrow check would not complete G10/G11, G12 or G13 automatically.

此入口只核对尚缺的前置验收资料。安装包和证据按源码、平台及校验值绑定，
缺失或未执行就返回未通过。它不运行 G12 全量验收，不切换默认入口，不发布。
原生交互仍须实际操作和观察；不能用静态截图或自动化对话框替身代替。
