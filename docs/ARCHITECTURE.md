# Architecture overview

Sestina separates research authority from presentation, persistence, model
execution, and host integration.

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
