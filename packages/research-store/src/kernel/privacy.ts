import {
  KernelFault,
  kernelBytesHash,
  kernelHash,
  kernelCanonicalJson,
  parseKernelManifest,
  parseKernelAttempt,
  parseKernelReview,
  KERNEL_TERMINAL_STATES,
} from "@sestina/research";
import type { StorageDatabase } from "@sestina/storage";
import { clearKernelReadCache } from "./validated-json.js";

/** A redacted body is readable only with a matching canonical privacy proof. */
export function validateKernelBodyRedaction(
  db: StorageDatabase,
  projectId: string,
  table: string,
  item: {
    id: string;
    bodyRedaction?: { redactionId: string; originalRecordHash: string };
  },
): void {
  if (!item.bodyRedaction) return;
  const row = db.get<{ data: string }>(
    "SELECT data FROM research_privacy_redactions WHERE project_id=? AND redaction_id=?",
    projectId,
    item.bodyRedaction.redactionId,
  );
  if (!row) throw new KernelFault("corrupt_state");
  const proof = JSON.parse(row.data) as {
    table: string;
    recordId: string;
    beforeHash: string;
    afterHash: string;
  };
  if (
    proof.table !== table ||
    proof.recordId !== item.id ||
    proof.beforeHash !== item.bodyRedaction.originalRecordHash ||
    proof.afterHash !== kernelHash(item)
  )
    throw new KernelFault("corrupt_state");
}

export function validateLegacyRedaction(
  db: StorageDatabase,
  projectId: string,
  table: string,
  id: string,
  raw: string,
  originalHash: string,
): boolean {
  const parsed = JSON.parse(raw) as {
    schemaVersion?: string;
    redactionId?: string;
    bodyAvailable?: boolean;
    originalRecordHash?: string;
  };
  if (
    parsed.schemaVersion !== "2.0.0" ||
    parsed.bodyAvailable !== false ||
    parsed.originalRecordHash !== originalHash ||
    !parsed.redactionId
  )
    return false;
  const row = db.get<{ data: string }>(
    "SELECT data FROM research_privacy_redactions WHERE project_id=? AND redaction_id=?",
    projectId,
    parsed.redactionId,
  );
  if (!row) return false;
  const proof = JSON.parse(row.data) as {
    table: string;
    recordId: string;
    beforeHash: string;
    afterHash: string;
  };
  return (
    proof.table === table &&
    proof.recordId === id &&
    proof.beforeHash === originalHash &&
    proof.afterHash === kernelHash(parsed)
  );
}

/** Erase tracked local workflow copies in the same transaction as the Memory tombstone. */
export function redactKernelMemoryCopies(
  db: StorageDatabase,
  projectId: string,
  itemId: string,
  revision: number,
  at: string,
  commandId: string,
  inject?: () => void,
): void {
  if (!db.isKernelCanonicalWrite || !db.isTransaction)
    throw new KernelFault("authority_required");
  clearKernelReadCache(db);
  const proofId = (table: string, id: string) =>
    `rapc_${kernelHash({ commandId, table, id }).slice(0, 26).toUpperCase()}`;
  const recordProof = (
    table: string,
    id: string,
    raw: string,
    after: unknown,
  ) => {
    db.run(
      "INSERT INTO research_privacy_redactions(redaction_id,project_id,object_kind,object_id,source_revision,created_at,data) VALUES(?,?,?,?,?,?,?)",
      proofId(table, id),
      projectId,
      "memory_copy",
      itemId,
      revision,
      at,
      kernelCanonicalJson({
        schemaVersion: "2.0.0",
        kind: "memory_copy_redaction",
        table,
        recordId: id,
        beforeHash: kernelBytesHash(raw),
        afterHash: kernelHash(after),
        bodyAvailable: false,
      }),
    );
  };
  const reviewIds = new Set<string>();
  for (const row of db.all<{ data: string }>(
    "SELECT data FROM context_manifests WHERE project_id=?",
    projectId,
  )) {
    const m = parseKernelManifest(JSON.parse(row.data));
    if (m.bodyRedaction || !m.selectedMemory.some((ref) => ref.id === itemId))
      continue;
    reviewIds.add(m.reviewId);
    const after = parseKernelManifest({
      ...m,
      exactRequestBody: null,
      bodyRedaction: {
        redactionId: proofId("context_manifests", m.id),
        originalRecordHash: kernelBytesHash(row.data),
      },
      version: m.version + 1,
      updatedAt: at,
    });
    recordProof("context_manifests", m.id, row.data, after);
    db.run(
      "UPDATE context_manifests SET data=?,version=?,updated_at=? WHERE project_id=? AND manifest_id=?",
      kernelCanonicalJson(after),
      after.version,
      at,
      projectId,
      m.id,
    );
    inject?.();
    for (const attemptRow of db.all<{ data: string }>(
      "SELECT data FROM research_provider_attempts WHERE project_id=? AND manifest_id=?",
      projectId,
      m.id,
    )) {
      const attempt = parseKernelAttempt(JSON.parse(attemptRow.data));
      if (attempt.bodyRedaction) continue;
      const envelope = attempt.assessment?.envelope;
      const assessment = attempt.assessment
        ? {
            ...attempt.assessment,
            publicSummary: "Local assessment body removed by user Forget.",
            ...(envelope
              ? {
                  envelope: Object.fromEntries(
                    Object.entries(envelope).filter(
                      ([key]) => key !== "assessment",
                    ),
                  ),
                }
              : {}),
          }
        : null;
      const status =
        attempt.status === "running"
          ? "uncertain"
          : attempt.status === "prepared"
            ? "cancelled"
            : attempt.status;
      const running =
        attempt.status === "running" || attempt.status === "prepared";
      const afterAttempt = parseKernelAttempt({
        ...attempt,
        assessment,
        status,
        ...(running
          ? {
              failureCode: "memory_forgotten",
              version: attempt.version + 1,
              updatedAt: at,
            }
          : {}),
        bodyRedaction: {
          redactionId: proofId("research_provider_attempts", attempt.id),
          originalRecordHash: kernelBytesHash(attemptRow.data),
        },
      });
      recordProof(
        "research_provider_attempts",
        attempt.id,
        attemptRow.data,
        afterAttempt,
      );
      if (running)
        db.run(
          "UPDATE research_provider_attempts SET data=?,status=?,version=?,updated_at=? WHERE project_id=? AND attempt_id=?",
          kernelCanonicalJson(afterAttempt),
          afterAttempt.status,
          afterAttempt.version,
          at,
          projectId,
          attempt.id,
        );
      else {
        const definition = db.get<{ sql: string }>(
          "SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='kernel_attempt_terminal'",
        )?.sql;
        if (!definition) throw new KernelFault("corrupt_state");
        db.withKernelPrivacyRedaction(() => {
          db.exec("DROP TRIGGER kernel_attempt_terminal");
          db.run(
            "UPDATE research_provider_attempts SET data=? WHERE project_id=? AND attempt_id=?",
            kernelCanonicalJson(afterAttempt),
            projectId,
            attempt.id,
          );
          inject?.();
          db.exec(definition);
        });
      }
    }
  }
  for (const id of reviewIds) {
    const row = db.get<{ data: string }>(
      "SELECT data FROM research_reviews WHERE project_id=? AND review_id=?",
      projectId,
      id,
    );
    if (!row) throw new KernelFault("corrupt_state");
    const review = parseKernelReview(JSON.parse(row.data));
    if (KERNEL_TERMINAL_STATES.includes(review.status)) continue;
    const after = parseKernelReview({
      ...review,
      status: "stale",
      staleReason: "memory_forgotten",
      effectDraft: review.effectDraft
        ? { ...review.effectDraft, invalidated: true }
        : null,
      version: review.version + 1,
      updatedAt: at,
    });
    db.run(
      "UPDATE research_reviews SET data=?,status=?,version=?,updated_at=? WHERE project_id=? AND review_id=?",
      kernelCanonicalJson(after),
      after.status,
      after.version,
      at,
      projectId,
      id,
    );
  }
  // Frozen legacy aggregates cannot receive a business transition. The narrow
  // erasure capability replaces only a linked body with a hash-bound tombstone;
  // its original triggers are restored before this transaction can commit.
  const legacy: {
    table: string;
    column: string;
    id: string;
    raw: string;
    parent?: string;
  }[] = [];
  for (const [table, column] of [
    ["research_room_receipts", "receipt_id"],
    ["correction_appeals", "appeal_id"],
    ["deliberation_rooms", "room_id"],
    ["closed_external_app_pilots", "pilot_id"],
    ["closed_external_app_pilot_attempts", "attempt_id"],
    ["closed_external_app_pilot_events", "event_id"],
  ] as const) {
    for (const row of db.all<{ id: string; data: string; parent?: string }>(
      `SELECT ${column} id,data${table.startsWith("closed_external_app_pilot_") ? ",pilot_id parent" : ""} FROM ${table} WHERE project_id=?`,
      projectId,
    ))
      legacy.push({
        table,
        column,
        id: row.id,
        raw: row.data,
        ...(row.parent ? { parent: row.parent } : {}),
      });
  }
  const linked = new Set([itemId]);
  const selected = new Set<string>();
  let added: boolean;
  do {
    added = false;
    for (const row of legacy) {
      const key = `${row.table}:${row.id}`;
      if (
        !selected.has(key) &&
        [...linked].some((id) => row.parent === id || row.raw.includes(id))
      ) {
        selected.add(key);
        linked.add(row.id);
        added = true;
      }
    }
  } while (added);
  for (const row of legacy.filter((r) => selected.has(`${r.table}:${r.id}`))) {
    const existing = JSON.parse(row.raw) as { bodyAvailable?: boolean };
    if (existing.bodyAvailable === false) continue;
    const after = {
      schemaVersion: "2.0.0",
      bodyAvailable: false,
      reason: "user_memory_forget",
      redactionId: proofId(row.table, row.id),
      originalRecordHash: kernelBytesHash(row.raw),
    };
    recordProof(row.table, row.id, row.raw, after);
    const triggers = [
      `kernel_legacy_${row.table}_update`,
      ...(row.table === "closed_external_app_pilot_events"
        ? ["trg_closed_external_app_pilot_events_no_update"]
        : []),
    ];
    const definitions = triggers.map((name) => {
      const sql = db.get<{ sql: string }>(
        "SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?",
        name,
      )?.sql;
      if (!sql) throw new KernelFault("corrupt_state");
      return { name, sql };
    });
    db.withKernelPrivacyRedaction(() => {
      for (const trigger of definitions)
        db.exec(`DROP TRIGGER ${trigger.name}`);
      db.run(
        `UPDATE ${row.table} SET data=? WHERE project_id=? AND ${row.column}=?`,
        kernelCanonicalJson(after),
        projectId,
        row.id,
      );
      inject?.();
      for (const trigger of definitions) db.exec(trigger.sql);
    });
  }
  // Derived caches can be rebuilt; none may retain pre-forget content.
  db.run(
    "UPDATE research_projection_metadata SET status='rebuilding',version=version+1,data='{}' WHERE project_id=? AND projection_kind<>'brief_file'",
    projectId,
  );
}
