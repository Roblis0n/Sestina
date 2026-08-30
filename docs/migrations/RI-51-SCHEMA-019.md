# RI-51 Schema 019 — Project Working Memory and Resume Checkpoints

> Status: `implemented_and_verified`
> Migration: `019-project-working-memory`
> Previous schema: `018`

## 1. Scope

Schema 019 persists only two project-bound concepts required by RI-51:

- `project_working_memory`: governed, non-authoritative working-memory rows and irreversible tombstones;
- `resume_checkpoints`: user-reviewed deterministic project/memory version bindings.

It does not persist request-scoped Context Manifests. Those manifests have a 15-minute lifetime and are intentionally process-local so restart invalidates a pending confirmation.

## 2. Tables and constraints

### `project_working_memory`

| Column | Purpose and constraint |
|---|---|
| `item_id` | Primary key; must use `rmem_` identity |
| `project_id` | Required `rprj_` identity and foreign key to `research_projects` |
| `kind` | Finite memory kind for live rows; `NULL` for forgotten rows |
| `status` | Finite lifecycle state |
| `version` | Positive CAS version |
| `outbound_policy` | `never_send` or `explicit_manifest_only` for live rows; `NULL` after forget |
| `expires_at` | Optional expiry index field |
| `source_object_id` / `source_object_version` | Optional project-object source index fields; cleared after forget |
| `created_at` / `updated_at` | Deterministic UTC lifecycle ordering |
| `data` | Strictly decoded JSON aggregate or minimal tombstone |

The table-level check requires forgotten rows to have no kind, outbound policy, expiry, or source binding. All other states require a finite kind and outbound policy.

Indexes support project+updated keyset listing, project+state+expiry governance, and current-project source reconciliation.

### `resume_checkpoints`

| Column | Purpose and constraint |
|---|---|
| `checkpoint_id` | Primary key; must use `rmcp_` identity |
| `project_id` | Required project foreign key |
| `project_version` | Positive reviewed project version |
| `version` | Positive checkpoint version |
| `reviewed_at` | UTC ordering for latest checkpoint lookup |
| `data` | Strictly decoded bounded authority/memory binding set |

The project+reviewed index supports deterministic latest-checkpoint recovery.

## 3. Transaction and compatibility behavior

- Migration 019 is additive; it does not rewrite existing Research Room authority objects, receipts, manifests, Provider configuration, or schema 018 data.
- Migration runs in the existing migration transaction. Failure leaves the prior schema intact.
- Repository writes bind `project_id`, validate the decoded aggregate, and use `expectedVersion` CAS inside a transaction.
- Project list operations use bounded keyset/cursor pagination; malformed or cross-project cursors fail closed.
- Restore opens the same schema and decoder. A forgotten tombstone cannot be decoded into a live item because its content and source fields are absent.
- Ordinary report/Capsule exports remain driven by their existing explicit schemas and do not enumerate either RI-51 table.

## 4. Verification

Migration tests prove:

- clean 018 -> 019 application and manifest registration;
- strict table and index creation;
- no persisted `project_memory_manifests` table;
- live-row and forgotten-row check constraints;
- foreign-key project binding;
- repository persistence across reopen;
- CAS conflict, keyset pagination, project isolation, and corrupt-row failure;
- forgotten content/source/fingerprint cannot be reconstructed from the current row.

The no-manifest-table assertion began as a failing test after an unused persisted manifest table was identified; the DDL was then reduced to the two concepts that must survive restart.

## 5. Rollback and recovery boundary

There is no destructive automatic down migration. Before using an older build, make a normal project backup using the existing documented local workflow. Schema 019 does not promise deletion from old backups: an old backup created before forget can still contain a historical copy. Current managed state and normal forward restore cannot revive content from a schema-019 forgotten tombstone.
