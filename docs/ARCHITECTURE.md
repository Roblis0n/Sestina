# Architecture overview

Sestina separates research authority from presentation, persistence, model
execution, and host integration.

This document describes the shipped `v0.2.0` architecture. The accepted
[post-0.2 target architecture](product/restructure/README.md) replaces the
future implementation direction where it conflicts with this baseline, but it
must remain labelled as target behavior until its full migration, production,
security, lifecycle, and release evidence passes.

## Layers

1. **Research domain** — Briefs, Decisions, Issues, Evidence, Episodes,
   Reviews, Appeals, Deliberation Rooms, and governed project memory.
2. **Application Core** — use cases, Authority Gate, Context Manifest binding,
   deterministic receipts, recovery orchestration, and project isolation.
3. **Ports and adapters** — SQLite storage, OS secret stores, optional Provider
   clients, read-only MCP, CLI, and host launchers.
4. **Research Room** — the loopback HTTP server and typed React client. The
   client renders Core projections and sends explicit commands; it does not
   derive authority or semantic truth.

## Principal flows

### Local deterministic review

The user opens a project, activates a versioned Brief, submits a candidate, and
receives deterministic checks against scope, evidence boundaries, repeated
audit, and research-object state. The user then records the disposition. No
network connection is required.

### Optional Provider review

The user configures a Provider in the application-level secure store, generates
an exact Context Manifest, inspects included/excluded fields and limits, and
confirms that request. Provider output is decoded into a strict non-authoritative
assessment. Core derives the safe projection; the user alone records a
disposition.

### Persistence and recovery

Project state lives under `.sestina` in SQLite with numbered forward migrations.
Backups use managed IDs, hashes, strict manifests, integrity checks, and
project/schema binding. Restore is staged and verified before replacing active
state. A failed or future migration preserves existing files and fails closed.

### External hosts

The public stdio MCP exposes two read-only tools and one read-only Resource. A
host may receive a frozen, explicitly confirmed Context payload. It cannot write
Decisions, Issues, Reviews, or any other authority state, and there is no
automatic retry or fallback.

For enforceable import rules, see
[dependency and authority boundaries](architecture/01-DEPENDENCY-RULES.md).

## Opt-in post-0.2 persistence foundation

G1–G3 add schema 25 behind explicit Core entry points. Existing production opens
still use schema 20, and the old runtime refuses a target database as too new.
`ResearchUnitOfWork.kernel` extends the same SQLite transaction and repositories:
canonical objects, state head/event, terminal Review, Receipt, command identity
and derived outbox commit together. Draft Reviews, Provider attempts, assessments,
corrections and Manifests are durable workflow records and do not themselves
advance research state. Receipt and revision Trace are proofs of resulting objects.

Single-transaction reads produce validated canonical snapshots; context and
search/attention/Brief-file projections have explicit policy/source revisions.
Core owns the copied migration, maintenance fence, verified backup and explicit
recovery orchestration. No new renderer, transport or model write path is added.
The six complete effect handlers and Provider orchestration remain G4/G5 work.
See [operations and the exact G4 continuation](product/restructure/G1-G3-OPERATIONS.md).
