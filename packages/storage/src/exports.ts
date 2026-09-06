import { mkdirSync, writeFileSync, existsSync, renameSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { generateId, SestinaError, SestinaErrorCode } from "@sestina/schema";
import type { StorageDatabase } from "./connection.js";
import { withTransaction } from "./transaction.js";
import { MaintenanceGuard, maintenanceRootOf, mapFsError } from "./maintenance-domain.js";
import { sha256 } from "./retention.js";
import { assertValidProjectId } from "./repositories/shared.js";
import { validateJson } from "./schema-check.js";
import { assertInsideRoot } from "./backup.js";
import {
  ExportManifestSchema,
  assertExportPathContained,
  readValidatedExportManifest,
  deleteExportDirectory,
} from "./export-manifest.js";

export { ExportManifestSchema, type ExportManifest } from "./export-manifest.js";

export interface ExportOptions {
  projectId: string;
  destinationDir: string;
  /** Default false: bodies, excerpts and absolute paths are minimised. */
  includeBodies?: boolean;
}

export interface ExportFile {
  path: string;
  hash: string;
}

export interface ExportResult {
  exportId: string;
  files: ExportFile[];
}

/**
 * Zod schema backing the export_metadata JSON columns: scope_json carries
 * the export scope, data carries the file count. Both are validated before
 * the metadata row is written (docs/09 §21).
 */
export const ExportMetadataSchema = z.object({
  exportId: z.string().min(1),
  projectId: z.string().min(1),
  kind: z.enum(["minimal", "full"]),
  scope: z.object({
    projectId: z.string().min(1),
    includeBodies: z.boolean(),
  }),
  data: z.object({
    fileCount: z.number().int().nonnegative(),
  }),
});

const EXPORT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Minimal privacy-preserving project export (docs/17 §10, docs/22 Task 6
 * fix): by default no bodies/excerpts/text and no absolute paths leave the
 * machine; every file carries a sha256 sidecar and the export directory
 * carries a manifest.json. All outputs are written into a staging
 * directory and renamed into `destinationDir/exports/<exportId>/` in one
 * atomic step — a partially written export can never be mistaken for a
 * published one, and a pre-existing file in the destination is never
 * overwritten. File IO happens outside the write transaction; the
 * export_metadata row is written only after the publish succeeded.
 */
export async function exportProject(db: StorageDatabase, options: ExportOptions): Promise<ExportResult> {
  assertValidProjectId(options.projectId);
  // The export destination must live inside the data root (the database's
  // own directory) so purge and clear can later verify containment.
  assertInsideRoot(maintenanceRootOf(db.path), options.destinationDir, "export destination");
  const destinationDir = ensureExportDir(options.destinationDir);
  const exportsRoot = join(destinationDir, "exports");
  try {
    mkdirSync(exportsRoot, { recursive: true });
  } catch (err) {
    throw mapFsError(err, "Failed to create the export directory");
  }

  const exportId = generateId();
  const publishDir = join(exportsRoot, exportId);
  const stagingDir = join(exportsRoot, `.staging-${exportId}-${randomBytes(4).toString("hex")}`);

  const guard = await MaintenanceGuard.acquire({
    databasePath: db.path,
    scope: "exports",
    ownerId: "exports",
  });
  db.maintenanceOwned = true;
  try {
    try {
      mkdirSync(stagingDir, { recursive: true });
    } catch (err) {
      throw mapFsError(err, "Failed to create the export staging directory");
    }

    // ── Gather and minimise OUTSIDE any write transaction ──
    const files: ExportFile[] = [];
    const collect = (name: string, rows: unknown[]): void => {
      const content = JSON.stringify(
        rows.map((row) => {
          const withParsedData = { ...(row as Record<string, unknown>) };
          if (typeof withParsedData.data === "string") {
            try {
              withParsedData.data = JSON.parse(withParsedData.data) as unknown;
            } catch {
              // Keep the raw value when it is not JSON.
            }
          }
          return minimiseJson(withParsedData, options.includeBodies === true);
        }),
        null,
        2,
      );
      const fileContent = `${content}\n`;
      const hash = sha256(fileContent);
      // Recorded paths point at the PUBLISHED location, not the staging one.
      const publishPath = join(publishDir, name);
      try {
        writeFileSync(join(stagingDir, name), fileContent, "utf8");
        writeFileSync(join(stagingDir, `${name}.sha256`), `${hash}\n`, "utf8");
      } catch (err) {
        throw mapFsError(err, "Failed to write an export file");
      }
      files.push({ path: publishPath, hash });
    };

    collect(
      "project.json",
      db.all(
        "SELECT project_id, display_name, created_at, data FROM projects WHERE project_id = ?",
        options.projectId,
      ),
    );
    collect(
      "tasks.json",
      db.all(
        "SELECT task_id, project_id, status, created_at, updated_at, data FROM tasks WHERE project_id = ?",
        options.projectId,
      ),
    );
    collect(
      "events.json",
      db.all(
        `SELECT event_id, idempotency_key, project_id, task_id, session_id, event_type,
                occurred_at, received_at, privacy_class, stream_sequence, data
         FROM events WHERE project_id = ? ORDER BY stream_sequence`,
        options.projectId,
      ),
    );
    collect(
      "decisions.json",
      db.all(
        "SELECT decision_id, event_id, project_id, task_id, category, created_at, data FROM decisions WHERE project_id = ? ORDER BY created_at",
        options.projectId,
      ),
    );
    collect(
      "claims.json",
      db.all(
        "SELECT claim_id, project_id, task_id, type, status, confidence, text, data FROM claims WHERE project_id = ?",
        options.projectId,
      ),
    );
    collect(
      "evidence.json",
      db.all(
        `SELECT evidence_id, project_id, task_id, type, status, excerpt, content_hash,
                recorded_by, observed_at, expires_at, data
         FROM evidence_items WHERE project_id = ?`,
        options.projectId,
      ),
    );
    collect(
      "conversations.json",
      db.all(
        `SELECT m.message_id, m.conversation_id, m.role, m.body, m.status, m.created_at, m.data
         FROM conversation_messages m
         JOIN conversations c ON c.conversation_id = m.conversation_id
         WHERE c.project_id = ? ORDER BY m.created_at`,
        options.projectId,
      ),
    );

    const allHashes = files.map((f) => f.hash).join("");
    const contentHash = sha256(allHashes);
    const createdAt = Date.now();
    const manifestJson = validateJson(
      ExportManifestSchema,
      {
        exportId,
        projectId: options.projectId,
        kind: options.includeBodies === true ? "full" : "minimal",
        createdAt,
        contentHash,
        files: files.map((f) => ({ name: basename(f.path), hash: f.hash })),
      },
      "Export manifest",
    );
    try {
      writeFileSync(join(stagingDir, "manifest.json"), `${manifestJson}\n`, "utf8");
      writeFileSync(join(stagingDir, "manifest.json.sha256"), `${sha256(`${manifestJson}\n`)}\n`, "utf8");
    } catch (err) {
      throw mapFsError(err, "Failed to write the export manifest");
    }

    // ── Atomic publish: one rename, no half-written directory visible ──
    try {
      renameSync(stagingDir, publishDir);
    } catch (err) {
      rmSync(stagingDir, { recursive: true, force: true });
      throw mapFsError(err, "Failed to publish the export directory");
    }

    // ── Metadata row inside a short write transaction, AFTER file IO ──
    try {
      withTransaction(db, (tx) => {
        tx.run(
          `INSERT INTO export_metadata
             (export_id, project_id, task_id, kind, scope_json, output_path, content_hash, status, created_at, expires_at, data)
           VALUES (?, ?, NULL, ?, ?, ?, ?, 'ready', ?, ?, ?)`,
          exportId,
          options.projectId,
          options.includeBodies === true ? "full" : "minimal",
          validateJson(
            ExportMetadataSchema.shape.scope,
            { projectId: options.projectId, includeBodies: options.includeBodies === true },
            "Export metadata scope",
          ),
          publishDir,
          contentHash,
          createdAt,
          createdAt + EXPORT_TTL_MS,
          validateJson(
            ExportMetadataSchema.shape.data,
            { fileCount: files.length },
            "Export metadata data",
          ),
        );
      });
    } catch (err) {
      // The metadata is the record of the export: without it the published
      // directory is an orphan, so it is removed again.
      rmSync(publishDir, { recursive: true, force: true });
      throw err;
    }

    return { exportId, files };
  } catch (err) {
    // Failure at any point: the staging directory never survives.
    rmSync(stagingDir, { recursive: true, force: true });
    throw err;
  } finally {
    db.maintenanceOwned = false;
    guard.release();
  }
}

const SENSITIVE_KEYS = new Set(["body", "excerpt", "text", "summary", "content", "prompt", "output"]);
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\/|\\\\)/;

/**
 * Minimises exported JSON: sensitive keys are dropped unless bodies are
 * explicitly included, and absolute paths — drive, UNC, device and POSIX
 * forms, plus their JSON-escaped variants (doubled backslashes) — always
 * shrink to their basename, independent of includeBodies.
 */
export function minimiseJson(value: unknown, includeBodies: boolean): unknown {
  if (typeof value === "string") {
    // A value may carry the literal JSON-escaped form of a path
    // (e.g. `C:\\Users\\...` with doubled backslashes); unescape it first
    // so escaped absolute paths are minimised too.
    const unescaped = value.replace(/\\{2,}/g, "\\");
    if (ABSOLUTE_PATH.test(unescaped)) {
      const name = basename(unescaped);
      return name === "" ? value : name;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => minimiseJson(item, includeBodies));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (!includeBodies && SENSITIVE_KEYS.has(key)) continue;
      out[key] = minimiseJson(child, includeBodies);
    }
    return out;
  }
  return value;
}

/**
 * Clears ONE export using its export_metadata record: the output path is
 * read from the database, verified to name this export's directory inside
 * the data root, checked against the manifest, and only then deleted.
 * Directories are never discovered by scanning for suffixes.
 */
export function clearExportByMetadata(db: StorageDatabase, exportId: string): void {
  if (typeof exportId !== "string" || exportId.length === 0) {
    throw new SestinaError(SestinaErrorCode.validation_failed, "Invalid export id");
  }
  const row = db.get<{ output_path: string }>(
    "SELECT output_path FROM export_metadata WHERE export_id = ?",
    exportId,
  );
  if (!row) {
    throw new SestinaError(SestinaErrorCode.validation_failed, "Export not found");
  }
  const dir = assertExportPathContained(exportId, maintenanceRootOf(db.path), row.output_path);
  if (!existsSync(dir)) return;
  // Never delete a directory the metadata does not describe.
  readValidatedExportManifest(exportId, dir);
  deleteExportDirectory(dir);
}

export function ensureExportDir(destinationDir: string): string {
  const resolvedDir = resolve(destinationDir);
  try {
    mkdirSync(resolvedDir, { recursive: true });
  } catch (err) {
    throw mapFsError(err, "Failed to create the export directory");
  }
  return resolvedDir;
}
