# Project-level Governed Working Memory and Recovery Continuity

> Status: `implemented_and_verified`
> Task: `RI-51`
> Schema: `019`
> Authority class: `working_memory_non_authoritative`

## 1. Purpose and invariant

RI-51 adds a small, governed continuity layer for one research project. It lets a user retain terms, working hints, resume notes, and bounded worksets without turning those notes into research truth.

The governing invariant is:

```text
Project Authority State != Project Working Memory
saved != recalled
recalled != shared
shared != authoritative
```

Briefs, Decisions, Issues, Evidence, Episodes, Findings, Appeals, Deliberation Rooms, Resolutions, Receipts, and their state machines remain Kernel-owned authority objects. Working Memory can point to those objects and can help the user resume work, but it cannot mutate, accept, resolve, close, waive, or replace them.

## 2. Architecture boundary

```text
direct user input or explicit canonical-object pin
  -> typed loopback API command
  -> SestinaCore / ProjectMemoryService
  -> project-working-memory domain aggregate
  -> ResearchStore transaction (schema 019)
  -> runtime-decoded ProjectMemoryProjection
  -> Research Room /project/memory

explicit eligible selection in Review
  -> request-scoped memory Manifest preview
  -> user confirmation
  -> immediate revalidation and consumption
  -> existing Review Context Manifest
  -> existing Provider adapter request
```

- The browser never owns a memory state machine and never treats an optimistic action as committed.
- The loopback server validates exact command shapes, binds every command to the opened project, and delegates to Core.
- `ProjectMemoryService` owns lifecycle, source reconciliation, retention, resume-diff, and request-scoped Manifest rules.
- The domain package owns finite types, transitions, user-actor checks, CAS versions, limits, tombstones, and deterministic checkpoint comparison.
- The store owns project-scoped persistence, transactions, strict decoding, pagination, and corruption failure.
- Provider adapters receive only the already confirmed payload attached to the existing Review request; they cannot search, promote, recall, or edit memory.

## 3. Finite domain model

### 3.1 Kinds, states, retention, and outbound policy

| Dimension | Values | Contract |
|---|---|---|
| Kind | `term`, `working_hint`, `resume_note`, `workset` | No chat transcript, hidden reasoning, generic document store, or vector memory kind |
| State | `candidate`, `active`, `stale`, `expired`, `retired`, `forgotten` | Recall requires current-project `active`; invalid or unknown state fails closed |
| Retention | `current_episode`, `until_date`, `until_unpinned` | Expiry is determined by Kernel time and source/episode state |
| Sensitivity | `public`, `project_private`, `sensitive`, `secret_never_send` | Sensitivity is re-evaluated at request preparation and consumption |
| Outbound | `never_send`, `explicit_manifest_only` | `never_send` is the default; no `always_send` mode exists |
| Authority | `working_memory_non_authoritative` | Fixed; no promotion path to Project Authority State |

The implementation enforces bounded content (16 KiB), bounded workset references (64), bounded active items (200), bounded checkpoint bindings (400), and keyset/cursor pagination.

### 3.2 Lifecycle

Only a direct user actor may create, confirm, edit, renew, retire, or forget an item.

```text
create/pin -> candidate
candidate --user confirmation--> active
active --edit--> candidate --user confirmation--> active
active --source drift--> stale
active --retention elapsed--> expired
candidate|active|stale|expired --user retire--> retired
live item --user types FORGET--> forgotten tombstone
```

- Editing returns an item to `candidate`; the edited content is not recalled or sent until a second explicit confirmation.
- Source reconciliation is idempotent. An already-stale item is not version-bumped on every read.
- CAS `expectedVersion` rejects stale writers; there is no last-write-wins path.
- `semantic_conflict_unchecked` is an honest presentation fact. RI-51 does not run a model and does not pretend to detect semantic conflict.

### 3.3 Source binding

An item has either a direct-user source or a frozen project-object source containing object kind, object id, source version, and content fingerprint. Canonical-object pinning resolves the object through Core and rejects another project's object. A changed version, changed fingerprint, or unavailable source marks the item stale and removes recall/Manifest eligibility.

## 4. Deterministic Resume Checkpoint

`ResumeCheckpoint` records the project version, the visible authority-object bindings, and working-memory id/version/state bindings the user has reviewed. A later projection computes only deterministic `added`, `updated`, and `removed` differences.

- It is `resume_checkpoint_non_authoritative`.
- It does not contain an LLM summary.
- It cannot accept or resolve an authority object.
- It survives process restart through the project store.
- Reopening without changes produces a stable `current` result rather than invented progress.

## 5. Request-scoped Context Manifest

### 5.1 Default zero

Every Review starts with zero selected memory items. Saving or confirming an item never causes automatic recall or external sending. Only the user's current selection is considered.

### 5.2 Eligibility and sensitivity

An included item must be from the opened project, current `active`, unexpired, source-current, and `explicit_manifest_only`.

| Provider binding | Permitted sensitivity |
|---|---|
| No Provider | No network; preview remains local / `ledger_only` |
| Deterministic fixture or local Provider | `public`, `project_private` |
| External Provider | `public` only |
| Any Provider | `sensitive` and `secret_never_send` excluded |

Exclusion reasons are structured and visible, including candidate, stale, expired, retired/forgotten, `never_send`, sensitivity, missing item, duplicate selection, and project mismatch.

### 5.3 Confirmation and consumption

The manifest binds exact item ids, versions, content hashes, source, sensitivity, project-state hash, Provider id/kind/config hash, payload hash, confirmation nonce, and a 15-minute expiry. It is deliberately process-local rather than persisted.

Confirmation and consumption both re-read canonical state. Any content/version, source, project-state, Provider, config, hash, nonce, or expiry drift fails closed. Restart invalidates an unconsumed confirmation. Review immediately consumes the confirmed memory manifest before calling the existing Provider adapter, and attaches the exact memory payload and manifest identity to the existing Review Context Manifest and Receipt projection.

## 6. Deletion, exports, and copies

Irreversible forget removes the content, source details, content fingerprint, sensitivity, outbound policy, and recovery material from Sestina's current managed memory row. The remaining tombstone contains only project scope, opaque operation identity/nonce, state, version, time, and the fact that an irreversible forget was recorded.

This guarantee does not reach copies outside the current managed row. A previous confirmed Provider request, its Receipt, an ordinary manual export, or an old backup may retain a copy. The UI states this before confirmation. Restore cannot resurrect forgotten content from the current database because the row no longer contains it.

Ordinary report and Capsule exports do not enumerate or serialize the new memory table. RI-51 adds no automatic export, upload, telemetry, cloud sync, or background scan.

## 7. Production projection and canonical navigation

`ProjectMemoryProjection` presents, in order:

1. Kernel-authoritative Project State;
2. deterministic Resume status and changes;
3. non-authoritative Working Memory with legal actions supplied by Core;
4. memory-related Attention entries;
5. source, retention, policy, hashes, and transitions for Inspector.

The canonical route is `/project/memory`. Overview/Resume, object pin actions, Search, Attention, Inspector, deep links, refresh, and restart all resolve to that same projection. Search and Attention remain entry points and do not persist a second copy of memory state.

## 8. Security and failure behavior

- Project ids and source objects are rebound in Core and Store; cross-project data is rejected rather than filtered after loading.
- Unknown enums, malformed JSON, invalid ids, corrupt tombstones, and over-limit collections fail closed.
- Transactional writes and CAS prevent partial lifecycle commits.
- No Provider configuration leaves the complete local lifecycle available and keeps external attempts at zero.
- A failed or cancelled Provider operation does not consume an unconfirmed selection and cannot promote Provider output into memory.
- Secrets, Provider raw envelopes, project paths, and hidden reasoning are never fields in the memory aggregate or manifest payload.

## 9. Explicit non-scope

RI-51 does not implement cross-project memory, personal/global research memory, procedural learning, automatic promotion, automatic recall, chat summarization, transcript import, embeddings, semantic/vector search, Provider retry/fallback, Participant private-state promotion, RI-52, external Pilot execution, cloud sync, telemetry, or a new authority state machine.

## 10. Evidence boundary

Domain, migration, store, Core, API, browser E2E, and production visual checks prove implementation and host behavior. The configured deterministic fixture proves one exact adapter request, not real model semantics. With no user-provided real Provider configuration, real Provider smoke remains `blocked_missing_user_config`. Real second-use recovery value and external-user value remain `unproven`.
