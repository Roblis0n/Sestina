import type { Migration } from "../migrator.js";
import type { StorageDatabase } from "../connection.js";

// ── FTS5 full-text index infrastructure (docs/22 Task 5 `002-fts`) ──
// External-content tables over the STRICT data tables with triggers that
// keep the index in sync — deleted sensitive text leaves the index
// immediately (docs/31 §8). Indexed fields are exactly the text columns
// retention is allowed to persist: claim text, evidence excerpts, and
// conversation/collaboration bodies.

const SQL = `
CREATE VIRTUAL TABLE fts_claims USING fts5(text, content='claims', content_rowid='rowid');
CREATE TRIGGER claims_fts_ai AFTER INSERT ON claims BEGIN
  INSERT INTO fts_claims(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER claims_fts_ad AFTER DELETE ON claims BEGIN
  INSERT INTO fts_claims(fts_claims, rowid, text) VALUES ('delete', old.rowid, old.text);
END;
CREATE TRIGGER claims_fts_au AFTER UPDATE ON claims BEGIN
  INSERT INTO fts_claims(fts_claims, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO fts_claims(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE VIRTUAL TABLE fts_evidence USING fts5(excerpt, content='evidence_items', content_rowid='rowid');
CREATE TRIGGER evidence_fts_ai AFTER INSERT ON evidence_items BEGIN
  INSERT INTO fts_evidence(rowid, excerpt) VALUES (new.rowid, coalesce(new.excerpt, ''));
END;
CREATE TRIGGER evidence_fts_ad AFTER DELETE ON evidence_items BEGIN
  INSERT INTO fts_evidence(fts_evidence, rowid, excerpt) VALUES ('delete', old.rowid, coalesce(old.excerpt, ''));
END;
CREATE TRIGGER evidence_fts_au AFTER UPDATE ON evidence_items BEGIN
  INSERT INTO fts_evidence(fts_evidence, rowid, excerpt) VALUES ('delete', old.rowid, coalesce(old.excerpt, ''));
  INSERT INTO fts_evidence(rowid, excerpt) VALUES (new.rowid, coalesce(new.excerpt, ''));
END;

CREATE VIRTUAL TABLE fts_conversation_messages USING fts5(body, content='conversation_messages', content_rowid='rowid');
CREATE TRIGGER conversation_messages_fts_ai AFTER INSERT ON conversation_messages BEGIN
  INSERT INTO fts_conversation_messages(rowid, body) VALUES (new.rowid, coalesce(new.body, ''));
END;
CREATE TRIGGER conversation_messages_fts_ad AFTER DELETE ON conversation_messages BEGIN
  INSERT INTO fts_conversation_messages(fts_conversation_messages, rowid, body) VALUES ('delete', old.rowid, coalesce(old.body, ''));
END;
CREATE TRIGGER conversation_messages_fts_au AFTER UPDATE ON conversation_messages BEGIN
  INSERT INTO fts_conversation_messages(fts_conversation_messages, rowid, body) VALUES ('delete', old.rowid, coalesce(old.body, ''));
  INSERT INTO fts_conversation_messages(rowid, body) VALUES (new.rowid, coalesce(new.body, ''));
END;

CREATE VIRTUAL TABLE fts_collaboration_messages USING fts5(summary, body, content='collaboration_messages', content_rowid='rowid');
CREATE TRIGGER collaboration_messages_fts_ai AFTER INSERT ON collaboration_messages BEGIN
  INSERT INTO fts_collaboration_messages(rowid, summary, body) VALUES (new.rowid, new.summary, coalesce(new.body, ''));
END;
CREATE TRIGGER collaboration_messages_fts_ad AFTER DELETE ON collaboration_messages BEGIN
  INSERT INTO fts_collaboration_messages(fts_collaboration_messages, rowid, summary, body) VALUES ('delete', old.rowid, old.summary, coalesce(old.body, ''));
END;
CREATE TRIGGER collaboration_messages_fts_au AFTER UPDATE ON collaboration_messages BEGIN
  INSERT INTO fts_collaboration_messages(fts_collaboration_messages, rowid, summary, body) VALUES ('delete', old.rowid, old.summary, coalesce(old.body, ''));
  INSERT INTO fts_collaboration_messages(rowid, summary, body) VALUES (new.rowid, new.summary, coalesce(new.body, ''));
END;
`;

export const migration002: Migration = {
  version: 2,
  name: "002-fts",
  up(db: StorageDatabase): void {
    db.exec(SQL);
  },
};
