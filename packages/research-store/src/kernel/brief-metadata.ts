import {
  KernelFault,
  kernelId,
  kernelInteger,
  kernelHash,
  kernelCanonicalJson,
  parseKernelBriefMetadataRecord,
  parseResearchBrief,
  type KernelBriefMetadataRecord,
} from "@sestina/research";
import type { StorageDatabase } from "@sestina/storage";
import { decodeKernelJson } from "./state.js";
export function readKernelBriefMetadata(
  db: StorageDatabase,
  projectId: string,
  briefId: string,
): KernelBriefMetadataRecord | undefined {
  kernelId(projectId, "rprj_");
  kernelId(briefId, "rbrf_");
  const row = db.get<{ version: number; data: string }>(
    "SELECT version,data FROM research_brief_metadata WHERE project_id=? AND brief_id=?",
    projectId,
    briefId,
  );
  return row
    ? parseKernelBriefMetadataRecord({
        projectId,
        briefId,
        version: row.version,
        metadata: decodeKernelJson(row.data),
      })
    : undefined;
}
/** Part of the same canonical transaction as the Brief aggregate. */
export function writeKernelBriefMetadata(
  db: StorageDatabase,
  input: KernelBriefMetadataRecord,
  expectedVersion: number,
): KernelBriefMetadataRecord {
  if (!db.isKernelCanonicalWrite || !db.isTransaction)
    throw new KernelFault("authority_required");
  const next = parseKernelBriefMetadataRecord(input);
  kernelInteger(expectedVersion);
  const old = readKernelBriefMetadata(db, next.projectId, next.briefId);
  if (old?.version !== expectedVersion || next.version !== expectedVersion + 1)
    throw new KernelFault("stale_object");
  const row = db.get<{ data: string }>(
    "SELECT data FROM research_briefs WHERE project_id=? AND brief_id=?",
    next.projectId,
    next.briefId,
  );
  const parsed = parseResearchBrief(
    row ? decodeKernelJson(row.data) : undefined,
  );
  if (
    !parsed.ok ||
    parsed.value.version !== next.version ||
    parsed.value.currentVersionId !== next.metadata.currentVersionId ||
    kernelHash(parsed.value.versions.map((v) => v.id)) !==
      kernelHash(next.metadata.versions.map((v) => v.versionId))
  )
    throw new KernelFault("relation_mismatch");
  if (
    next.metadata.legacyPayloadHash !== old.metadata.legacyPayloadHash ||
    kernelHash(
      next.metadata.versions.slice(0, old.metadata.versions.length),
    ) !== kernelHash(old.metadata.versions)
  )
    throw new KernelFault("illegal_transition");
  const changed = db.run(
    "UPDATE research_brief_metadata SET version=?,data=? WHERE project_id=? AND brief_id=? AND version=?",
    next.version,
    kernelCanonicalJson(next.metadata),
    next.projectId,
    next.briefId,
    expectedVersion,
  );
  if (Number(changed.changes) !== 1) throw new KernelFault("stale_object");
  return next;
}
export function validateKernelBriefMetadata(
  db: StorageDatabase,
  projectId: string,
): void {
  const rows = db.all<{ brief_id: string; data: string }>(
    "SELECT brief_id,data FROM research_briefs WHERE project_id=?",
    projectId,
  );
  for (const row of rows) {
    const b = parseResearchBrief(decodeKernelJson(row.data)),
      m = readKernelBriefMetadata(db, projectId, row.brief_id);
    if (
      !b.ok ||
      m?.version !== b.value.version ||
      m.metadata.currentVersionId !== b.value.currentVersionId ||
      kernelHash(m.metadata.versions.map((v) => v.versionId)) !==
        kernelHash(b.value.versions.map((v) => v.id))
    )
      throw new KernelFault("corrupt_state");
  }
}
