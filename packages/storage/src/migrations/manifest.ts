import { migration001 } from "./001-initial.js";
import { migration002 } from "./002-fts.js";
import { migration003 } from "./003-maintenance-fencing.js";
import { migration004 } from "./004-activity-stream.js";
import { migration005 } from "./005-leases-and-sequence.js";
import { migration006 } from "./006-retention-snapshot.js";
import { migration007 } from "./007-keyset-indexes.js";
import { migration008 } from "./008-notification-project.js";
import { migration009 } from "./009-project-scope.js";
import { migration010 } from "./010-lookup-indexes.js";
import { migration011 } from "./011-correction-indexes.js";
import { migration012 } from "./012-evidence-ledger.js";
import { migration013 } from "./013-research-core.js";
import { migration014 } from "./014-review-runs.js";
import { migration015 } from "./015-argument-graph.js";
import { migration016 } from "./016-research-room.js";
import { migration017 } from "./017-correction-appeals.js";
import { migration018 } from "./018-deliberation-rooms.js";
import { migration019 } from "./019-project-working-memory.js";
import { SESTINA_MIGRATION_MANIFEST } from "@sestina/schema";
import type { Migration } from "../migrator.js";

// ── Ordered migration manifest (docs/22 Task 5: migrations/{001,002,manifest}) ──
// Forward-only: each migration must be idempotent so a failed run can be
// retried after repair (docs/19 §5.4).
const IMPLEMENTATIONS: readonly Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
  migration010,
  migration011,
  migration012,
  migration013,
  migration014,
  migration015,
  migration016,
  migration017,
  migration018,
  migration019,
];

export const MIGRATION_MANIFEST_VERSION = SESTINA_MIGRATION_MANIFEST.schemaVersion;
export const MIGRATIONS: readonly Migration[] = SESTINA_MIGRATION_MANIFEST.migrations.map((entry, index) => {
  const migration = IMPLEMENTATIONS[index];
  if (migration?.version !== entry.version || migration.name !== entry.name) {
    throw new Error("Migration manifest does not match its implementation.");
  }
  return migration;
});

/** Highest schema version this runtime understands. */
export const SCHEMA_VERSION: number = MIGRATIONS.reduce(
  (max, migration) => Math.max(max, migration.version),
  0,
);
