# Privacy

The production privacy contract is machine-readable through:

```text
sestina privacy show --json
```

The command reports `networkDefault: denied`, no automatic telemetry, no crash reports or crash upload, no background research-content logging, no automatic upload, and no authority mutation by an external model. The same production manifest supplies the confirmation disclosure for Codex host verification.

## What stays local by default

Core/CLI state, the active Research Brief, Decisions, Issues, Reviews, and local recovery metadata stay in the project's `.sestina/` directory. Manual and pre-restore bundles stay under `.sestina/backups/`. There is no background synchronization, retry queue, telemetry process, crash uploader, or automatic content log.

The default offline path includes deterministic review, reports, local Capsule export/import, project-state backup/restore, and the read-only stdio MCP. Explicit content commands such as `brief show`, `report`, `capsule export`, and MCP `get_research_context` return the research content the user requested; that response is not background logging.

## Explicit network exceptions

Codex host verification and active host-assisted work can contact the user-selected Codex model provider only after an explicit user action. In particular, `connection-status --verify-host` requires `--yes`. It may send bounded research context, project/active-Brief identifiers, and current research boundaries. This is not a background or default connection, and the read-only MCP response cannot change user authority.

Static `connect`, ordinary `connection-status`, and `disconnect` are local project-configuration operations. `disconnect` removes only managed Codex Skill/MCP configuration; it does not remove `.sestina/`, the database, Briefs, or backups.

The production Research Room also supports an explicitly configured
`openai_compatible` Semantic Judge and a separately configured second-opinion
Provider. Both are disabled by default. Saving or deleting configuration does
not send research content; connection testing performs metadata-only
`GET /models`. A research assessment is sent only after the user inspects and
confirms the exact Context Manifest. The Manifest identifies included and
excluded fields, source/config/state hashes, endpoint/model/locality, request
size, limits, privacy, and—when applicable—the independence basis.

Provider configuration is App-level and secrets remain in the OS-backed secret
store. They do not enter project state, Manifest content, logs, exports, backup
bundles, or Git. The original Judge and second-opinion Provider use separate
config generations, secret references, and runtime identities. The second
opinion omits the original verdict, reason, confidence, and raw response. Raw
Provider envelopes are validated in memory and are not persisted; only the
strict normalized assessment and safe binding metadata may enter the project
ledger. Provider, Agent, comparison, or agreement cannot mutate research
authority.

With no explicit configuration or confirmation there is no semantic-provider
network call: RI-48 remains `ledger_only` and RI-49 remains fully usable as
`appeal_record_only`. A local loopback endpoint follows the same confirmation
contract even though it may not leave the machine.

RI-50 Deliberation Rooms use two explicitly selected connection/runtime
bindings and two separately reviewable Context Manifests. Both initial requests
are frozen before either Provider result is accepted. Participant A never
receives Participant B's output, private Context, or session, and the symmetric
rule applies to B. User-only Resolution data is excluded from Provider input.
There is no automatic discovery, fallback, retry, external search, tool call,
file/shell access, cross-project memory, or third synthesis Provider; one Room
can make at most four external calls under its user-confirmed budget.

Only strict normalized public assessments and safe identity/hash metadata may
be persisted. Raw Provider responses, secrets, authentication headers, complete
network payloads, hidden reasoning, and participant-private sessions are not
stored. Manual external opinions retain source, capture time, and exposure
disclosure and cannot claim protocol blindness. Without two valid explicit
bindings, RI-50 remains locally operable through draft, failure/partial records,
manual disclosure, and user Resolution, while real two-Provider evidence stays
`blocked_missing_user_config`.

## Currently unavailable model paths

There is no formal local-model runtime. Sestina does not claim that a model ran offline when no such runtime exists.

## Capsule and exports

A Capsule is created and transferred only by an explicit user action. Sestina does not upload it. An imported Capsule response remains a `model_proposed` candidate and cannot mutate research authority. Other user-selected exports live at the destination explicitly supplied by the user; they are not added to recovery bundles automatically.

## Data retention

Uninstalling a CLI package, removing the local App, or disconnecting a host does not automatically delete project research data. Current package manifests are locked against `preuninstall`, `uninstall`, or `postuninstall` data-deletion scripts. Delete `.sestina/` or explicit exports only as a separate, deliberate user filesystem action after preserving any required recovery copies.

For the exact flow inventory, see [docs/security/DATA-FLOW.md](docs/security/DATA-FLOW.md). For recovery locations and commands, see [docs/recovery/BACKUP-RESTORE.md](docs/recovery/BACKUP-RESTORE.md).
