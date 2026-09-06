---
title: Accepted post-0.2 product restructure authority
authority_status: accepted_current_target
accepted_at: 2026-09-01
implementation_status: g1_g3_completed
baseline_release: v0.2.0
baseline_commit: caf893db7928bab91c4098eb04a7e4a8d4c62ffe
decision_owner: user
---

# Accepted post-0.2 product restructure authority

This directory is the current product and implementation-design authority for
work after Sestina `v0.2.0`. On 2026-09-01, the user accepted the complete
18-file restructure plan as one indivisible target, including decision D-10:
the target distribution is an Electron desktop application and the existing
`v0.2.0` archive remains accurately described as a local loopback research
server preview.

本目录是 Sestina `v0.2.0` 之后产品与实施设计的最新权威。用户已于
2026-09-01 接受完整的 18 份重构计划及 D-01 至 D-12 的全部裁决；这
表示目标已经批准，不表示代码已经实施。

## What this acceptance changes

- The exact plan artifact under
  [`Sestina-v0.2.0-完整重构计划集/`](Sestina-v0.2.0-完整重构计划集/)
  is now the accepted target design, rather than a proposal awaiting product
  approval.
- Statements inside that immutable artifact saying that the user still needs
  to approve the target are superseded by this acceptance record.
- The plan's `implementation_status: not_started` statements describe the
  accepted artifact at intake. Current execution evidence lives in
  [`IMPLEMENTATION-STATUS.md`](IMPLEMENTATION-STATUS.md); acceptance alone is
  not implementation evidence.
- Shipped `v0.2.0` behavior, installation instructions, release artifacts, and
  limitations remain current release truth until the complete target passes
  its production and release gates.
- External trial feedback, participant behavior, interviews, adoption, market
  evidence, Provider quality, and RI-55 are excluded from this product-only
  restructure authority. They cannot block it or be used to claim it works.

The plan files remain byte-for-byte unchanged so that
[`FILE-MANIFEST.md`](Sestina-v0.2.0-完整重构计划集/FILE-MANIFEST.md)
continues to verify their exact contents. This record changes their approval
status and precedence without rewriting the artifact or invalidating its
hashes. The non-normative evidence source is preserved separately as the
[`v0.2.0 adversarial product review`](Sestina-v0.2.0-对抗性产品审查.md).

## Normative product result

All post-0.2 implementation must converge on one causal loop:

```text
Suggestion
-> Persistent Review Draft
-> State-bound Context Projection
-> Exact Context Manifest
-> Optional Provider Assessment
-> User Canonical Effect Preview
-> User Authority
-> Atomic Canonical Mutation
-> Receipt / Trace as Proof
-> Search / Attention / Resume / Recovery
```

The following are non-negotiable:

1. The Research Deliberation Kernel is the only owner of canonical research
   transitions. The renderer, Provider, Host, Skill, MCP, Memory, Appeal,
   Deliberation Room, Pilot, and Receipt cannot create a second truth.
2. Only the user can commit a typed `CanonicalEffect`. Provider availability or
   assessment does not grant, remove, or substitute for user authority.
3. Canonical transactions are bound to a monotonic `projectStateRevision`;
   exact outbound bytes are separately bound by the Context Manifest and must
   be revalidated immediately before network I/O.
4. Interactive Reviews are persistent and recoverable. A crash must never
   cause an uncertain Provider attempt to be sent again automatically.
5. The primary information architecture is task-first: Today/Review, Project,
   Search, and Settings. Appeal is a correction inside Review; legacy Room and
   Pilot records are read-only history; Memory is contextual and is not
   Evidence.
6. The target is one complete Electron desktop product. There is no public
   half-state, alternate v1/v2 track, dual-write safety net, new UI connected to
   the old generic disposition path, or desktop shell containing a copied
   Kernel.
7. Migration is copy-on-write, legacy active workflows become read-only, and
   downgrade uses a verified pre-migration backup rather than reverse
   migration.
8. Product completion requires the full RED-to-production evidence matrix,
   packaged UI inspection, no-network/crash/concurrency/security/recovery
   evidence, and three-platform lifecycle/provenance. Fixtures, screenshots,
   hashes, and release integrity cannot prove semantic accuracy or product
   value.

## Authority and conflict resolution

Use the accepted corpus by responsibility, not by selecting one convenient
file in isolation:

- [`16-CROSS-PLAN-CONSISTENCY-AND-DECISION-LOG.md`](Sestina-v0.2.0-完整重构计划集/16-CROSS-PLAN-CONSISTENCY-AND-DECISION-LOG.md)
  resolves cross-plan conflicts and fixes decisions D-01 through D-12.
- [`00-MASTER-REFACTOR-PLAN.md`](Sestina-v0.2.0-完整重构计划集/00-MASTER-REFACTOR-PLAN.md)
  owns the overall product model and global invariants.
- Plans `01` through `12` own their respective domain, data, UI, lifecycle,
  migration, privacy, and security contracts.
- [`15-TERMINOLOGY-DOCS-AND-CLAIM-MIGRATION.md`](Sestina-v0.2.0-完整重构计划集/15-TERMINOLOGY-DOCS-AND-CLAIM-MIGRATION.md)
  owns user-visible terminology and claim levels.
- [`13-TEST-EVAL-AND-PRODUCTION-VERIFICATION.md`](Sestina-v0.2.0-完整重构计划集/13-TEST-EVAL-AND-PRODUCTION-VERIFICATION.md)
  owns what counts as completion evidence.
- [`14-IMPLEMENTATION-DEPENDENCY-AND-CHANGE-MAP.md`](Sestina-v0.2.0-完整重构计划集/14-IMPLEMENTATION-DEPENDENCY-AND-CHANGE-MAP.md)
  owns implementation order and cutover boundaries.
- `FILE-MANIFEST.md` proves artifact integrity only; it does not prove code or
  product completion.

If an implementation-time code check reveals a real contradiction, stop at
the affected dependency gate, update every impacted contract and the decision
log together, and preserve the single Kernel/Review/Authority/revision truth.
An isolated code change may not silently reinterpret the accepted product.

## Current execution entry

**G0 — domain contract and terminology freeze** from plan `14` is complete.
Its frozen decisions, machine-readable contracts, status boundary, and closed
code-fact checks are recorded in [`IMPLEMENTATION-DECISIONS.md`](IMPLEMENTATION-DECISIONS.md),
[`IMPLEMENTATION-STATUS.md`](IMPLEMENTATION-STATUS.md), and
[`contracts/`](contracts/). G0 closed every explicit
`requires_code_verification` item:

- choose the one canonical Evidence aggregate and write repository;
- prove the transaction/snapshot boundary shared by repositories and the
  Research Unit of Work;
- align Brief evidence-threshold enums with the canonical provenance model;
- inventory Memory copies in FTS, Manifests, Receipts, caches, temporary files,
  and managed backups;
- verify current Skill/MCP capabilities and remove any direct write or
  authority path;
- determine migration journal, transaction, Brief-file, staging, and atomic
  swap boundaries;
- verify Provider DNS/proxy/address controls, static asset path containment,
  and secure-store fallback behavior.

The user subsequently authorized G1–G3 together on `codex/post-0.2-g1-g3`,
starting from G0 commit `a4889ee`. The opt-in schema-25 implementation and
three-platform evidence are recorded in [G1–G3 evidence](G1-G3-EVIDENCE.md).
G1–G3 are completed and verified. The exact following G4 entry is in
[operations and continuation](G1-G3-OPERATIONS.md). G4–G13 remain unimplemented.
Agent Corrector integration, Electron packaging, route replacement, final
production cutover and release work retain their assigned downstream gates.

## Current release versus accepted target

| Classification                  | Meaning                                                                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Current in v0.2.0**           | Behavior and artifacts demonstrably present at tag `v0.2.0` / commit `caf893d`                                                                            |
| **Accepted target design**      | The complete approved plan set; gate-specific implementation evidence is tracked separately in the status record                                        |
| **Legacy compatibility**        | Existing Room, Pilot, generic disposition, and related data retained only for migration, read-only history, export, and recovery where the plan specifies |
| **Verified in a later release** | A target capability only after its implementation, migration, production UI, security, lifecycle, and release evidence all pass                           |
| **Not established**             | Provider semantic accuracy, cognitive independence, external-user value, repeated-use value, adoption, and market value                                   |

No document may promote an accepted target to a current capability without the
evidence required by plan `13` and the cutover order in plan `14`.
