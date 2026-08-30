# UI-02 Research Object Workspaces Architecture

> Status: `implemented_and_verified`
> Scope: current-project continuity inside the production Research Room
> Projection schema: `1.0.0`
> Authority: Kernel / Store; the browser and loopback server are non-authoritative adapters

## 1. Product boundary

UI-02 turns the long-lived research objects already owned by the Research Deliberation Kernel into recoverable production workspaces. It does not introduce a second App shell, a Room event store, a chat history, a search index over ordinary project files, or a new model capability.

The production data flow remains one-way:

```text
Kernel / project-bound Store
  -> versioned read projection
  -> loopback safe envelope
  -> exact runtime decoder
  -> React workspace / Inspector
```

Every mutation takes the reverse route only as an explicit command:

```text
confirmed user command
  -> opened-project binding + exact request validation
  -> Core Authority Gate + expected version
  -> Store transaction
  -> fresh read projection
  -> React rerender
```

React never predicts a successful authority transition. The server never implements Decision or Issue state machines. A successful response is always rebuilt from Core after the command.

## 2. Read projections

`ResearchObjectWorkspaceService` in `@sestina/core` is the single projection layer for:

- Project Overview: active Brief, current Episode, latest committed Receipt, unresolved work, object counts, Provider mode, and the current minimum task;
- Research Brief: complete active version, pending candidate, field-level diff, impact preview, and bounded version history;
- Decision: bounded summaries plus a full detail projection with status history, source, scope, Brief binding, reopen conditions, and supersession lineage;
- Issue: bounded summaries plus detail with status history, source, evidence/waiver/reopen state, and related object links;
- canonical Evidence: current or invalidated evidence with source binding and one-hop relations; ordinary files are not imported or scanned;
- Episode: bounded summaries plus current-task, artifact/revision, review, Decision, Issue, and Receipt relations;
- Receipt: disposition, state bindings, rollback state, trace, and linked research objects;
- Search: current-project matching over structured projection fields only;
- Attention: a deterministic, rebuildable projection of unresolved/stale/pending states plus explicit transient in-memory signals.

Every projection carries schema version `1.0.0` and the opened `projectId`. Lists are sorted deterministically and returned through project-bound opaque cursors. The cursor binds the object kind, filters, ordering, and project; a cursor from another project or query fails closed. List limits are 1 through 200, while the UI requests small pages and appends only after an explicit user action.

The list surface intentionally remains compact. IDs, provenance, relations, histories, reasons, state bindings, and legal actions live in the selected detail projection so a large ledger does not create an unbounded DOM.

## 3. HTTP and client boundary

The loopback server exposes read-only routes under `/api/project`:

- `/overview` and `/brief`;
- `/decisions`, `/issues`, `/evidence`, `/episodes`, and `/receipts` with bounded filters and cursors;
- the same five ledgers with `/:id` detail routes;
- `/search` with an explicit query, limit, and cursor;
- `/attention` with no caller-defined authority state.

Unknown query keys, invalid booleans, out-of-range limits, oversized queries/cursors, malformed IDs, cross-project IDs, corrupt rows, and malformed response keys are rejected. `client/src/api/client.ts` remains the only browser `fetch` facade, and `client/src/api/decoders.ts` checks exact runtime shapes before product components receive data.

The browser route encodes the selected workspace and optional object ID. Direct links, reload, browser Back, and Forward restore the same projection. A project change clears selected object state and uncommitted UI drafts so one project cannot leak into another.

## 4. Authority commands

UI-02 exposes only existing user-authority operations:

- propose and activate a Brief candidate;
- record a proposed Decision, then accept, reject, freeze, or supersede it;
- resolve an Issue with current canonical Evidence, waive it with scope and invalidation condition, dispute it, or reopen it with explicit context;
- roll back a compatible Research Room Receipt.

All command envelopes are exact-key requests bound to the currently opened project, `commandType`, `confirmed: true`, a non-empty reason, a user actor, and the expected object version. Commands with stale versions, illegal transitions, missing canonical Evidence, wrong project IDs, or incomplete confirmations are rejected without an optimistic browser write.

Legal Decision and Issue actions are projected by Core from current domain state. The client displays those actions; it does not derive the transition table.

## 5. Brief activation consistency

A pending Brief candidate is not active state. Activation first validates user authority, proposal identity, and the expected Brief aggregate version. Within the Core unit of work it compare-and-swaps the Brief, exports the accepted version, and invokes a constrained publication adapter.

The Research Room publisher stages the new YAML next to `.sestina/research-brief.yaml`, moves the old projection to a unique backup, and atomically renames the staged file into place. If the Store transaction cannot commit, the adapter restores the old file. If staging or publication fails, Core returns `projection_write_failure` and does not report success. Cleanup failure after both authoritative state and the new YAML agree is recoverable and is not misreported as a failed activation.

## 6. Failure, isolation, and privacy

- One corrupt ledger fails with a stable safe projection error; independently readable workspaces remain available. Corrupt authority-bearing rows are never guessed into a valid default.
- Provider absence does not affect local object reading or user-authority commands. Review remains explicitly `ledger_only`.
- Offline server loss produces a recovery state; previously committed project data is not replaced with browser state.
- Rollback conflict after a newer mutation leaves the Receipt committed and performs no partial reversal.
- Search never reads ordinary files, other projects, browser history, credentials, Provider raw responses, or hidden reasoning.
- Attention dismissal is not a domain transition. Persistent attention is rebuilt from canonical objects; transient signals live only in the opened App session.
- No route adds telemetry, background upload, remote font, CDN, cross-project search, or filesystem crawling.

## 7. Verification contract

The implementation is covered by Core projection/authority tests, HTTP and decoder boundary tests, route-state tests, and production Edge browser scenarios. The stress fixture creates 5,000 Decisions and 1,000 Issues to verify deterministic cursor paging and bounded rendering. Browser coverage includes the complete object workflow, direct-link/reload/history recovery, two-project isolation, a disk-only search canary, no-Provider and offline modes, stale Brief activation, a corrupt Evidence ledger, rollback conflict, and the existing RI-48 flow.

Visual and accessibility coverage uses Light, Dark, and vivid High Contrast; zh-CN and English; 1280×800, 1440×900, and 1728×1117 viewports; reduced motion/transparency; keyboard focus, Inspector focus trap/Escape/focus restoration; and real 200% text reflow with horizontal-overflow checks. Generated screenshots are test artifacts and are not source-of-truth product data.

These checks prove implementation and host behavior. They do not prove real Provider quality, external adoption, market demand, or a real second use.
