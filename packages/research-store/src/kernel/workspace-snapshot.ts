import {
  kernelHash,
  kernelTime,
  kernelBytesHash,
  KernelFault,
  type KernelReader,
} from "@sestina/research";
import { withReadSnapshot, type StorageDatabase } from "@sestina/storage";
import { readKernelSnapshot } from "./state.js";
import {
  createKernelRepositories,
  validateKernelRelations,
} from "./repositories.js";
import { validateLegacyRedaction } from "./privacy.js";

export const WORKSPACE_PROJECTION_POLICY = 1;

/** All dependencies are captured under the same SQLite read transaction. No authority is returned. */
export function readKernelWorkspaceSnapshot(
  db: StorageDatabase,
  projectId: string,
  evaluatedAt = new Date().toISOString(),
) {
  kernelTime(evaluatedAt);
  return withReadSnapshot(db, () => {
    const snapshot = readKernelSnapshot(db, projectId);
    const repos = createKernelRepositories(db);
    function collect<T>(repository: KernelReader<T>): T[] {
      const items: T[] = [];
      let cursor: string | undefined;
      do {
        const page = repository.listByProject(projectId, {
          limit: 200,
          ...(cursor ? { cursor } : {}),
        });
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      return items;
    }
    const workflows = {
      reviews: collect(repos.reviews),
      attempts: collect(repos.attempts),
      corrections: collect(repos.corrections),
      receipts: collect(repos.receipts),
      manifests: collect(repos.manifests),
      events: collect(repos.events),
    };
    const mappings = db.all<{
      source_kind: string;
      source_id: string;
      classification: string;
      source_hash: string;
    }>(
      "SELECT source_kind,source_id,classification,source_hash FROM research_legacy_mappings WHERE project_id=? ORDER BY source_kind,source_id",
      projectId,
    );
    const legacyBodies = new Map<
      string,
      { summary: string; at: string; bodyHash: string }
    >();
    for (const [table, id] of [
      ["research_room_receipts", "receipt_id"],
      ["deliberation_rooms", "room_id"],
      ["correction_appeals", "appeal_id"],
      ["closed_external_app_pilots", "pilot_id"],
    ] as const) {
      for (const row of db.all<{ id: string; data: string }>(
        `SELECT ${id} id,data FROM ${table} WHERE project_id=?`,
        projectId,
      )) {
        const raw: unknown = JSON.parse(row.data);
        const value =
          raw && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)
            : {};
        // Only direct user-authored fields; never manifests, model responses or path-bearing host envelopes.
        const summary =
          value.bodyAvailable === false
            ? ""
            : ["question", "reason", "userReason", "goal", "title"]
                .flatMap((key) =>
                  typeof value[key] === "string" ? [value[key]] : [],
                )
                .join("\n");
        legacyBodies.set(`${table}:${row.id}`, {
          summary,
          at: typeof value.createdAt === "string" ? value.createdAt : "",
          bodyHash: kernelBytesHash(row.data),
        });
      }
    }
    const legacy = mappings.map((row) => {
      const body = legacyBodies.get(`${row.source_kind}:${row.source_id}`);
      if (!body) throw new KernelFault("corrupt_state");
      if (body.bodyHash !== row.source_hash) {
        const table = row.source_kind;
        const idColumn =
          table === "research_room_receipts"
            ? "receipt_id"
            : table === "deliberation_rooms"
              ? "room_id"
              : table === "correction_appeals"
                ? "appeal_id"
                : "pilot_id";
        const raw = db.get<{ data: string }>(
          `SELECT data FROM ${table} WHERE project_id=? AND ${idColumn}=?`,
          projectId,
          row.source_id,
        );
        if (
          !raw ||
          !validateLegacyRedaction(
            db,
            projectId,
            table,
            row.source_id,
            raw.data,
            row.source_hash,
          )
        )
          throw new KernelFault("corrupt_state");
      }
      return { ...row, ...body };
    });
    validateKernelRelations(db, projectId, workflows);
    const workflowInputHash = kernelHash({ workflows, legacy });
    const privacyInputHash = kernelHash(snapshot.state.metadata);
    const expiries = snapshot.state.objects
      .filter((o) => o.kind === "memory")
      .flatMap((o) => {
        const retention = o.data.retention;
        if (
          !retention ||
          typeof retention !== "object" ||
          Array.isArray(retention)
        )
          return [];
        const at = "expiresAt" in retention ? retention.expiresAt : undefined;
        return typeof at === "string" && at > evaluatedAt ? [at] : [];
      })
      .sort();
    const identity = {
      projectId,
      sourceProjectStateRevision: snapshot.head.revision,
      // readKernelSnapshot already verifies the entire state against this hash.
      canonicalInputHash: snapshot.head.canonicalHash,
      workflowInputHash,
      privacyInputHash,
      schemaVersion: 1,
      policyVersion: WORKSPACE_PROJECTION_POLICY,
      validUntil: expiries[0] ?? null,
    };
    // The repositories and canonical snapshot have already decoded and frozen
    // each record. Freeze only these newly owned containers, instead of cloning
    // and validating the entire large project for a second time.
    for (const records of Object.values(workflows)) Object.freeze(records);
    Object.freeze(workflows);
    for (const record of legacy) Object.freeze(record);
    Object.freeze(legacy);
    Object.freeze(identity);
    return Object.freeze({
      ...snapshot,
      workflows,
      legacy,
      identity,
      inputHash: kernelHash(identity),
      evaluatedAt,
    });
  });
}
export type KernelWorkspaceSnapshot = ReturnType<
  typeof readKernelWorkspaceSnapshot
>;
