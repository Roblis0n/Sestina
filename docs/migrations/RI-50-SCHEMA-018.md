# RI-50 schema 018 — Deliberation Rooms

Status: `implemented_and_verified`

Migration 018 is the next sequential project-database migration after RI-49
schema 017. It adds one RI-50-specific aggregate table; it does not rewrite any
earlier migration or introduce a general chat/event database.

## Added table

`deliberation_rooms`

| Column | Contract |
|---|---|
| `room_id` | primary key, canonical `rdlr_…` ID |
| `project_id` | required `rprj_…` ID and foreign key to `research_projects` |
| `source_kind` | constrained RI-50 legal source kind |
| `source_object_id` | frozen source object ID |
| `status` | constrained canonical Room lifecycle status |
| `version` | positive CAS version |
| `source_hash` | lowercase 64-character SHA-256 binding |
| `created_at` / `updated_at` | canonical timestamps |
| `data` | JSON-valid serialized canonical aggregate |

The table is `STRICT`. It has a compound project/Room uniqueness constraint and
rejects malformed IDs, status values, versions, hashes, or JSON at the database
boundary.

## Indexes

- `idx_deliberation_rooms_one_active_source` permits only one non-terminal Room
  for one project/source binding;
- `idx_deliberation_rooms_project_updated` supports bounded project history;
- `idx_deliberation_rooms_project_status` supports Attention/status projection;
- `idx_deliberation_rooms_source_history` preserves source lineage lookup.

## Transaction and recovery rules

- repository create/update executes inside the existing local project database
  transaction and checks expected Room version;
- a failed migration or failed write leaves no half-created assessment,
  Difference, Resolution, or Receipt;
- migration 018 is idempotent under the migrator contract and the migration
  manifest reports schema version 18;
- active calls recovered after process interruption become explicit
  unknown/interrupted results; migration never treats an external call as
  successful;
- project deletion, silent cleanup, or removal of source objects is not added by
  this migration.

Verification lives in `packages/storage/test/migrations-018.test.ts` and
`packages/research-store/test/deliberation-room-store.test.ts`. These tests prove
schema and repository behavior, not real Provider value.
