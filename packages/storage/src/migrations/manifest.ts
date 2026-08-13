import { migration001 } from "./001-initial.js";
import { migration002 } from "./002-fts.js";
import { migration003 } from "./003-maintenance-fencing.js";
import { migration004 } from "./004-activity-stream.js";
import type { Migration } from "../migrator.js";

// ── Ordered migration manifest (docs/22 Task 5: migrations/{001,002,manifest}) ──
// Forward-only: each migration must be idempotent so a failed run can be
// retried after repair (docs/19 §5.4).
export const MIGRATIONS: readonly Migration[] = [migration001, migration002, migration003, migration004];

/** Highest schema version this runtime understands. */
export const SCHEMA_VERSION: number = MIGRATIONS.reduce(
  (max, migration) => Math.max(max, migration.version),
  0,
);
