import type { Migration } from "../migrator.js";
import type { StorageDatabase } from "../connection.js";

// ── docs/09 §21 minimum table set ──
// Precise DDL is defined here at implementation time (docs/09 §21):
// foreign keys, STRICT tables, integer-millisecond time columns, JSON `data`
// columns that must pass schema validation before writing, and sensitive
// excerpts (evidence excerpt, conversation/collaboration bodies) in their
// own dedicated columns so retention can clean them independently.
//
// Task 5 lease/maintenance infrastructure on top of the minimum set:
//   event_leases, collaboration_delivery_leases, maintenance_events.
// (`migrations` and `maintenance_locks` are bootstrapped by the runner.)

const SQL = `
CREATE TABLE projects (
  project_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL
) STRICT;

CREATE TABLE project_root_bindings (
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  root_path TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','archived')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, root_path)
) STRICT;
CREATE UNIQUE INDEX idx_project_roots_active_root ON project_root_bindings(root_path) WHERE status = 'active';

CREATE TABLE tasks (
  task_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  data TEXT NOT NULL
) STRICT;
CREATE INDEX idx_tasks_project ON tasks(project_id);

CREATE TABLE host_sessions (
  session_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  host TEXT NOT NULL,
  host_session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  data TEXT NOT NULL,
  UNIQUE (host, host_session_id)
) STRICT;
CREATE INDEX idx_host_sessions_task ON host_sessions(task_id);

CREATE TABLE host_stream_events (
  stream_event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES host_sessions(session_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  UNIQUE (session_id, sequence)
) STRICT;

CREATE TABLE contracts (
  contract_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE REFERENCES tasks(task_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  data TEXT NOT NULL
) STRICT;

CREATE TABLE contract_versions (
  contract_version_id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(contract_id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL,
  UNIQUE (contract_id, version)
) STRICT;

CREATE TABLE boundaries (
  boundary_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  valid_from INTEGER,
  valid_until INTEGER,
  data TEXT NOT NULL
) STRICT;
CREATE INDEX idx_boundaries_project_task ON boundaries(project_id, task_id);

CREATE TABLE deliverables (
  deliverable_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  data TEXT NOT NULL
) STRICT;
CREATE INDEX idx_deliverables_task ON deliverables(task_id);

CREATE TABLE events (
  event_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  session_id TEXT,
  event_type TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  privacy_class TEXT NOT NULL,
  data TEXT NOT NULL
) STRICT;
CREATE INDEX idx_events_project_occurred ON events(project_id, occurred_at);

CREATE TABLE decisions (
  decision_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE REFERENCES events(event_id),
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL
) STRICT;
CREATE INDEX idx_decisions_project_task ON decisions(project_id, task_id, created_at);

CREATE TABLE decision_traces (
  trace_id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES decisions(decision_id) ON DELETE CASCADE,
  contract_version_id TEXT,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL
) STRICT;

CREATE TABLE decision_trace_stages (
  stage_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL REFERENCES decision_traces(trace_id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  data TEXT NOT NULL,
  UNIQUE (trace_id, sequence)
) STRICT;

CREATE TABLE rule_findings (
  finding_id TEXT PRIMARY KEY,
  decision_id TEXT REFERENCES decisions(decision_id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  data TEXT NOT NULL
) STRICT;

CREATE TABLE judgment_requests (
  judgment_id TEXT PRIMARY KEY,
  decision_id TEXT REFERENCES decisions(decision_id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  provider_id TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL
) STRICT;

CREATE TABLE judge_opinions (
  opinion_id TEXT PRIMARY KEY,
  judgment_id TEXT NOT NULL UNIQUE REFERENCES judgment_requests(judgment_id) ON DELETE CASCADE,
  decision_id TEXT REFERENCES decisions(decision_id) ON DELETE CASCADE,
  data TEXT NOT NULL
) STRICT;

CREATE TABLE situation_assertions (
  assertion_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT,
  status TEXT NOT NULL,
  valid_from INTEGER,
  valid_until INTEGER,
  data TEXT NOT NULL
) STRICT;
CREATE INDEX idx_assertions_project_task ON situation_assertions(project_id, task_id);

CREATE TABLE evidence_items (
  evidence_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  excerpt TEXT,
  content_hash TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  expires_at INTEGER,
  data TEXT NOT NULL
) STRICT;
CREATE INDEX idx_evidence_project_task ON evidence_items(project_id, task_id);

CREATE TABLE claims (
  claim_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence REAL,
  text TEXT NOT NULL,
  data TEXT NOT NULL
) STRICT;
CREATE INDEX idx_claims_project_task ON claims(project_id, task_id);

CREATE TABLE claim_evidence (
  claim_id TEXT NOT NULL REFERENCES claims(claim_id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES evidence_items(evidence_id) ON DELETE CASCADE,
  PRIMARY KEY (claim_id, evidence_id)
) STRICT;

CREATE TABLE corrections (
  correction_id TEXT PRIMARY KEY,
  project_id TEXT,
  task_id TEXT,
  scope TEXT NOT NULL,
  severity TEXT NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 0,
  recurrence_count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  superseded_by TEXT,
  data TEXT NOT NULL
) STRICT;

CREATE TABLE override_grants (
  override_id TEXT PRIMARY KEY,
  decision_id TEXT REFERENCES decisions(decision_id),
  issued_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  scope TEXT NOT NULL,
  expires_at INTEGER,
  data TEXT NOT NULL
) STRICT;

CREATE TABLE conversations (
  conversation_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  data TEXT NOT NULL
) STRICT;
CREATE INDEX idx_conversations_project ON conversations(project_id);

CREATE TABLE conversation_messages (
  message_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL
) STRICT;
CREATE INDEX idx_conversation_messages_conv ON conversation_messages(conversation_id, created_at);

CREATE TABLE context_refs (
  context_ref_id INTEGER PRIMARY KEY,
  conversation_message_id TEXT NOT NULL REFERENCES conversation_messages(message_id) ON DELETE CASCADE,
  ref_type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  resolution_status TEXT NOT NULL,
  data TEXT NOT NULL
) STRICT;
CREATE INDEX idx_context_refs_message ON context_refs(conversation_message_id);

CREATE TABLE governance_actions (
  action_id TEXT PRIMARY KEY,
  project_id TEXT,
  task_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  data TEXT NOT NULL
) STRICT;

CREATE TABLE collaboration_threads (
  thread_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  data TEXT NOT NULL
) STRICT;
CREATE INDEX idx_collab_threads_project_task ON collaboration_threads(project_id, task_id);

CREATE TABLE collaboration_messages (
  message_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES collaboration_threads(thread_id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_endpoint_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  body TEXT,
  privacy_class TEXT NOT NULL,
  ttl_seconds INTEGER NOT NULL,
  hop_count INTEGER NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  data TEXT NOT NULL
) STRICT;
CREATE INDEX idx_collab_messages_thread ON collaboration_messages(thread_id, created_at);
CREATE INDEX idx_collab_messages_task ON collaboration_messages(task_id);
CREATE INDEX idx_collab_messages_expires ON collaboration_messages(expires_at);

CREATE TABLE collaboration_delivery_attempts (
  attempt_id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES collaboration_messages(message_id) ON DELETE CASCADE,
  target_endpoint_id TEXT NOT NULL REFERENCES collaboration_endpoints(endpoint_id),
  sequence INTEGER NOT NULL,
  route TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  adapter_receipt TEXT,
  error TEXT,
  data TEXT NOT NULL,
  UNIQUE (message_id, target_endpoint_id, sequence)
) STRICT;
CREATE INDEX idx_collab_attempts_message_target ON collaboration_delivery_attempts(message_id, target_endpoint_id);

CREATE TABLE collaboration_endpoints (
  endpoint_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  host TEXT NOT NULL,
  host_session_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  inbound_policy TEXT NOT NULL,
  connected INTEGER NOT NULL,
  last_seen_at INTEGER,
  data TEXT NOT NULL,
  UNIQUE (host, host_session_id)
) STRICT;
CREATE INDEX idx_collab_endpoints_project_task ON collaboration_endpoints(project_id, task_id);

CREATE TABLE collaboration_actions (
  action_id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES collaboration_messages(message_id) ON DELETE CASCADE,
  endpoint_id TEXT NOT NULL REFERENCES collaboration_endpoints(endpoint_id),
  status TEXT NOT NULL,
  acted_at INTEGER NOT NULL,
  note TEXT,
  data TEXT NOT NULL
) STRICT;
CREATE INDEX idx_collab_actions_message ON collaboration_actions(message_id);

CREATE TABLE collaboration_delivery_leases (
  message_id TEXT NOT NULL REFERENCES collaboration_messages(message_id) ON DELETE CASCADE,
  target_endpoint_id TEXT NOT NULL,
  lease_owner_id TEXT NOT NULL,
  lease_expires_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, target_endpoint_id)
) STRICT;

CREATE TABLE review_items (
  review_id TEXT PRIMARY KEY,
  project_id TEXT,
  task_id TEXT,
  decision_id TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  data TEXT NOT NULL
) STRICT;

CREATE TABLE review_actions (
  review_action_id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES review_items(review_id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  acted_at INTEGER NOT NULL,
  data TEXT NOT NULL
) STRICT;

CREATE TABLE notification_states (
  notification_id TEXT PRIMARY KEY,
  activity_id TEXT,
  channel TEXT NOT NULL,
  delivered_at INTEGER NOT NULL,
  acknowledged INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL
) STRICT;

CREATE TABLE provider_usage (
  usage_id TEXT PRIMARY KEY,
  provider_id TEXT,
  task_id TEXT,
  model TEXT,
  call_at INTEGER NOT NULL,
  tokens_in INTEGER,
  tokens_out INTEGER,
  cost REAL,
  data TEXT NOT NULL
) STRICT;

CREATE TABLE event_leases (
  idempotency_key TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  packet_hash TEXT,
  completed_at INTEGER
) STRICT;

CREATE TABLE maintenance_events (
  maintenance_event_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  note TEXT
) STRICT;
`;

export const migration001: Migration = {
  version: 1,
  name: "001-initial",
  up(db: StorageDatabase): void {
    db.exec(SQL);
  },
};
