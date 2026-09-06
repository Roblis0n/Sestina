# Post-0.2 implementation status

- **Status authority:** this record reports the boundary between the shipped
  `v0.2.0` implementation, the completed G0 contract freeze, the authorized
  opt-in G1–G3 foundation, and work assigned to downstream gates.
- **Code-fact baseline:**
  `08bd5f29cd59e39f06a7de6d261aa84f73a5bc63`, whose product code is the
  `v0.2.0` release tree plus the accepted restructure authority.
- **Product authority:** `docs/product/restructure/README.md` and the accepted
  18-file plan set it indexes.
- **G0 result:** `completed_and_verified`. G0 freezes contracts and code facts;
  it does not implement the target runtime, schema, routes, Electron shell, or
  release.
- **Excluded evidence:** external trial feedback, adoption, market evidence,
  and Provider semantic quality are not inputs to this product-only status.

## 1. Evidence classes used by this record

| Classification        | Exact meaning                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| `current_implemented` | Behavior exists in the baseline production tree and is supported by cited code or tests.                 |
| `current_partial`     | Reusable implementation exists, but the accepted target contract is not complete.                        |
| `verified_absent`     | The G0 code review found that the named target capability or bypass does not exist in the baseline tree. |
| `g0_frozen`           | The target decision is accepted and machine-readable, but is not a shipped capability.                   |
| `downstream_gate`     | Implementation belongs to the named G1-G13 dependency gate.                                              |
| `not_established`     | Available evidence cannot support the claim.                                                             |

These classifications are not interchangeable. In particular, `g0_frozen`
must never be presented as `current_implemented`, and a deterministic Receipt
or hash is not evidence that a research claim is true.

## 2. G0 deliverables

| Deliverable                                    | Status                   | Scope                                                                                                      |
| ---------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `IMPLEMENTATION-DECISIONS.md`                  | `g0_frozen`              | Human-readable decisions, invariants, and G1 dependency boundary.                                          |
| `contracts/01-canonical-effects.json`          | `g0_frozen`              | Six typed effect kinds and common Authority, revision, Receipt, Trace, failure, and idempotency rules.     |
| `contracts/02-review-lifecycle.json`           | `g0_frozen`              | Persistent Review states, guarded transitions, recovery, correction, and terminal traceability.            |
| `contracts/03-project-state-revision.json`     | `g0_frozen`              | Monotonic revision policy and same-transaction Receipt/Trace binding.                                      |
| `contracts/04-context-manifest-identity.json`  | `g0_frozen`              | Deterministic projection, exact request identity, send-time revalidation, and stale behavior.              |
| `contracts/05-legacy-mapping.json`             | `g0_frozen`              | Current-to-target mapping for all 15 required legacy concepts.                                             |
| `contracts/06-route-map.json`                  | `g0_frozen`              | Task-first routes, object access, Authority locations, recovery, and legacy disposal.                      |
| `contracts/07-terminology.json`                | `g0_frozen`              | Canonical terms, claim levels, forbidden conflations, and status-word conditions.                          |
| `contracts/08-requires-code-verification.json` | `completed_and_verified` | CV-01 through CV-07 with closed findings and repository-relative evidence.                                 |
| `scripts/verify-post-0.2-contracts.mjs`        | `current_implemented`    | Deterministic structural, cross-contract, evidence-path, and forbidden-content validator for G0 artifacts. |
| `tests/repository/post-0.2-contracts.test.ts`  | `current_implemented`    | Positive and negative tests for the G0 validator.                                                          |

The numeric contract filenames are intentional. They freeze dependency and
review order without changing contract identifiers; tools must use the
machine-readable `id` and `schemaVersion` fields rather than infer semantics
from filenames.

## 3. Historical G0 code facts versus accepted target

This section and the closed CV findings below preserve the G0 baseline audit.
They do not describe the later opt-in implementation; section 5 and the linked
execution evidence report that work without changing the frozen audit inputs.

| Area                 | Baseline fact                                                                                                                       | G0 target decision                                                                                                   | Implementation status                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Canonical transition | Existing Core commands and Research Room disposition flows are not one typed-effect pipeline.                                       | Exactly six `CanonicalEffect` kinds flow through one Kernel transition.                                              | `g0_frozen`; production handler work is downstream.                                 |
| Authority            | Core checks user/model authority in existing commands; MCP is read-only.                                                            | Only a user can commit an effect; Provider and host output remain proposals.                                         | Boundary is `current_partial`; unified effect enforcement is downstream.            |
| Review               | Interactive Research Room state uses in-memory maps and persists terminal Receipts.                                                 | `ResearchReview` is persistent, versioned, recoverable, and never automatically resends uncertain Provider attempts. | `verified_absent` as a complete target aggregate; implementation is downstream.     |
| Revision             | Object repositories have object-version compare-and-swap.                                                                           | One monotonic `projectStateRevision` advances once per canonical transaction.                                        | `verified_absent` as a project-wide head/event chain; implementation is downstream. |
| Context Manifest     | Research Room already creates version- and hash-bound context records.                                                              | Preview and outbound bytes share exact identity and are recomputed before network I/O.                               | `current_partial`; target identity is `g0_frozen`.                                  |
| Evidence             | Two Evidence representations exist; production has no single Evidence creation command.                                             | `argument_evidence` is the only canonical aggregate and `add_evidence` is its only production writer.                | Current multiplicity is verified; target writer is downstream.                      |
| Brief threshold      | Brief has stages and free-text evidence-boundary rules.                                                                             | Typed Evidence thresholds remain distinct from provenance and support status.                                        | Typed threshold is `verified_absent`; target contract is frozen.                    |
| Memory               | Project Memory is non-authoritative, project-scoped, and explicit-manifest-only.                                                    | Memory remains context, never Evidence; forget gains copy inventory and restore protection.                          | Boundary is `current_partial`; backup/redaction coverage is downstream.             |
| Migration            | Forward in-place migrations have a DB journal, transactions, and hashed backups; restore has a staged atomic swap.                  | Migration becomes copy-on-write with external maintenance recognition, full validation, and no dual write.           | Building blocks are `current_partial`; target migration pipeline is downstream.     |
| Provider security    | Configuration rejects unsafe literal endpoints, redirects fail, retries are disabled, and secrets fail closed to OS secure storage. | Connect-time DNS/address binding, explicit proxy policy, and Electron IPC threat controls are required.              | Current safeguards are implemented; remaining target controls are downstream.       |
| Primary interface    | `v0.2.0` is a loopback Research Room preview.                                                                                       | The target is an Electron Desktop App with Today/Review, Project, Search, and Settings.                              | Target distribution and route replacement are not implemented.                      |
| Legacy Room/Pilot    | Current records and flows exist in the release baseline.                                                                            | Active paths become read-only history, export, and recovery sources.                                                 | Mapping is frozen; cutover is downstream.                                           |
| Agent Corrector      | Not present in the baseline tree; it exists only on a separate post-release branch.                                                 | Companion Skill, ephemeral by default, explicit handoff to Review, no Authority.                                     | `verified_absent` in this branch; integration is assigned to G7.                    |

## 4. Closed code-verification findings

| ID    | Final status        | Closed fact                                                                                                                                         | Consequence                                                                                  |
| ----- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| CV-01 | `verified_multiple` | Two Evidence representations exist and there is no unique production Evidence write entry.                                                          | Freeze `argument_evidence` as canonical; legacy ledgers stay read-only and never dual-write. |
| CV-02 | `verified_multiple` | Shared database transactions, Unit of Work, and object CAS exist; project-wide revision plus persistent Review atomicity does not.                  | Extend the existing transaction boundary rather than create a second persistence path.       |
| CV-03 | `verified_absent`   | Provenance and Brief threshold are not conflated; a typed Brief threshold enum is also absent.                                                      | Add a distinct threshold contract without inventing a migration quality grade.               |
| CV-04 | `verified_absent`   | Memory does not duplicate canonical Evidence or Decision bodies; complete copy inventory and restore-redaction protection are absent.               | Preserve non-authority and add bounded privacy accounting downstream.                        |
| CV-05 | `verified_absent`   | MCP/Skill cannot bypass Kernel Authority; Agent Corrector is absent from the baseline tree.                                                         | Keep MCP read-only and host/Skill outputs draft-only.                                        |
| CV-06 | `verified_multiple` | Migration journal, backup, and restore swap exist; migration itself is in-place and has no staging cutover.                                         | Build copy-on-write migration from existing verified restore primitives, with no dual write. |
| CV-07 | `verified_multiple` | Endpoint checks, redirect denial, loopback containment, and fail-closed secure storage exist; DNS pinning, proxy policy, and Electron shell do not. | Preserve current protections and add the missing controls at their assigned gates.           |

All seven entries set `unresolved=false`, retain `hasUnknownItems=false`, and
cite repository-relative code evidence. A `verified_absent` finding closes a
code-fact question; it does not claim the target capability is implemented.

## 5. Gate status

| Gate                                                | Status                   | Permitted result                                                                  |
| --------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------- |
| G0 — domain contract and terminology freeze         | `completed_and_verified` | The contracts in this directory are the implementation input for downstream work. |
| G1 — RED tests and immutable compatibility fixtures | `completed_and_verified` | Actual behavioral RED entries, pinned old-code fixtures and native test environments are implemented; later-gate RED remains explicit in [execution evidence](G1-G3-EVIDENCE.md). |
| G2 — schema and copy-on-write migration | `completed_and_verified` | Opt-in schema 25, verified copy migration and explicit recovery passed the public gate and native Windows x64, macOS arm64 and Linux x64 foundation/platform gates. |
| G3 — repositories, transaction and snapshots | `completed_and_verified` | Durable repositories, unified canonical transaction, revision/command identity and snapshots passed fault, process-death, race and native platform evidence. |
| G4–G13 | `not_started` | Full effect handlers, Provider orchestration, production interface and final cutover remain downstream. |

Completion evidence is the implementation tree at
`e08c760e0adcf63c1ea54b22103b903b5e17ec83`, verified on 2026-09-06 by
[CI run 34031380557](https://github.com/Roblis0n/Sestina/actions/runs/34031380557)
and the local checks documented in the execution record. No required G1–G3
verification remains blocked. The final status-only update does not change
that verified runtime. G4 begins at the [documented continuation](G1-G3-OPERATIONS.md).

G0 changes no production schema, runtime data, UI route, Provider behavior,
Electron lifecycle, legacy cutover, or release artifact. It creates an
executable specification and a verified baseline fact record only.

## 6. Claims that remain unavailable

The following remain `not_established`:

- Provider semantic accuracy or independence;
- external-user value or repeated-use value;
- adoption, market value, or commercial viability;
- production readiness of the target Electron application;
- final production data cutover and migration of real user projects;
- production UI acceptance for the target task-first interface.

The tables above describing the release are G0 baseline facts. The authorized
G1–G3 execution begins at `a4889ee996064d95ee0a3fb470ee6ee12d3a91a3`;
its current evidence is tracked in section 5 and in the execution record.
The shipped default continues to use schema 20. No production interface or
release has been switched to the opt-in schema-25 foundation.
