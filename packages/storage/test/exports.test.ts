import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { generateId, isSestinaError, SestinaErrorCode } from "@sestina/schema";
import type { Conversation, ConversationMessage } from "@sestina/schema";
import {
  openDatabase,
  createUnitOfWork,
  exportProject,
  previewRetention,
  applyRetentionPreview,
  clearExportByMetadata,
  ExportManifestSchema,
} from "../src/index.js";
import { makeTempDir, removeTempDir, expectSestinaCode } from "./helpers.js";
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
    uow.commit((u) => {
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
      u.evidence.insert(projectId, {
        evidenceId: "EXP-EV-1", taskId, type: "primary_source",
        locator: { type: "path", value: join(dir, "raw.csv") },
        excerpt: `${SENSITIVE_PHRASE} in the evidence excerpt`,
        status: "unverified", provenance: "upload", recordedBy: "user",
        observedAt: oldIso,
        expiresAt: new Date(Date.now() - 30 * DAY_MS).toISOString(),
        version: 1,
      });
      // A locator whose value already contains the JSON-escaped form of an
      // absolute path (literal doubled backslashes): minimiseJson must still
      // shrink it to the basename.
      u.evidence.insert(projectId, {
        evidenceId: "EXP-EV-ESC", taskId, type: "primary_source",
        locator: { type: "path", value: `${dir.replaceAll("\\", "\\\\")}\\raw-escaped.csv` },
        excerpt: `${SENSITIVE_PHRASE} in the escaped evidence`,
        status: "unverified", provenance: "upload", recordedBy: "user",
        observedAt: oldIso,
        expiresAt: new Date(Date.now() - 30 * DAY_MS).toISOString(),
        version: 1,
      });
    });
  });
  afterEach(() => {
    db.close();
    removeTempDir(dir);
  });

  function exportRoot(exportId: string): string {
    return join(dir, "exports", exportId);
  }

  /** Recursively concatenates every file under `directory` (empty when missing). */
  function readTree(directory: string): string {
    let content = "";
    const walk = (d: string): void => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, entry.name);
        if (entry.isDirectory()) walk(p);
        else content += readFileSync(p, "utf8");
      }
    };
    if (existsSync(directory)) walk(directory);
    return content;
  }

  function applyPreview(preview: { previewId: string }): ReturnType<typeof applyRetentionPreview> {
    return applyRetentionPreview(db, {
      previewId: preview.previewId,
      databasePath: join(dir, "sestina.db"),
      busyTimeoutMs: 400,
    });
  }

  function retentionConfig(): {
    captureRetentionDays: number;
    privacyRetentionDays: number;
    collaborationMessageRetentionDays: number;
  } {
    return {
      captureRetentionDays: 90,
      privacyRetentionDays: 90,
      collaborationMessageRetentionDays: 90,
    };
  }

  it("publishes files, manifest and sidecars into a unique export directory", async () => {
    const result = await exportProject(db, {
      projectId,
      destinationDir: dir,
    });
    expect(result.files.length).toBeGreaterThanOrEqual(6);
    for (const file of result.files) {
      expect(file.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(existsSync(file.path)).toBe(true);
      expect(file.path.startsWith(exportRoot(result.exportId))).toBe(true);
    }
    const names = readdirSync(exportRoot(result.exportId)).sort();
    expect(names).toContain("project.json");
    expect(names).toContain("project.json.sha256");
    expect(names).toContain("manifest.json");
    expect(names).toContain("manifest.json.sha256");

    const manifest = ExportManifestSchema.parse(
      JSON.parse(readFileSync(join(exportRoot(result.exportId), "manifest.json"), "utf8")),
    );
    expect(manifest.exportId).toBe(result.exportId);
    expect(manifest.kind).toBe("minimal");

    const meta = db.get<{ status: string; content_hash: string; output_path: string }>(
      "SELECT status, content_hash, output_path FROM export_metadata WHERE export_id = ?",
      result.exportId,
    );
    expect(meta?.status).toBe("ready");
    expect(meta?.content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(meta?.output_path).toBe(exportRoot(result.exportId));

    // No staging leftovers survive a successful publish.
    const stagingLeftovers = readdirSync(join(dir, "exports")).filter((n) => n.startsWith(".staging"));
    expect(stagingLeftovers).toHaveLength(0);
  });

  it("never contains sensitive phrases or absolute paths by default", async () => {
    const result = await exportProject(db, { projectId, destinationDir: dir });
    const content = readTree(exportRoot(result.exportId));
    expect(content).not.toContain(SENSITIVE_PHRASE);
    expect(content).not.toContain(resolve(dir));
    expect(content).not.toContain(dir.replaceAll("\\", "\\\\"));
  });

  it("includes bodies when explicitly requested but still minimises paths", async () => {
    const result = await exportProject(db, {
      projectId,
      destinationDir: dir,
      includeBodies: true,
    });
    const content = readTree(exportRoot(result.exportId));
    expect(content).toContain(SENSITIVE_PHRASE);
    // Absolute paths never leak — not even their JSON-escaped forms; only
    // the basenames survive (path minimisation is independent of
    // includeBodies).
    expect(content).not.toContain(resolve(dir));
    expect(content).not.toContain(dir.replaceAll("\\", "\\\\"));
    expect(content).toContain("raw-escaped.csv");
    expect(content).toContain("raw.csv");
  });

  it("cannot resurrect retained content through export", async () => {
    const preview = previewRetention(db, retentionConfig());
    await applyPreview(preview);
    // Even with bodies included, cleaned rows hold no content.
    const result = await exportProject(db, {
      projectId,
      destinationDir: dir,
      includeBodies: true,
    });
    const content = readTree(exportRoot(result.exportId));
    expect(content).not.toContain(SENSITIVE_PHRASE);
  });

  it("records an expired export as purged and removes its directory after retention", async () => {
    const result = await exportProject(db, {
      projectId,
      destinationDir: dir,
    });
    db.run("UPDATE export_metadata SET expires_at = ? WHERE export_id = ?", Date.now() - 1000, result.exportId);
    const preview = previewRetention(db, retentionConfig());
    await applyPreview(preview);
    const meta = db.get<{ status: string }>("SELECT status FROM export_metadata WHERE export_id = ?", result.exportId);
    expect(meta?.status).toBe("purged");
    expect(existsSync(exportRoot(result.exportId))).toBe(false);
  });

  it("keeps a real new evidence item out of retention when it is not expired", async () => {
    const uow = createUnitOfWork(db);
    uow.commit((u) => {
      u.evidence.insert(projectId, {
        evidenceId: "EXP-EV-2", taskId, type: "primary_source",
        locator: { type: "path", value: join(dir, "fresh.csv") },
        excerpt: `${SENSITIVE_PHRASE} but recent`,
        status: "unverified", provenance: "upload", recordedBy: "user",
        observedAt: new Date().toISOString(),
        version: 1,
      });
    });
    const preview = previewRetention(db, retentionConfig());
    await applyPreview(preview);
    const kept = db.get<{ excerpt: string | null }>("SELECT excerpt FROM evidence_items WHERE evidence_id = 'EXP-EV-2'");
    expect(kept?.excerpt).toContain(SENSITIVE_PHRASE);
  });

  it("never overwrites a pre-seeded project.json in the destination", async () => {
    // A file that happens to sit at the destination root must survive: the
    // export publishes into its own exports/<exportId>/ subdirectory.
    writeFileSync(join(dir, "project.json"), "pre-existing-user-file", "utf8");
    await exportProject(db, { projectId, destinationDir: dir });
    expect(readFileSync(join(dir, "project.json"), "utf8")).toBe("pre-existing-user-file");
  });

  it("clearExportByMetadata deletes only the recorded export directory", async () => {
    const a = await exportProject(db, { projectId, destinationDir: dir });
    const b = await exportProject(db, { projectId, destinationDir: dir });
    const notes = join(dir, "exports", "notes.json");
    writeFileSync(notes, "unrelated-user-file", "utf8");

    clearExportByMetadata(db, a.exportId);
    expect(existsSync(exportRoot(a.exportId))).toBe(false);
    expect(existsSync(exportRoot(b.exportId))).toBe(true);
    expect(readFileSync(notes, "utf8")).toBe("unrelated-user-file");
    // Clearing again is a no-op, never a scan-and-delete.
    clearExportByMetadata(db, a.exportId);
    expect(existsSync(exportRoot(b.exportId))).toBe(true);
  });

  it("clearExportByMetadata refuses an output path outside the data root", () => {
    const outside = makeTempDir("sestina-exports-outside-");
    try {
      const userFile = join(outside, "notes.txt");
      writeFileSync(userFile, "precious-user-content", "utf8");
      db.run(
        `INSERT INTO export_metadata (export_id, project_id, task_id, kind, scope_json, output_path, content_hash, status, created_at, expires_at, data)
         VALUES ('exp-out', ?, NULL, 'minimal', '{}', ?, 'h', 'ready', 1, NULL, '{}')`,
        projectId,
        outside,
      );
      expectSestinaCode(() => {
        clearExportByMetadata(db, "exp-out");
      }, SestinaErrorCode.validation_failed);
      expect(readFileSync(userFile, "utf8")).toBe("precious-user-content");
    } finally {
      removeTempDir(outside);
    }
  });

  it("clearExportByMetadata rejects a directory the manifest does not describe", () => {
    const outside = makeTempDir("sestina-exports-tampered-");
    try {
      // Inside the data root, but the manifest claims a different export.
      const tamperedDir = join(dir, "exports", "exp-tampered");
      mkdirSync(tamperedDir, { recursive: true });
      writeFileSync(join(tamperedDir, "user-file.txt"), "precious-user-content", "utf8");
      writeFileSync(
        join(tamperedDir, "manifest.json"),
        JSON.stringify({ exportId: "different-export", kind: "minimal" }),
        "utf8",
      );
      db.run(
        `INSERT INTO export_metadata (export_id, project_id, task_id, kind, scope_json, output_path, content_hash, status, created_at, expires_at, data)
         VALUES ('exp-tampered', ?, NULL, 'minimal', '{}', ?, 'h', 'ready', 1, NULL, '{}')`,
        projectId,
        tamperedDir,
      );
      expectSestinaCode(() => {
        clearExportByMetadata(db, "exp-tampered");
      }, SestinaErrorCode.validation_failed);
      expect(readFileSync(join(tamperedDir, "user-file.txt"), "utf8")).toBe("precious-user-content");
    } finally {
      removeTempDir(outside);
    }
  });

  it("leaves zero secrets on disk after an expired export is purged", async () => {
    const result = await exportProject(db, {
      projectId,
      destinationDir: dir,
      includeBodies: true,
    });
    expect(readTree(exportRoot(result.exportId))).toContain(SENSITIVE_PHRASE);
    db.run("UPDATE export_metadata SET expires_at = ? WHERE export_id = ?", Date.now() - 1000, result.exportId);

    const preview = previewRetention(db, retentionConfig());
    await applyPreview(preview);

    // A full-file scan of the export destination finds zero secrets.
    const scan = readTree(join(dir, "exports"));
    expect(scan).not.toContain(SENSITIVE_PHRASE);
    expect(scan).not.toContain(resolve(dir));
    expect(scan).not.toContain(dir.replaceAll("\\", "\\\\"));
  });

  it("rejects an export destination outside the data root", async () => {
    const outside = makeTempDir("sestina-exports-outside-");
    try {
      await expect(
        exportProject(db, { projectId, destinationDir: join(outside, "exports") }),
      ).rejects.toSatisfy((err: unknown) => {
        return isSestinaError(err) && err.code === SestinaErrorCode.validation_failed;
      });
    } finally {
      removeTempDir(outside);
    }
  });
});
