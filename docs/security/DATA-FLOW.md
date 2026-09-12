# Data-flow inventory

The published v0.2.0 preview machine-readable form is returned by `sestina privacy show --json`. The first table and legacy workflow sections describe that preview. The internal desktop section records the separate schema-25 candidate; it is not a release claim.

| Flow | Trigger | Data categories | Destination | Network | Explicit user action or confirmation | Can change research authority |
| --- | --- | --- | --- | --- | --- | --- |
| Local Core/CLI | A local Sestina command | Project research state, Brief, Decisions, Issues, Reviews, recovery metadata | Project `.sestina/` and explicit local output | No | Command is explicit; authority-changing research actions retain their existing confirmation rules | No external actor is involved |
| Codex host/model | `connection-status --verify-host --yes` or active user-directed host work | Bounded research context, project/active-Brief identifiers, current research boundaries | User-selected Codex model provider | Yes | Yes; real verification requires `--yes` | No; MCP is read-only and model output is not user authority |
| Research Room Semantic Judge | User configures the original Judge, generates an exact Manifest, inspects it, and explicitly confirms one assessment | User-selected bounded Research Room context; frozen source/input/criterion/rubric/state bindings; suggestion required for that assessment | User-configured `openai_compatible` endpoint | Only after confirmation | Yes; saving config does not probe and `/models` test is metadata-only | No; strict normalized output is a candidate and Kernel/user Authority remains controlling |
| RI-49 second opinion | User separately configures a second runtime, records an Appeal, selects Context, inspects the exact Manifest and independence basis, and confirms one attempt | Frozen challenged source/input/criterion/rubric; appeal question; only explicitly selected Brief/Decision/Issue/Evidence fields; never original verdict/reason/confidence/raw response | Separately configured `openai_compatible` endpoint | Only after confirmation | Yes; every retry requires a fresh Manifest confirmation | No; assessment and deterministic comparison cannot resolve the Appeal |
| Local model | None in the current production runtime | None (`fields: []`) | None | No | Not available | No |
| Capsule transfer | Explicit Capsule export, user transfer, or response import | Bounded portable research projection selected by the user | Local file, then any destination selected and operated by the user | Sestina does not upload | Yes | No; response remains `model_proposed` candidate |
| Backup/restore | `data backup`, restore preview, or confirmed `data restore ... --yes` | SQLite project state, active Research Brief, hashes and binding metadata | `.sestina/backups/` and the same local `.sestina/` state | No | Backup/status are explicit; restore commit requires `--yes` | Restores a previously user-authorized local state; no external model authority |

## Local storage contents

`.sestina/state.sqlite` stores local research lifecycle records through schema 20. In addition to append-only Appeals, it stores project-bound Deliberation Room source/context freezes, participant identity digests, two exact Context Manifests, round/attempt state, normalized assessments, deterministic Difference summaries, challenge/manual-opinion disclosure, direct-user Resolutions, transitions, idempotent command receipts, and lineage. It does not store Provider secrets, raw responses, authentication headers, full network payloads, private sessions, or hidden reasoning. `.sestina/research-brief.yaml` is the file projection of the active research question and boundaries. `.sestina/backups/manual/` contains strict managed recovery bundles; `.sestina/backups/forensic/` contains raw pre-restore evidence when the current state is not healthy enough to create a verified bundle.

Recovery bundles intentionally exclude `.codex`, `.agents`, authentication stores, Provider configuration/responses, log files, temporary files, Capsule responses, and user project source files outside the active Brief. Secret backends remain separate from project recovery.

## Output boundaries

Privacy and recovery status outputs contain policy fields, managed IDs, versions, sizes, hashes, validation states, and confirmation state. They do not contain research text, Provider responses, tokens/secrets, authentication state, personal paths, or native SQLite errors. Explicit content-read commands retain their documented research-data output.

See [LOCAL-FIRST-GUARANTEE.md](LOCAL-FIRST-GUARANTEE.md) and [backup/restore details](../recovery/BACKUP-RESTORE.md).

## Deliberation Provider boundary

The owner-visible Manifest is the exact allowlist for each participant request.
Both initial requests are frozen before either result is accepted; A receives
no B output/private context/session and B receives no A output/private
context/session. User-only Resolution content is excluded from Provider input.
The adapter may send only the frozen request to the explicitly configured
endpoint after both Manifests are confirmed. No automatic fallback, retry,
external search, tool, file, shell, cross-project memory, or synthesis call is
allowed. At most four calls can occur in one Room.

Only normalized validated public assessments are persisted. Participant-private
content is excluded from the other participant and the default export. Manual
external opinions retain source, capture time, and exposure disclosure and are
always marked non-verifiable for mutual blindness. Cross-project Room reads,
events, imports, search, and deep links fail closed. See
[the RI-50 architecture contract](../architecture/04-MUTUALLY-BLIND-BOUNDED-DELIBERATION-ROOMS.md).

## Internal schema-25 application data flow

This development path is separate from the shipped production privacy manifest.
Explicit Core migration reads a verified source snapshot, writes a verified
prebackup and staging copy, validates canonical/legacy bindings, then performs a
journaled pair switch under maintenance. Recovery is explicit and local.

Kernel workflow transactions persist Review drafts, exact prepared Manifests,
attempt facts and immutable assessments/corrections in the target database.
Selected context and exact request bytes are therefore retained locally for
recovery; a no-Provider Manifest stores no body. Canonical transactions persist
the approved object results and their revision/Receipt/Trace together. The
Receipt and journal do not duplicate request text. Derived projections retain
their source revision and never become authority.

Migration, local persistence and recovery send no data. The implemented optional
Provider path sends only the exact confirmed Manifest after freshness and endpoint
checks. No Provider, host or saved hash gains user authority.
Known managed copies and privacy redactions are recorded; unobserved external
copies remain unknown. See [foundation operations](../product/restructure/G1-G3-OPERATIONS.md)
for the exact API and backup/Forget boundary.

## Internal desktop candidate flow

Renderer → named preload method → validated main window/frame/session → shared application adapter → Kernel → SQLite. Research commits and external sends additionally pass main-owned user confirmation bound to the immutable Kernel view. Provider DNS validation precedes a fresh pinned socket, and Kernel inputs are rechecked before body bytes are written. Host intake remains temporary draft/status only. Update signature verification has synthetic positive/negative tests; the internal candidate has no production trust root or automatic network check. [Candidate operations and remaining evidence](../../apps/desktop/README.md).

| Desktop flow | Explicit trigger | Local data and destination | Network and authority |
| --- | --- | --- | --- |
| Earlier settings | Inspect/import on the start page | Known earlier application configuration and credentials → app preferences, renewed Provider configuration and OS-encrypted credential storage; migration records bind source/target hashes and stage. Source copies remain. | No network; no research revision, token or user capability is imported. Browser databases are not scanned. |
| Credentials | Save/delete through Provider settings and the separate native credential dialog | Main writes encrypted values and reads them back before publishing configuration. Explicit session-only fallback stays in memory and is cleared on project close, suspension or exit. | No network on save; research renderer receives configured/persistence status only. |
| Managed recovery | Closed-project backup, preview, confirmed restore or interrupted-operation recovery | Verified schema-25 database/Brief bundles and swap marker remain in the selected project. A pre-restore bundle protects saved current state. Privacy history, identity and current bytes are rechecked under locks. | No network; stale, retired, cross-project or privacy-incompatible copies cannot be restored. |
| Manual update | Check/download/install in About | Private app-data staging stores bounded metadata, installer bytes, phase, project path/backup ID and preserved-program ID. Program recovery stores verified installation files, not research records. | No source is configured in this candidate. With installed trust, explicit actions issue HTTPS GETs for metadata/artifact only, without cookies, credentials, project context or request bodies; redirects/retries are refused. |
| Companion MCP and Skills | Copy configuration/open bundled Skills in Integrations; user separately configures a host | Installation-specific command paths and the selected project path; bundled Node, read-only MCP and canonical Skills | Generating configuration sends nothing and does not verify the host. A host's later model use remains an explicit user-controlled external flow; MCP cannot grant research authority. |

Application preference import/export is plain inspectable text. Update and migration
records contain operational metadata, not Provider responses or hidden reasoning.
Uninstall does not erase projects, app preferences, encrypted credentials or their
independently retained earlier copies. Deleting a current Provider key does not
claim deletion of retained migration sources.
