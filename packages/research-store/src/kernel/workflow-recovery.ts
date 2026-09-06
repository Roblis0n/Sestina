import {
  KernelFault,
  kernelCanonicalJson,
  kernelInteger,
  kernelText,
  kernelBytesHash,
  type KernelJson,
  type KernelResult,
} from "@sestina/research";
import {
  withTransaction,
  withReadSnapshot,
  type StorageDatabase,
} from "@sestina/storage";
import { createKernelRepositories } from "./repositories.js";
import {
  decodeKernelJson,
  readKernelHead,
  readKernelSnapshot,
  type KernelSnapshot,
} from "./state.js";

/** Records uncertainty only. This module has no Provider or network dependency. */
export function recoverKernelWorkflows(
  db: StorageDatabase,
  projectId: string,
  recoveredAt: string,
): KernelResult<readonly string[]> {
  try {
    const changed = withTransaction(db, () =>
      db.withKernelWrite("workflow", () => {
        readKernelSnapshot(db, projectId);
        const repos = createKernelRepositories(db);
        const recovered: string[] = [];
        for (const row of db.all<{ attempt_id: string; review_id: string }>(
          "SELECT attempt_id,review_id FROM research_provider_attempts WHERE project_id=? AND status='running' ORDER BY review_id,ordinal",
          projectId,
        )) {
          const attempt = repos.attempts.getById(projectId, row.attempt_id);
          const review = repos.reviews.getById(projectId, row.review_id);
          if (
            !attempt ||
            review?.status !== "provider_attempt_running" ||
            review.attemptIds.at(-1) !== attempt.id
          )
            throw new KernelFault("corrupt_state");
          repos.attempts.compareAndSwap(
            {
              ...attempt,
              status: "uncertain",
              failureCode: "process_interrupted",
              version: attempt.version + 1,
              updatedAt: recoveredAt,
            },
            attempt.version,
          );
          repos.reviews.compareAndSwap(
            {
              ...review,
              status: "provider_attempt_uncertain",
              version: review.version + 1,
              updatedAt: recoveredAt,
            },
            review.version,
          );
          recovered.push(review.id);
        }
        return Object.freeze(recovered);
      }),
    );
    return { ok: true, value: changed };
  } catch (e) {
    return {
      ok: false,
      error: {
        code: e instanceof KernelFault ? e.code : "storage_unavailable",
        changedObjects: [],
      },
    };
  }
}
export type KernelProjectionKind =
  "search" | "attention" | "today" | "resume" | "history" | "brief_file";
export function readKernelProjection(
  db: StorageDatabase,
  projectId: string,
  kind: KernelProjectionKind,
) {
  return withReadSnapshot(db, () => {
    const head = readKernelHead(db, projectId);
    const row = db.get<{
      source_revision: number;
      status: string;
      version: number;
      data: string;
    }>(
      "SELECT * FROM research_projection_metadata WHERE project_id=? AND projection_kind=?",
      projectId,
      kind,
    );
    if (!row) throw new KernelFault("corrupt_state");
    kernelInteger(row.version);
    kernelInteger(row.source_revision, 0);
    return {
      sourceProjectStateRevision: row.source_revision,
      status:
        row.source_revision === head.revision && row.status === "ready"
          ? ("ready" as const)
          : ("rebuilding" as const),
      version: row.version,
      data:
        row.source_revision === head.revision && row.status === "ready"
          ? decodeKernelJson(row.data)
          : null,
    };
  });
}
/** Build may fail; it is outside the canonical write transaction. */
export function rebuildKernelProjection(
  db: StorageDatabase,
  projectId: string,
  kind: KernelProjectionKind,
  build: (snapshot: KernelSnapshot) => KernelJson,
): KernelResult<number> {
  try {
    if (!["search", "attention", "today", "resume", "history"].includes(kind))
      throw new KernelFault("invalid_record");
    const snapshot = readKernelSnapshot(db, projectId);
    const data = kernelCanonicalJson(build(snapshot));
    return {
      ok: true,
      value: withTransaction(db, () =>
        db.withKernelWrite("workflow", () => {
          if (readKernelHead(db, projectId).revision !== snapshot.head.revision)
            throw new KernelFault("stale_revision");
          const changed = db.run(
            "UPDATE research_projection_metadata SET source_revision=?,status='ready',version=version+1,data=? WHERE project_id=? AND projection_kind=?",
            snapshot.head.revision,
            data,
            projectId,
            kind,
          );
          if (Number(changed.changes) !== 1)
            throw new KernelFault("corrupt_state");
          return snapshot.head.revision;
        }),
      ),
    };
  } catch (e) {
    return {
      ok: false,
      error: {
        code: e instanceof KernelFault ? e.code : "storage_unavailable",
        changedObjects: [],
      },
    };
  }
}
/** Explicit source-kind reader; it never exposes a legacy write operation. */
export function readKernelLegacyRecord(
  db: StorageDatabase,
  projectId: string,
  sourceKind: string,
  sourceId: string,
) {
  const columns: Record<string, string> = {
    research_room_receipts: "receipt_id",
    correction_appeals: "appeal_id",
    deliberation_rooms: "room_id",
    closed_external_app_pilots: "pilot_id",
  };
  const column = columns[sourceKind];
  if (!column) throw new KernelFault("invalid_record");
  kernelText(sourceId, 160);
  readKernelHead(db, projectId);
  const row = db.get<{
    data: string;
    projection: string;
    classification: string;
    source_hash: string;
  }>(
    `SELECT original.data,m.data projection,m.classification,m.source_hash FROM ${sourceKind} original JOIN research_legacy_mappings m ON m.project_id=original.project_id AND m.source_id=original.${column} AND m.source_kind=? WHERE original.project_id=? AND original.${column}=?`,
    sourceKind,
    projectId,
    sourceId,
  );
  if (row && kernelBytesHash(row.data) !== row.source_hash)
    throw new KernelFault("corrupt_state");
  return row
    ? {
        sourceKind,
        sourceId,
        classification: row.classification,
        canonicalAuthority: false as const,
        legacyPayload: decodeKernelJson(row.data),
        projection: decodeKernelJson(row.projection),
      }
    : undefined;
}
