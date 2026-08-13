import type { Migration } from "../migrator.js";
import type { StorageDatabase } from "../connection.js";

// ── Maintenance lock fencing (docs/17 §3.2, docs/29 §9) ──
// Adds the per-acquisition fencing token so a stale holder can never renew
// or release a lock that was taken over (ABA-safe). Additive only: 001/002
// semantics are untouched.
const SQL = `
ALTER TABLE maintenance_locks ADD COLUMN fence_token TEXT;
`;

export const migration003: Migration = {
  version: 3,
  name: "003-maintenance-fencing",
  up(db: StorageDatabase): void {
    db.exec(SQL);
  },
};
