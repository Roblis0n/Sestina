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

## Internal desktop packaging

The commands above describe the published preview. The new internal Electron recipe is documented in [desktop operations](../../apps/desktop/README.md). It records a real source commit/tree, lock hash, bundled runtime, schema, Logo hash and file manifest. Its unsigned core is separate from platform signing. Candidate packages are not public v0.2.0 tag artifacts; no public push, tag, Release, signing account or notarization service is used by the local candidate recipe.

## Current desktop distribution preparation

The next desktop version is proposed as **0.3.0**, not published or tagged.
Local builds now use the Sestina product name, `org.sestina.desktop` appId,
`Sestina.exe` / `Sestina.app` / `sestina`, and version-scoped artifact directories.
The current source already defaults to schema 25 and rejects retired research
writers. No real user project or existing installation is automatically moved.

Release notes for this prepared desktop increment: one persistent Kernel Review
flow; explicit user-authorized canonical changes; local migration, history,
Memory/Forget, backup and recovery; packaged Node, read-only MCP and Skills;
manual update with pre-upgrade backup and preserved-program recovery. This round
adds explicit release identities, signing/notarization configuration, production
update-root inputs, and the native desktop build matrix. Actual platform,
signature and accessibility completion is reported in the
[merged evidence index](../product/restructure/G1-G3-EVIDENCE.md), not inferred
from these capabilities.

Candidate build (no production trust or signing credentials are consumed):

```text
pnpm desktop:package win32 --profile candidate --version 0.3.0
```

The same recipe accepts `darwin` or `linux` on the matching native machine.
Output is `release/desktop/<platform>-<arch>/<version>/`; historical Preview
outputs are never overwritten by this recipe. Each output has installer,
`candidate-manifest.json`, `unsigned-core.tar.gz` and `SHA256SUMS`. The manifest
filename is retained as the existing verification interface for both profiles.
Its embedded `signed: false` describes the unsigned core; `envelope` and
`signingStatus` separately report actual outer verification.

After the version/tag and signing actions are explicitly authorized, release
mode runs from that tag's clean detached checkout:

```text
pnpm desktop:package win32 --profile release --version 0.3.0 --tag v0.3.0 --release-config <private-local-json>
```

The local JSON supplies `update.source` (public HTTPS URL without embedded
credentials/query/fragment), `update.roots` (named Ed25519 **public** PEM keys)
and target-specific inputs below. No private key or production configuration is
committed. Missing or mismatched resources stop release mode before packaging;
it never silently produces an allegedly signed release.

| Target | Explicit signing input and actual verification |
| --- | --- |
| Windows x64 | `signing.target=win32`, local `certificateFile`, `certificateSha256`, exact `publisherName`, signer `thumbprint`, `passwordEnv=SESTINA_SIGNING_PASSWORD`. Builder signs the installer/application; Authenticode must be Valid and match the selected signer. |
| macOS arm64 | `signing.target=darwin`, `certificateFile`, `certificateSha256`, exact Developer ID `identity`, `teamId`, explicit notary `keychainProfile`, same password variable. App notarization runs after signing and before DMG assembly; codesign, spctl, stapler and hdiutil verification must pass. |
| Linux x64 | `linuxPolicy=checksum-provenance-signed-update`. AppImage source and checksums are verified; no Windows/macOS code-signature claim is made. Production update metadata still requires an installed-root Ed25519 signature. |

`scripts/sign-desktop-update.mjs` consumes an explicit verified release manifest,
installer, `--private-key`, `--key-id` and `--output`. It checks that the private
key matches an installed public root, binds target/version/schema/migration/core
and installer bytes, then creates the exact signed offer and hash-addressed
artifact layout. It does not upload. Test signing keys remain confined to test
construction. This command is an authorized signing action, not an automatic
candidate build step.

CI and manually dispatched release preparation share `release.yml`: common
public checks run once; Windows, Apple-silicon macOS and Linux jobs build native
desktop artifacts and invoke `verify:target`. An additional OS runs its own
SQLite/process foundation checks. The platform driver uses actual NSIS, DMG or
AppImage bytes and records whether it installed or extracted them. It does not
claim an observed native lifecycle when no bound lifecycle result was supplied.
Missing lifecycle/observations keep acceptance incomplete; artifact upload retains
the real result even when a job fails. The workflow contains no public Release
or tag creation step.

Signed dispatch uses explicitly configured protected environments
`desktop-release-win32-x64`, `desktop-release-darwin-arm64`, and
`desktop-release-linux-x64`. Inputs are `SESTINA_RELEASE_CONFIG_JSON`,
`SESTINA_SIGNING_PASSWORD` and `SESTINA_SIGNING_CERTIFICATE_BASE64`; macOS also
requires `SESTINA_NOTARY_KEY_BASE64`, `SESTINA_NOTARY_KEY_ID` and
`SESTINA_NOTARY_ISSUER`. Keys/certificates are written only to private runner
temporary files. Candidate CI receives none of these resources. Do not dispatch
the remote workflow or configure external services without user authorization.

### Local review package, 2026-09-14

The actual Windows x64 candidate is
`release/desktop/win32-x64/0.3.0-g10.6b5dd243/Sestina-0.3.0-g10.6b5dd243-win32-x64.exe`
(135,017,148 bytes), from runtime commit
`6b5dd243641ea7af1a8ef766b8c6565bf0822660`. Its SHA-256 is
`005d762399d882d14df3224b4d1a533d213e838c363bb3ed32d98cae7c20692a`.
The colocated manifest identifies Node 24.13.0, Electron 44.3.0, pnpm 11.16.0,
source tree, lock hash, original Logo, schema 25 and bundled native resources.
`SHA256SUMS` covers the installer, blockmap, manifest and unsigned core. Actual
Windows Authenticode status is `NotSigned`; no production trust is installed.

The current runtime also addresses the measured opening/transaction overhead
through bounded reuse of normalized, deeply immutable Kernel records. SQL bytes,
relationships, authority checks and canonical encoding remain validated; Forget
and project close clear the cache. Earlier failed measurements remain in the
merged index, separate from this runtime's acceptance.

The final local aggregate passed at verification commit
`5361d771ff501cfa8271bc0e7ad346ef1d493d3a`: 742 public assertions, actual installed
journeys/lifecycle, independent core reproduction, performance and resource checks.
The event chain still rereads every SQL row and checks every binding; only
unchanged validated decoding and immutable snapshot hashes are reused.
Cold/warm startup p95 is 1964.562/1954.089 ms and canonical transaction p95 is
375.203 ms. Twelve actual installed frames were inspected. Formal acceptance
remains unestablished; these local results are not three-platform publication.

The installed Sestina executable's ProductName/FileDescription are Sestina.
Its isolated upgrade and current-package uninstall/reinstall preserve synthetic
project/Brief, preferences and encrypted-credential continuity. Use
[desktop operations](../../apps/desktop/README.md) for explicit project opening,
migration backup/confirmation, separate program rollback/data restoration, and
uninstall with separate credential deletion. Native wizard observation is still
pending. Final acceptance and actual image inspection are recorded only in the
[merged index](../product/restructure/G1-G3-EVIDENCE.md#desktop-distribution-continuation-2026-09-14).

No macOS or Linux installer, production signature, public tag or Release was
generated in this Windows execution. The prepared target repository is
`Roblis0n/Sestina`; a future authorized publication must use the finally accepted
tag commit and that commit's newly verified signed platform packages and update
offers. This unsigned source-suffixed candidate must not be renamed into a stable
release. Version 0.3.0 requires the user's one-time publication decision once
formal acceptance and signing resources are available.


### Desktop acceptance and publication execution, 2026-09-16

The desktop workflow carries `lifecycle-result`, `reinstall-result`,
`visual-observation`, `readiness` and shared public results to the existing target
entry. `--manifest` plus `--installer` selects existing exact bytes; `--installed`
selects an existing installation for verification. Fresh Windows lifecycle runs
use `--previous-installer`, `--previous-manifest` and `--run-reinstall`. The previous
installer automation is Windows-specific. macOS/Linux use their actual native
lifecycle and reinstall records via the result options, with OS-specific cases;
Windows silent-uninstall evidence cannot substitute. Linux AppImage extraction
and Xvfb are still limited checks, not desktop-session acceptance.

For authorized CI, `evidence_run_id` selects existing artifacts in this repository
named `desktop-inputs-<target>`. Each contains `desktop-input.json` with `schema: 1`,
its exact `target`, optional relative paths named after the evidence options
(also `manifest`, `installer`, `previous-manifest`, `previous-installer`), and
optional boolean `run-reinstall`. Paths stay inside the bundle; no commands or
secrets belong in it. Inventory/raw evidence uses relative paths and travels
with the bundle. Signing changes installer hashes: observations must reference
the exact signed package. The workflow retains early failures and combines native
outputs; missing targets remain explicitly unestablished.

Protected release preparation additionally requires
`SESTINA_UPDATE_PRIVATE_KEY_BASE64` (base64-encoded Ed25519 PEM) and
`SESTINA_UPDATE_KEY_ID`. They feed the existing update signer after verified
packaging, producing `update/<target>.json` and
`update/artifacts/<sha256>/Sestina.<extension>`. The key must match an installed
public root. Private temporary files are removed on success or failure and never
uploaded. Candidate jobs receive no signing resources. No step publishes.

Combine native results and assemble a reviewable delivery directory:

```text
pnpm verify:target --phase final --platform-result <windows-result.json> --platform-result <macos-result.json> --platform-result <linux-result.json> --release-inventory <inventory.json> --release-directory <new-delivery-directory> --output .tmp/desktop-combined
```

The release inventory has `schema: 1` and `packages`, exactly three records with
`target`, `manifest`, `installer` and `update` paths relative to the inventory.
Original package directories include `candidate-manifest.json`, `SHA256SUMS`,
`unsigned-core.tar.gz` and installer/blockmap bytes. Assembly accepts verified
release-profile packages of one source/version/tree/lock/schema/migration/sequence,
checks each signed update offer against its installer, preserves original bytes
and target-specific source/checksum records, and adds `release-index.json` and
complete `SHA256SUMS`. The directory must be new. It does not turn candidates into
stable packages, sign, upload or create tags.

After separately authorized publication, each native machine uses:

```text
node scripts/run-desktop-platform.mjs --published-directory <reviewed-delivery-directory> --published-repository Roblis0n/Sestina --output .tmp/published-native
```

GitHub CLI checks the public tag, downloads all attachments and compares actual
contents to the reviewed bundle. The driver installs its downloaded target package,
checks the installed archive/signature and runs the existing synthetic project
journey including quit/reopen. It writes `published-installation.json` with raw
download, installation, artifact and journey evidence. Transfer the whole result
directory preserving relative paths. This checks the published-byte difference;
public, performance and visual gates are not repeated. Linux extraction remains
explicit and separate from its required formal native acceptance.

Finally call the same `verify:target` entry with `--phase publish`, all three
`--platform-result` inputs, `--release-directory`, `--repository Roblis0n/Sestina`,
`--tag <approved-tag>` and three `--published-installation` records. Omit
`--release-inventory` once assembly exists. It downloads again into a new evidence
directory and refuses missing attachments, changed bytes/tag, mixed identities,
invalid update offers or missing/changed native installation evidence. Only the
combined result can establish formal acceptance and `published: true`.

Current local artifacts and the single remaining-resource list are in the
[merged closeout index](../product/restructure/G1-G3-EVIDENCE.md#desktop-closeout-execution-2026-09-16).
User install, migration, upgrade, program recovery, data restore and uninstall
instructions remain in [desktop operations](../../apps/desktop/README.md).

The 2026-09-16 integrated local verification passed at
`d5b6a65b646b56a5f644a8cc865995d8af4d4aab`; the unchanged runtime artifact remains
`6b5dd243`. The proposed public version is still 0.3.0, repository
`Roblis0n/Sestina`. No production offer can be supplied before authorized roots,
endpoint and signer are selected and the corresponding release bytes are built.
A future public tag must identify the finally accepted release-source commit;
this verification-only descendant does not relabel the existing candidate.
