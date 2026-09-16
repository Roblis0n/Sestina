# Sestina desktop distribution

This Electron application uses the schema-25 Research Room and shared application
service. Current local packages remain unpublished candidates. The published
v0.2.0/schema-20 preview is unchanged. Actual current results and formal gaps are
tracked in the [merged evidence](../../docs/product/restructure/G1-G3-EVIDENCE.md).

The product is **Sestina**, with distribution appId `org.sestina.desktop` and
executable `Sestina.exe` (Windows), `Sestina.app` (macOS), or `sestina` (Linux).
Candidate and release profiles package the same application. The established
internal `Sestina Candidate` userData and encryption-service name is retained so
existing settings and encrypted credentials remain readable. This storage name
does not select a second product or restore any legacy research writer.

New default installation paths use Sestina; the older internal candidate is not
silently uninstalled or its project directories scanned. Select the project
explicitly. Keep a verified old program for recovery until the new installation
has been checked. Uninstall removes application files, keeps projects/backups
and settings, and handles credentials separately through Provider settings.

当前安装身份为 Sestina。既有设置与加密服务的内部名称保持兼容；改名不删除旧
配置、凭据或研究项目。请显式打开项目，旧候选程序不会被自动卸载。卸载程序
保留项目、备份与设置；已保存的密钥在 Provider 设置中单独删除。

## Use the candidate / 使用候选

The repository defaults (`pnpm start`, `pnpm build`, `pnpm package win32`) now
select this desktop. Root and project switching both open the same Kernel entry.
Normal CLI `context`/`doctor` read schema-25 projections; old CLI creation and
legacy SDK/HTTP research writes are rejected. No production runtime flag restores
those writers. Synthetic historical tests resolve the explicit
`sestina-legacy-fixtures` package condition; the build refuses it in the desktop.

当前源码只以桌面为默认入口。安装后选择项目文件夹；新项目需明确勾选创建。
旧项目先检查并生成迁移备份，再由用户确认迁移。未知或未来版本不会覆盖。
通过开始页的备份恢复先预览，再明确确认；程序回退和研究数据恢复分别执行。
升级前保护项目并保留旧程序；卸载程序保留项目，凭据需在 Provider 设置单独删除。
此候选没有生产更新源，使用交付的本地安装器进行隔离升级验证。

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

Package committed source with `pnpm desktop:package win32 --profile candidate --version 0.3.0`, using `darwin` or `linux` on the corresponding system.
Targets remain Windows x64, macOS arm64 and Linux x64. Each invocation creates a
fresh staging directory and produces a deterministic unsigned core, manifest and
installer under release/desktop/platform-arch/version. The companion pins Node 24.13.0,
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

The installed lifecycle runner is `tests/desktop/installed-lifecycle.ts`, executed
with vite-node and the foundation config shown above. Supply absolute paths in
`SESTINA_UPGRADE_AREA` (a fresh directory inside repository `.tmp`),
`SESTINA_PREVIOUS_INSTALLER`, `SESTINA_UPGRADE_INSTALLER` and
`SESTINA_UPGRADE_MANIFEST`. It creates synthetic research, installs the prior
candidate, then runs the real backup/update/preserved-program probe. Its
`lifecycle-result.json` can be supplied to the common target entry. The old
`.tmp/g10-g11/installed` path is not assumed to exist. Synthetic trust is confined
to service construction and is never installed into the application. Native
uninstall/credential/focus observation remains separate.

Use the common acceptance entry after installing the exact candidate:

```text
pnpm verify:target --phase candidate --manifest <candidate-manifest.json> --installed <installed-app-directory> --installer <installer-file> --lifecycle-result <lifecycle-result.json> --output <local-evidence-directory>
```

`final` also checks the default cutover. `publish` is a read-only verification of
an explicitly authorized actual public release; it does not create a tag or
upload files. The three modes share checks. Each result names the runtime source,
verification source, installer digest, platform, raw test records and outstanding
formal observations. A local pass and formal platform acceptance are separate
fields. Installed performance keeps all samples and a fresh retained seed for
each run; screenshots and native-dialog fixture answers cannot by themselves
establish continuous motion or native focus acceptance.

The common entry also recompiles the unsigned core in a fresh staging directory
and compares the complete archive and every entry. It does not compare signature
timestamps. Final cutover checks inspect installed renderer/runtime input graphs,
reject legacy active service code in both the main app and companion, and actually
operate the packaged default entry, project creation, old links and project switch.

No macOS/Linux machine, signing/notarization account or authorized production
update root is available for this task. Their actual acceptance remains open;
local implementation and Windows evidence are recorded separately in the
[implementation status](../../docs/product/restructure/IMPLEMENTATION-STATUS.md).
No push, public tag or publication is authorized. The later local G12/G13
continuation is recorded in the implementation status and combined evidence.

## Remaining prerequisite check

```text
pnpm verify:desktop:readiness --inventory <local-inventory.json> --installed <installed-directory> --manifest <candidate-manifest.json> --output <local-result.json>
```

This is G10 verification preparation. It executes the existing Windows x64
installed-resource verifier when both installed/manifest arguments are supplied,
then reports outstanding G10/G11 observation bindings. The source is the
inventory's explicit 40-character `sourceCommit`, never an inferred current HEAD.
The installed verifier checks the declared platform's resource layout and native
executable architecture, including macOS app bundles. Only Windows has actual
local installation results; layout checks do not establish other-platform
installation or a production signature.
The separate `verify:platform` still checks Public Preview archives, and can
replace release output while building. It is not target-desktop acceptance.
Current CI and release preparation therefore use the native desktop workflow and
shared `verify:target`; see [explicit signing, update configuration and version
preparation](../../docs/release/README.md#current-desktop-distribution-preparation).
Release mode never discovers an arbitrary signing identity from the machine.
Production signing/update resources are required explicitly and their absence is
an error, not a fallback to a claimed signed package.

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


### Continued native acceptance and delivery

The [current execution recipe](../../docs/release/README.md#desktop-acceptance-and-publication-execution-2026-09-16)
connects native evidence, Windows previous-package execution, combined acceptance,
production update signing and installation from actual published downloads.
Existing user installation/recovery/credential choices above remain unchanged.

Future affected UI/release work must use Product Design on the actual built and
installed Research Room: English/Chinese; light/dark/high contrast; 1100×760,
1280×800, 1440×900 and 1920×1080; 100%/200% text; long content and relevant
empty/loading/error/cancel/conflict/success/recovery states; keyboard, focus,
Escape, scrolling and actual assistive technology. Observe continuous/reduced
motion and interrupted/reversed transitions in the running app. Reuse equivalent
unchanged states. Screenshots, DOM assertions and dialog fixtures cannot replace
actual visual inspection or native interaction.
