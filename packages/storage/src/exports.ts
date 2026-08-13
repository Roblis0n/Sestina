import { mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { generateId } from "@sestina/schema";
import type { StorageDatabase } from "./connection.js";
import { withTransaction } from "./transaction.js";
import { MaintenanceFence } from "./maintenance-fence.js";
import { sha256 } from "./retention.js";
import { assertValidProjectId } from "./repositories/shared.js";

export interface ExportOptions {
  projectId: string;
  destinationDir: string;
  /** Default false: bodies, excerpts and absolute paths are minimised. */
  includeBodies?: boolean;
  dataRoot: string;
}

export interface ExportFile {
  path: string;
  hash: string;
}

export interface ExportResult {
  exportId: string;
  files: ExportFile[];
}

const EXPORT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Minimal privacy-preserving project export (docs/17 §10, docs/22 Task 6):
 * by default no bodies/excerpts/text and no absolute paths leave the
 * machine; every file carries a sha256 sidecar and an export_metadata row
 * (written inside a transaction). File IO happens outside the write
 * transaction (docs/22 Task 6 invariant).
 */
export async function exportProject(db: StorageDatabase, options: ExportOptions): Promise<ExportResult> {
  assertValidProjectId(options.projectId);
  const destinationDir = ensureExportDir(options.destinationDir);
  const exportId = generateId();
  const fence = await MaintenanceFence.acquire({ dataRoot: options.dataRoot, scope: "retention" });
  try {
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
      const path = join(destinationDir, name);
      writeFileSync(path, fileContent, "utf8");
      writeFileSync(`${path}.sha256`, `${hash}\n`, "utf8");
      files.push({ path, hash });
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

    // ── Metadata row inside a short write transaction ──
    await withTransaction(db, (tx) => {
      tx.run(
        `INSERT INTO export_metadata
           (export_id, project_id, task_id, kind, scope_json, output_path, content_hash, status, created_at, expires_at, data)
         VALUES (?, ?, NULL, ?, ?, ?, ?, 'ready', ?, ?, ?)`,
        exportId,
        options.projectId,
        options.includeBodies === true ? "full" : "minimal",
        JSON.stringify({ projectId: options.projectId, includeBodies: options.includeBodies === true }),
        destinationDir,
        contentHash,
        Date.now(),
        Date.now() + EXPORT_TTL_MS,
        JSON.stringify({ fileCount: files.length }),
      );
    });

    return { exportId, files };
  } finally {
    fence.release();
  }
}

const SENSITIVE_KEYS = new Set(["body", "excerpt", "text", "summary", "content", "prompt", "output"]);
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\/|\\\\)/;

/**
 * Minimises exported JSON: absolute paths shrink to their basename and
 * sensitive keys are dropped unless bodies are explicitly included.
 */
export function minimiseJson(value: unknown, includeBodies: boolean): unknown {
  if (typeof value === "string") {
    if (!includeBodies && ABSOLUTE_PATH.test(value)) {
      return basename(value);
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

/** Removes every exported file under a directory (no sidecars orphaned). */
export function clearExports(destinationDir: string): void {
  if (!existsSync(destinationDir)) return;
  for (const name of readdirSync(destinationDir)) {
    if (name.endsWith(".json") || name.endsWith(".json.sha256")) {
      rmSync(join(destinationDir, name), { force: true });
    }
  }
}

export function ensureExportDir(destinationDir: string): string {
  const resolvedDir = resolve(destinationDir);
  mkdirSync(resolvedDir, { recursive: true });
  return resolvedDir;
}
