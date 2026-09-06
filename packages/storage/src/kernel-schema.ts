import type { Migration } from "./migrator.js";
import { MIGRATIONS } from "./migrations/manifest.js";
import type { StorageDatabase } from "./connection.js";

/** G2 opt-in target. The shipped Research Room still opens schema 20. */
export const KERNEL_SCHEMA_VERSION = 25;
export const KERNEL_CANONICAL_TABLES = [
  "research_projects",
  "research_artifacts",
  "artifact_revisions",
  "research_briefs",
  "research_decisions",
  "research_decision_transitions",
  "research_issues",
  "research_issue_transitions",
  "revision_episodes",
  "research_snapshots",
  "argument_claims",
  "argument_evidence",
  "argument_mechanism_links",
  "argument_claim_evidence_links",
  "argument_mechanism_evidence_links",
  "argument_deltas",
  "project_working_memory",
  "research_project_state_heads",
  "research_project_state_events",
  "research_transition_receipts",
  "research_authority_commands",
  "research_brief_metadata",
  "research_memory_metadata",
  "research_privacy_redactions",
] as const;
export const KERNEL_WORKFLOW_TABLES = [
  "research_reviews",
  "research_provider_attempts",
  "research_review_corrections",
  "context_manifests",
  "research_projection_outbox",
  "research_projection_metadata",
  "research_copy_inventory",
  "research_resume_metadata",
] as const;
export const KERNEL_LEGACY_TABLES = [
  "research_room_receipts",
  "correction_appeals",
  "deliberation_rooms",
  "closed_external_app_pilots",
  "closed_external_app_pilot_attempts",
  "closed_external_app_pilot_events",
  "resume_checkpoints",
  "review_runs",
  "review_findings",
  "evidence_items",
  "situation_assertions",
  "claims",
] as const;

const projectFk =
  "FOREIGN KEY(project_id) REFERENCES research_projects(project_id)";
const json = "TEXT NOT NULL CHECK(json_valid(data) AND length(data)<=8388608)";

export const migration021: Migration = {
  version: 21,
  name: "021-project-state-revisions",
  up(db) {
    db.exec(`
CREATE TABLE IF NOT EXISTS research_project_state_heads (
 project_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>=1), canonical_hash TEXT NOT NULL CHECK(length(canonical_hash)=64),
 event_id TEXT NOT NULL UNIQUE, updated_at TEXT NOT NULL, ${projectFk},
 FOREIGN KEY(project_id,revision,event_id) REFERENCES research_project_state_events(project_id,revision,event_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE TABLE IF NOT EXISTS research_project_state_events (
 event_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=1), transaction_id TEXT NOT NULL,
 effect_kind TEXT NOT NULL, review_id TEXT, previous_hash TEXT NOT NULL CHECK(length(previous_hash)=64), next_hash TEXT NOT NULL CHECK(length(next_hash)=64),
 created_at TEXT NOT NULL, data ${json}, UNIQUE(project_id,revision), UNIQUE(project_id,transaction_id), UNIQUE(project_id,revision,event_id), ${projectFk}
) STRICT;
CREATE TABLE IF NOT EXISTS research_migration_runs (
 run_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_schema INTEGER NOT NULL CHECK(source_schema BETWEEN 16 AND 20),
 target_schema INTEGER NOT NULL CHECK(target_schema=25), source_hash TEXT NOT NULL, backup_hash TEXT NOT NULL, data ${json}, ${projectFk}
) STRICT;
CREATE TRIGGER IF NOT EXISTS kernel_events_no_update BEFORE UPDATE ON research_project_state_events BEGIN SELECT RAISE(ABORT,'immutable_revision_event'); END;
CREATE TRIGGER IF NOT EXISTS kernel_events_no_delete BEFORE DELETE ON research_project_state_events BEGIN SELECT RAISE(ABORT,'immutable_revision_event'); END;
`);
  },
};

export const migration022: Migration = {
  version: 22,
  name: "022-persistent-research-reviews",
  up(db) {
    db.exec(`
CREATE TABLE IF NOT EXISTS research_reviews (
 review_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','manifest_prepared','manifest_confirmed','provider_attempt_prepared','provider_attempt_running','provider_attempt_uncertain','provider_attempt_failed','assessment_recorded','stale','disposed','committed','cancelled')),
 base_revision INTEGER NOT NULL CHECK(base_revision>=1), version INTEGER NOT NULL CHECK(version>=1), suggestion_hash TEXT NOT NULL CHECK(length(suggestion_hash)=64),
 manifest_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, data ${json}, UNIQUE(project_id,review_id), ${projectFk},
 FOREIGN KEY(project_id,manifest_id) REFERENCES context_manifests(project_id,manifest_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE INDEX IF NOT EXISTS kernel_reviews_page ON research_reviews(project_id,created_at,review_id);
CREATE TABLE IF NOT EXISTS research_provider_attempts (
 attempt_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, review_id TEXT NOT NULL, ordinal INTEGER NOT NULL CHECK(ordinal>=1), manifest_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('prepared','running','completed','failed','cancelled','uncertain')), version INTEGER NOT NULL CHECK(version>=1),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, data ${json}, UNIQUE(project_id,review_id,ordinal), UNIQUE(project_id,attempt_id), UNIQUE(project_id,manifest_id),
 FOREIGN KEY(project_id,review_id) REFERENCES research_reviews(project_id,review_id), FOREIGN KEY(project_id,manifest_id) REFERENCES context_manifests(project_id,manifest_id)
) STRICT;
CREATE INDEX IF NOT EXISTS kernel_attempts_page ON research_provider_attempts(project_id,review_id,ordinal);
CREATE TABLE IF NOT EXISTS research_review_corrections (
 correction_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, review_id TEXT NOT NULL, attempt_id TEXT NOT NULL, original_assessment_hash TEXT NOT NULL CHECK(length(original_assessment_hash)=64),
 version INTEGER NOT NULL CHECK(version=1), created_at TEXT NOT NULL, data ${json}, UNIQUE(project_id,correction_id),
 FOREIGN KEY(project_id,review_id) REFERENCES research_reviews(project_id,review_id), FOREIGN KEY(project_id,attempt_id) REFERENCES research_provider_attempts(project_id,attempt_id)
) STRICT;
CREATE INDEX IF NOT EXISTS kernel_corrections_page ON research_review_corrections(project_id,created_at,correction_id);
CREATE TRIGGER IF NOT EXISTS kernel_review_no_delete BEFORE DELETE ON research_reviews BEGIN SELECT RAISE(ABORT,'immutable_review_history'); END;
CREATE TRIGGER IF NOT EXISTS kernel_review_terminal BEFORE UPDATE ON research_reviews WHEN OLD.status IN ('committed','disposed','cancelled') BEGIN SELECT RAISE(ABORT,'terminal_review'); END;
CREATE TRIGGER IF NOT EXISTS kernel_attempt_no_delete BEFORE DELETE ON research_provider_attempts BEGIN SELECT RAISE(ABORT,'immutable_attempt_history'); END;
CREATE TRIGGER IF NOT EXISTS kernel_attempt_terminal BEFORE UPDATE ON research_provider_attempts WHEN OLD.status IN ('completed','failed','cancelled','uncertain') BEGIN SELECT RAISE(ABORT,'immutable_attempt_result'); END;
CREATE TRIGGER IF NOT EXISTS kernel_correction_no_update BEFORE UPDATE ON research_review_corrections BEGIN SELECT RAISE(ABORT,'immutable_correction'); END;
CREATE TRIGGER IF NOT EXISTS kernel_correction_no_delete BEFORE DELETE ON research_review_corrections BEGIN SELECT RAISE(ABORT,'immutable_correction'); END;
`);
  },
};

export const migration023: Migration = {
  version: 23,
  name: "023-context-manifests-and-transition-receipts",
  up(db) {
    db.exec(`
CREATE TABLE IF NOT EXISTS context_manifests (
 manifest_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, review_id TEXT NOT NULL, base_revision INTEGER NOT NULL CHECK(base_revision>=1),
 status TEXT NOT NULL CHECK(status IN ('prepared','confirmed','sent','stale','cancelled')), version INTEGER NOT NULL CHECK(version>=1), identity_hash TEXT NOT NULL CHECK(length(identity_hash)=64),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, data ${json}, UNIQUE(project_id,manifest_id),
 FOREIGN KEY(project_id,review_id) REFERENCES research_reviews(project_id,review_id)
) STRICT;
CREATE INDEX IF NOT EXISTS kernel_manifests_page ON context_manifests(project_id,created_at,manifest_id);
CREATE TABLE IF NOT EXISTS research_transition_receipts (
 receipt_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, review_id TEXT, authority_command_id TEXT NOT NULL, event_id TEXT NOT NULL,
 before_revision INTEGER NOT NULL CHECK(before_revision>=1), after_revision INTEGER NOT NULL CHECK(after_revision=before_revision+1),
 effect_kind TEXT NOT NULL, receipt_hash TEXT NOT NULL CHECK(length(receipt_hash)=64), created_at TEXT NOT NULL, data ${json},
 UNIQUE(project_id,receipt_id), UNIQUE(project_id,review_id), UNIQUE(project_id,authority_command_id), UNIQUE(project_id,event_id),
 FOREIGN KEY(project_id,review_id) REFERENCES research_reviews(project_id,review_id),
 FOREIGN KEY(project_id,after_revision,event_id) REFERENCES research_project_state_events(project_id,revision,event_id),
 FOREIGN KEY(project_id,authority_command_id) REFERENCES research_authority_commands(project_id,command_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE INDEX IF NOT EXISTS kernel_receipts_page ON research_transition_receipts(project_id,created_at,receipt_id);
CREATE TABLE IF NOT EXISTS research_authority_commands (
 project_id TEXT NOT NULL, command_id TEXT NOT NULL, command_hash TEXT NOT NULL CHECK(length(command_hash)=64), receipt_id TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,command_id), FOREIGN KEY(project_id,receipt_id) REFERENCES research_transition_receipts(project_id,receipt_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE TRIGGER IF NOT EXISTS kernel_receipt_no_update BEFORE UPDATE ON research_transition_receipts BEGIN SELECT RAISE(ABORT,'immutable_receipt'); END;
CREATE TRIGGER IF NOT EXISTS kernel_receipt_no_delete BEFORE DELETE ON research_transition_receipts BEGIN SELECT RAISE(ABORT,'immutable_receipt'); END;
CREATE TRIGGER IF NOT EXISTS kernel_command_no_update BEFORE UPDATE ON research_authority_commands BEGIN SELECT RAISE(ABORT,'immutable_command'); END;
CREATE TRIGGER IF NOT EXISTS kernel_command_no_delete BEFORE DELETE ON research_authority_commands BEGIN SELECT RAISE(ABORT,'immutable_command'); END;
`);
  },
};

export const migration024: Migration = {
  version: 24,
  name: "024-progressive-brief-and-legacy-workflows",
  up(db) {
    db.exec(`
CREATE TABLE IF NOT EXISTS research_brief_metadata (
 project_id TEXT NOT NULL, brief_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>=1), data ${json}, PRIMARY KEY(project_id,brief_id),
 FOREIGN KEY(project_id,brief_id) REFERENCES research_briefs(project_id,brief_id)
) STRICT;
CREATE TABLE IF NOT EXISTS research_legacy_mappings (
 project_id TEXT NOT NULL, source_kind TEXT NOT NULL, source_id TEXT NOT NULL, source_hash TEXT NOT NULL CHECK(length(source_hash)=64),
 classification TEXT NOT NULL CHECK(classification IN ('lossless','lossy','orphan','legacy_incomplete')), data ${json}, PRIMARY KEY(project_id,source_kind,source_id), ${projectFk}
) STRICT;
CREATE TABLE IF NOT EXISTS research_memory_metadata (
 project_id TEXT NOT NULL, item_id TEXT NOT NULL, last_confirmed_revision INTEGER CHECK(last_confirmed_revision>=1), version INTEGER NOT NULL CHECK(version>=1),
 PRIMARY KEY(project_id,item_id), FOREIGN KEY(project_id,item_id) REFERENCES project_working_memory(project_id,item_id)
) STRICT;
CREATE TABLE IF NOT EXISTS research_resume_metadata (
 project_id TEXT NOT NULL, checkpoint_id TEXT NOT NULL, source_revision INTEGER NOT NULL CHECK(source_revision>=1), data ${json}, PRIMARY KEY(project_id,checkpoint_id), ${projectFk}
) STRICT;
CREATE TRIGGER IF NOT EXISTS kernel_legacy_mapping_no_update BEFORE UPDATE ON research_legacy_mappings BEGIN SELECT RAISE(ABORT,'immutable_legacy_mapping'); END;
CREATE TRIGGER IF NOT EXISTS kernel_legacy_mapping_no_delete BEFORE DELETE ON research_legacy_mappings BEGIN SELECT RAISE(ABORT,'immutable_legacy_mapping'); END;
`);
  },
};

export const migration025: Migration = {
  version: 25,
  name: "025-task-projections-and-privacy-redactions",
  up(db) {
    db.exec(`
CREATE TABLE IF NOT EXISTS research_projection_outbox (
 project_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=1), event_id TEXT NOT NULL, PRIMARY KEY(project_id,revision),
 FOREIGN KEY(project_id,revision,event_id) REFERENCES research_project_state_events(project_id,revision,event_id)
) STRICT;
CREATE TABLE IF NOT EXISTS research_projection_metadata (
 project_id TEXT NOT NULL, projection_kind TEXT NOT NULL CHECK(projection_kind IN ('search','attention','today','resume','history','brief_file')), source_revision INTEGER NOT NULL CHECK(source_revision>=0),
 status TEXT NOT NULL CHECK(status IN ('rebuilding','ready','failed')), version INTEGER NOT NULL CHECK(version>=1), data ${json}, PRIMARY KEY(project_id,projection_kind), ${projectFk}
) STRICT;
CREATE TABLE IF NOT EXISTS research_privacy_redactions (
 redaction_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, object_kind TEXT NOT NULL, object_id TEXT NOT NULL, source_revision INTEGER NOT NULL CHECK(source_revision>=1),
 created_at TEXT NOT NULL, data ${json}, UNIQUE(project_id,redaction_id), ${projectFk}
) STRICT;
CREATE TABLE IF NOT EXISTS research_copy_inventory (
 copy_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, copy_kind TEXT NOT NULL CHECK(copy_kind IN ('pre_migration_backup','managed_backup','temporary','external_uncontrolled')),
 location_token TEXT NOT NULL, source_revision INTEGER NOT NULL CHECK(source_revision>=0), content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
 status TEXT NOT NULL CHECK(status IN ('retained','removed','unverified','external_uncontrolled')), created_at TEXT NOT NULL, data ${json}, UNIQUE(project_id,copy_id), ${projectFk}
) STRICT;
`);
    for (const table of KERNEL_LEGACY_TABLES)
      for (const operation of ["INSERT", "UPDATE", "DELETE"])
        db.exec(
          `CREATE TRIGGER IF NOT EXISTS kernel_legacy_${table}_${operation.toLowerCase()} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'legacy_write_forbidden'); END;`,
        );
  },
};

export const KERNEL_MIGRATIONS: readonly Migration[] = Object.freeze([
  ...MIGRATIONS,
  migration021,
  migration022,
  migration023,
  migration024,
  migration025,
]);

/** Does not infer completeness from a lone table or a future journal row. */
export function hasKernelSchema(db: StorageDatabase): boolean {
  return (
    db.get(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name='research_project_state_heads'",
    ) !== undefined
  );
}
