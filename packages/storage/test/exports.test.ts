import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join, resolve } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { generateId } from "@sestina/schema";
import type { Conversation, ConversationMessage } from "@sestina/schema";
import { openDatabase, createUnitOfWork, exportProject, previewRetention, applyRetentionPreview, clearExports } from "../src/index.js";
import { makeTempDir, removeTempDir } from "./helpers.js";
import type { StorageDatabase } from "../src/index.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const SENSITIVE_PHRASE = "super-secret-synthetic-phrase";

describe("Minimal privacy-preserving export (docs/22 Task 6)", () => {
  let dir: string;
  let db: StorageDatabase;
  let projectId: string;
  let taskId: string;

  beforeEach(async () => {
    dir = makeTempDir();
    db = await openDatabase({ path: join(dir, "sestina.db") });
    projectId = generateId();
    taskId = generateId();
    const uow = createUnitOfWork(db);
    await uow.commit((u) => {
      u.projects.insert({
        projectId, name: "export-project",
        bindings: [{ rootPath: join(dir, "work"), establishedAt: "2026-08-13T00:00:00.000Z", fingerprint: "fp-1" }],
        status: "active",
        createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
      });
      u.tasks.insert({
        taskId, projectId, title: "export-task", status: "active", priority: "normal",
        createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
      });
      const conversation: Conversation = {
        conversationId: generateId(), projectId, type: "governance_chat", title: "c",
        status: "active", createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
      };
      u.conversations.insertConversation(conversation);
      const oldIso = new Date(Date.now() - 120 * DAY_MS).toISOString();
      u.conversations.insertMessage({
        messageId: generateId(), conversationId: conversation.conversationId, role: "sestina",
        body: `${SENSITIVE_PHRASE} in the conversation body`, contextRefs: [], confirmable: false,
        status: "complete", createdAt: oldIso,
      } satisfies ConversationMessage);
      u.evidence.insert({
        evidenceId: "EXP-EV-1", taskId, type: "primary_source",
        locator: { type: "path", value: join(dir, "raw.csv") },
        excerpt: `${SENSITIVE_PHRASE} in the evidence excerpt`,
        status: "verified", provenance: "upload", recordedBy: "user",
        observedAt: oldIso,
        expiresAt: new Date(Date.now() - 30 * DAY_MS).toISOString(),
      });
    });
  });
  afterEach(() => {
    db.close();
    removeTempDir(dir);
  });

  function allExportedContent(): string {
    return readdirSync(join(dir, "exports"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => readFileSync(join(dir, "exports", f), "utf8"))
      .join("\n");
  }

  it("exports files with hashes and an export_metadata row", async () => {
    const result = await exportProject(db, {
      projectId,
      destinationDir: join(dir, "exports"),
      dataRoot: dir,
    });
    expect(result.files.length).toBeGreaterThanOrEqual(6);
    for (const file of result.files) {
      expect(file.hash).toMatch(/^[a-f0-9]{64}$/);
    }
    const meta = db.get<{ status: string; content_hash: string }>(
      "SELECT status, content_hash FROM export_metadata WHERE export_id = ?",
      result.exportId,
    );
    expect(meta?.status).toBe("ready");
    expect(meta?.content_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("never contains sensitive phrases or absolute paths by default", async () => {
    await exportProject(db, { projectId, destinationDir: join(dir, "exports"), dataRoot: dir });
    const content = allExportedContent();
    expect(content).not.toContain(SENSITIVE_PHRASE);
    expect(content).not.toContain(resolve(dir));
    expect(content).not.toContain(dir.replaceAll("\\", "\\\\"));
  });

  it("includes bodies when explicitly requested but still minimises paths", async () => {
    await exportProject(db, {
      projectId,
      destinationDir: join(dir, "exports"),
      dataRoot: dir,
      includeBodies: true,
    });
    const content = allExportedContent();
    expect(content).toContain(SENSITIVE_PHRASE);
    expect(content).not.toContain(resolve(dir));
  });

  it("cannot resurrect retained content through export", async () => {
    const preview = previewRetention(db, {
      captureRetentionDays: 90,
      privacyRetentionDays: 90,
      collaborationMessageRetentionDays: 90,
    });
    await applyRetentionPreview(db, { preview, dataRoot: dir });
    // Even with bodies included, cleaned rows hold no content. Clear any
    // files left by earlier tests in this suite first.
    clearExports(join(dir, "exports"));
    await exportProject(db, {
      projectId,
      destinationDir: join(dir, "exports"),
      dataRoot: dir,
      includeBodies: true,
    });
    const content = allExportedContent();
    expect(content).not.toContain(SENSITIVE_PHRASE);
  });

  it("records an expired export as purged after retention", async () => {
    const result = await exportProject(db, {
      projectId,
      destinationDir: join(dir, "exports"),
      dataRoot: dir,
    });
    db.run("UPDATE export_metadata SET expires_at = ? WHERE export_id = ?", Date.now() - 1000, result.exportId);
    const preview = previewRetention(db, {
      captureRetentionDays: 90,
      privacyRetentionDays: 90,
      collaborationMessageRetentionDays: 90,
    });
    await applyRetentionPreview(db, { preview, dataRoot: dir });
    const meta = db.get<{ status: string }>("SELECT status FROM export_metadata WHERE export_id = ?", result.exportId);
    expect(meta?.status).toBe("purged");
  });

  it("keeps a real new evidence item out of retention when it is not expired", async () => {
    const uow = createUnitOfWork(db);
    await uow.commit((u) => {
      u.evidence.insert({
        evidenceId: "EXP-EV-2", taskId, type: "primary_source",
        locator: { type: "path", value: join(dir, "fresh.csv") },
        excerpt: `${SENSITIVE_PHRASE} but recent`,
        status: "verified", provenance: "upload", recordedBy: "user",
        observedAt: new Date().toISOString(),
      });
    });
    const preview = previewRetention(db, {
      captureRetentionDays: 90,
      privacyRetentionDays: 90,
      collaborationMessageRetentionDays: 90,
    });
    await applyRetentionPreview(db, { preview, dataRoot: dir });
    const kept = db.get<{ excerpt: string | null }>("SELECT excerpt FROM evidence_items WHERE evidence_id = 'EXP-EV-2'");
    expect(kept?.excerpt).toContain(SENSITIVE_PHRASE);
  });
});
