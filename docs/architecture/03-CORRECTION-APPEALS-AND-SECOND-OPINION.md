# Correction Appeals and one independent second opinion

This document defines the production Correction Appeal architecture. It
extends the existing Research Deliberation Kernel and the sole Research Room
client; it does not create a second Room, a parallel authority ledger, or a
multi-Provider orchestrator.

## 1. Direct product increment

A user can open a stable Semantic Finding, record why it is disputed,
retain that appeal without any Provider, optionally review and confirm one
context-isolated second-opinion request, inspect a deterministic comparison,
and record the user's final interpretation. Reopen, refresh, deep link, project
switch, process restart, Search, Attention, Overview, and Receipt/Trace all
recover from the same persisted project state.

The original Finding is immutable. An appeal, an assessment, a comparison, and
a resolution are append-only overlays. None of them edits the original review,
Brief, Decision, Issue, Evidence, Episode, or Receipt.

## 2. Ownership and dependency direction

```text
React workspace
  -> exact typed loopback API
    -> SestinaCore appeal commands and projections
      -> CorrectionAppeal domain rules
      -> project-bound repositories / SQLite migration 017
      -> strict second-opinion assessment protocol
        -> one explicitly configured second-opinion Provider adapter
```

- `@sestina/research` owns canonical appeal values, parsing, legal transition
  history, hashes, result bindings, comparison values, and resolution values.
- `@sestina/core` owns command authority, compare-and-swap transitions,
  idempotency, active-appeal uniqueness, attempt fencing, projections,
  recovery, Search, Attention, Overview, and Receipt/Trace integration.
- `@sestina/research-store` persists project-scoped canonical records. Migration
  017 raises the schema to 17 without rewriting existing research objects.
- `@sestina/review` validates the one second-opinion protocol and produces only
  normalized criterion assessments. It does not resolve an appeal.
- The loopback server validates exact payloads, opened-project binding,
  versions, confirmation, session, and operation identity before calling Core.
- React renders Core projections and submits explicit user commands. It does
  not derive authority, legal transitions, result validity, or comparison.

## 3. Canonical record and lifecycle

Each appeal freezes its project, review, Finding, source/rubric/input versions
and hashes, the user's versioned public statement, lineage, and current version.
At most one unresolved appeal can exist for the same project/review/Finding.
After resolution, a later appeal creates a new record linked to the prior one.

The legal lifecycle is checked both while executing commands and while parsing
persisted transition history. A row that skips a required lifecycle state is
corrupt and fails closed; a syntactically plausible final status is not enough.
Every mutation binds the expected appeal version and an idempotent command ID.

The complete local path is always available:

```text
draft -> recorded -> appeal_record_only -> user resolution
```

The optional Provider path adds a single confirmed attempt:

```text
recorded -> manifest ready -> confirmed -> running
  -> succeeded -> deterministic comparison -> user resolution
  -> cancelled | failed | recovery_unknown -> appeal_record_only/retry
```

A retry is a new attempt with a newly generated and confirmed Manifest. A late
response cannot cross an attempt fence or turn a cancelled/failed operation
into an authoritative result.

## 4. Independence and Context Manifest

The original Judge configuration and the second-opinion configuration are
stored and resolved separately. Provider family alone does not prove
independence. The participant snapshot binds a distinct runtime identity,
configuration generation, endpoint/model identity digest, locality, protocol,
prompt, rubric, source, and request hash. Same-runtime or unverifiable identity
cannot be labelled independent and shrinks to `appeal_record_only`.

Before any outbound call, the UI shows the exact included/excluded fields,
source versions and hashes, Provider/model/locality, request size, limits,
token/cost availability, privacy boundary, independence basis, and canonical
request hash. The user must explicitly confirm that exact Manifest. Any source,
context, Provider generation, or state change invalidates confirmation.

The second opinion receives the challenged criterion/rubric, frozen research
input, the user's appeal question, and only the project fields the user selected.
It never receives the original verdict, original reason, original confidence,
original raw response, another Agent's judgment, credentials, hidden reasoning,
or unrelated project content.

## 5. Strict result and deterministic comparison

Transport success is not semantic success. A result must match the exact
request, source, criterion, rubric, schema, and state hashes; contain only the
allowed keys; use one of `present`, `not_present`, `uncertain`, or
`insufficient_context`; and bind evidence spans to the frozen input. Invalid,
oversized, partial, injected, or stale output creates no result.

Core compares normalized values only. It records agreement or contradiction,
evidence overlap, qualification, and whether a non-redundant increment is
`present`, `absent`, or `unproven`. This is a deterministic description, not an
automatic winner and not a quality score.

## 6. User authority and projections

Only an explicit user command can record one of these public resolutions:

- `uphold_original_finding`
- `overturn_original_finding`
- `modify_finding_interpretation`
- `defer_insufficient_evidence`
- `record_disagreement_without_resolution`

The command requires the current version, a non-empty public reason, and direct
user provenance. Provider, Agent, comparison, hash, signature, or agreement
cannot resolve or modify a Finding. Resolution creates a new append-only entry
and Receipt/Trace lineage.

Appeals are exposed through bounded, stable, project-bound list/detail
projections. Overview counts and recent activity, structured Search, rebuildable
Attention, and Receipt details consume the same Core projection. Cross-project
identifiers fail without disclosing whether an object exists elsewhere.

## 7. Storage, privacy, and recovery

- SQLite migration 017 creates append-only appeal, statement, attempt, result,
  comparison, resolution, transition, and receipt state under the selected
  project's existing `.sestina/state.sqlite`.
- Transactions preserve appeal/result/resolution atomicity. Database open,
  read-only, busy, corruption, and generic storage failures map to distinct safe
  error classes and user recovery copy; SQL, stack traces, and absolute paths do
  not cross the loopback boundary.
- Secret material remains in the OS-backed secret store. Config responses expose
  safe metadata only. Connection testing uses metadata-only `GET /models`; it
  sends no research body and is not a semantic smoke test.
- Raw Provider responses, authorization headers, full network payloads, hidden
  reasoning, screenshots, browser profiles, logs, and personal paths are not
  persisted as appeal evidence or committed to Git.
- No Provider, failed independence, cancellation, timeout, malformed output,
  offline operation, or uncertain restart never damages the appeal. The user can
  continue the record-only path and make a resolution.

## 8. Evidence boundary

Protocol fixtures, loopback stubs, unit/integration tests, owner-operated browser
flows, and screenshots prove implementation and local host behavior only. They
do not prove real model quality, cognitive independence, external adoption,
market demand, or a real second use. Without a user-configured independent
Provider, a real second-opinion result and non-redundant value in real cases
remain unproven. The related bounded deliberation architecture is documented in
[Mutually Blind, Bounded Deliberation Rooms](04-MUTUALLY-BLIND-BOUNDED-DELIBERATION-ROOMS.md).
