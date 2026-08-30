# Closed external-host pilot architecture

Target host: `codex`

Persistent schema: `020`

## 1. Purpose and evidence boundary

The Closed External App Pilot is the smallest production bridge between the local Research Room and one external AI host. It answers one bounded question: can Sestina disclose one exact project context to a temporary read-only Codex task, receive one proposal-only candidate, route it through the existing Review and user Authority Gate, and let a completely fresh host session read the resulting canonical state?

The following statements remain distinct:

- External App Pilot is not an External User Pilot.
- A real Codex process is host evidence, not external-user evidence.
- MCP success is protocol evidence, not research quality.
- Candidate import is not acceptance.
- Context read permission is not write permission.
- A fresh-session observation is not proof that the model learned, is independent, or creates repeatable research value.

This feature does not add another host, an adapter registry, a write MCP surface,
a daemon, automatic retry/fallback, telemetry, or cloud sync.

## 2. Ownership and component boundaries

```text
Research Room UI
  -> strict typed loopback API
  -> SestinaCore
  -> ClosedExternalAppPilotService
  -> Research-domain transition functions
  -> project-local schema-020 repository

Confirmed attempt
  -> Closed Codex Host Runner
  -> official Codex executable
  -> invocation-only frozen read-only MCP
  -> strict structured output
  -> proposal-only candidate / host observation
  -> SestinaCore
```

The Research domain owns every Pilot state transition. Core coordinates the Pilot with the existing artifact revision, Review, Authority Gate, Receipt, and Trace services. The SQLite repository owns persistence and CAS, not business decisions. The HTTP server validates request shape and invokes Core. React consumes decoded projections and never derives legal transitions. Codex, MCP, the generated Skill, CLI, and process runner cannot mutate research Authority.

## 3. Aggregate and state machine

`ClosedExternalAppPilot` is project-bound and non-authoritative. It binds:

- Pilot/project/Brief/version/Episode/current-task identity;
- Codex-only host capability preflight;
- exact Manifest, attempt, nonce, hash, expiry, invocation, and budget;
- proposal-only candidate identity/hash/source;
- existing Review and imported revision;
- user disposition, Receipt, and Trace;
- fresh-session continuity observation;
- bounded local metrics, optional feedback, public events, and stable failure facts;
- expected entity version for CAS.

The finite states are `draft`, `preflight_ready`, `context_confirmation_required`, `context_confirmed`, `launching`, `running`, `candidate_received`, `candidate_confirmation_required`, `review_required`, `user_disposition_required`, `continuity_check_ready`, `continuity_check_running`, `continuity_verified`, `closed`, `stale`, `expired`, `cancelled`, `failed`, `blocked_host_unavailable`, and `interrupted_unknown`.

`candidate_received` and transition to `candidate_confirmation_required` are committed in one Store unit of work. Candidate import, revision creation, Review preparation, and Review binding are also coordinated by Core; import never produces a user disposition. On application startup, an attempt persisted as `launching`, `running`, or `continuity_check_running` becomes `interrupted_unknown`; it is never retransmitted automatically.

## 4. Exact Pilot Context Manifest

Each attempt owns an immutable `PilotContextManifest`. Its canonical UTF-8 JSON contains only the disclosed fields and a fixed untrusted-data boundary. The hash is SHA-256 over those exact bytes. Preview, confirmation, frozen MCP, audit, candidate/continuity result, and attempt all bind the same project, Pilot, Manifest, attempt, purpose, and hash.

Working Memory is selected from the current project only. Default selection is empty. `never_send` is always excluded. An item is eligible only when it is `active`, current, non-expired, `explicit_manifest_only`, and explicitly selected for this Manifest. Content/source/version/Provider/host/project drift invalidates confirmation.

The invocation-only MCP reads the frozen file generated from those preview bytes. Its audit records only two bounded entries: `health` and `get_research_context`, each with project/Manifest/payload hash. Sestina accepts the host result only when both Codex JSONL completion events and both local audit entries match. A model statement that it called MCP is not evidence.

## 5. Codex process boundary

The shared Runner accepts only an absolute, validated official native Codex executable, official Node launcher, or verified adjacent shim. It uses an argument array and `shell:false`; it never concatenates a shell command. Fixed arguments include:

- `exec`, `--ephemeral`, `--json`;
- `--sandbox read-only`;
- `--ignore-user-config`;
- `--skip-git-repo-check` so an explicitly selected non-Git research project is supported without granting writes;
- invocation-only project trust and MCP overrides;
- bounded output schema and last-message file.

The Runner never changes global Codex configuration, reads Codex authentication files, scans environment variables/ports/credential directories, or persists project trust. Temporary context/schema/output/audit files live together under a new operating-system temporary directory and are removed in `finally`. stdout, stderr, JSONL line count, final output, timeout, cancellation, and payload sizes are bounded. Raw JSONL, stderr, model output, hidden reasoning, credentials, and complete environments are not persisted as diagnostics.

The output schema avoids unsupported Structured Output keywords but the Sestina decoder remains stricter: exact keys, byte bounds, unique arrays, current-project IDs, fixed Authority fields, path rejection, and exact canonical-state comparison all run after parsing.

## 6. Candidate, Review, Authority, Receipt, and continuity

The first host result must have `authority=model_proposed` and `canMutateAuthority=false`. It may be rejected or imported. Import creates a non-authoritative artifact revision and binds the existing Research Room Review. With no configured Sestina Provider, Review remains `ledger_only`; this is a complete deterministic review path, not a simulated Provider success.

Only the existing Authority Gate can commit `accepted`, `rejected`, `modified_accepted`, `deferred`, or `direction_changed`, and its actor must be the user. That action produces the normal Receipt and Trace. The Pilot stores only their bindings.

After disposition, a second Manifest can be prepared for `continuity_check`. It excludes the first candidate body and prior-session hidden state. A successful second Codex process must have a new invocation identity, call both read-only tools again, and return `authority=host_observation`, `canMutateAuthority=false`, and the exact current Brief/Episode/Decision/Issue state. It cannot reopen a resolved Issue without an explicit satisfied condition.

## 7. Recovery, metrics, and export

- Nonce replay, expiry, cross-project/attempt/hash reuse, stale Manifest, duplicate candidate, late result after cancel, closed-Pilot reopen, and CAS mismatch fail closed.
- Attempts are capped and never retried automatically. A retry requires a new Manifest and user confirmation.
- List/event queries are bounded and project-isolated.
- Local metrics contain stages, counts, bounded durations, context categories/bytes/hashes, stable error codes, and normalized feedback only.
- Evidence export excludes research text, candidate text, local paths, username, notes, credentials, raw Provider/Codex output, JSONL, stderr, and hidden reasoning.
- Host evidence never counts as an external researcher or claims external-user value.

## 8. Verification boundary

Domain, migration, Store, Core, API, decoder, process integration, offline
production E2E, and production visual/functional checks cover the implemented
boundary. Owner-operated Codex sessions observed both read-only MCP tools, exact
Manifest binding, a legal `model_proposed` candidate, import, a `ledger_only`
Review, direct-user disposition, Receipt, and a fresh-session continuity read of
the resulting canonical state. This is host and implementation evidence only;
it does not establish external-user value, research correctness, model learning,
semantic quality, or repeatable value in independent real research.
