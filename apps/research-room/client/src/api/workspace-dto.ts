import { decodeLocalJson, type LocalJson } from "./kernel-dto.js";
export interface WorkspaceEntryDto {
  id: string;
  kind: string;
  title: string;
  status: string;
  source: string;
  version: number;
  revision: number;
  at: string;
  href: string;
  summary: string;
  reason: string;
  actions: string[];
  related: string[];
  matchReason?: string | null;
}
export interface WorkspaceDto {
  projectId: string;
  sourceProjectStateRevision: number;
  canonicalInputHash: string;
  workflowInputHash: string;
  privacyInputHash: string;
  inputHash: string;
  schemaVersion: 1;
  policyVersion: 1;
  evaluatedAt: string;
  validUntil: string | null;
  status: "ready";
  indexMode: "snapshot";
  view: string;
  items: WorkspaceEntryDto[];
  recent: WorkspaceEntryDto[];
  total: number;
  nextCursor: string | null;
  brief: { question: string; task: string; id: string | null };
  detail: LocalJson;
}
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("invalid_payload");
  return v as Record<string, unknown>;
};
export function decodeWorkspace(value: unknown): WorkspaceDto {
  const v = object(decodeLocalJson(value));
  if (
    v.schemaVersion !== 1 ||
    v.policyVersion !== 1 ||
    v.status !== "ready" ||
    v.indexMode !== "snapshot" ||
    typeof v.projectId !== "string" ||
    !/^rprj_[0-9A-HJKMNP-TV-Z]{26}$/.test(v.projectId) ||
    !Number.isSafeInteger(v.sourceProjectStateRevision) ||
    !Number.isSafeInteger(v.total)
  )
    throw new Error("invalid_payload");
  for (const key of [
    "canonicalInputHash",
    "workflowInputHash",
    "privacyInputHash",
    "inputHash",
  ])
    if (typeof v[key] !== "string" || !/^[a-f0-9]{64}$/.test(v[key]))
      throw new Error("invalid_payload");
  if (
    typeof v.evaluatedAt !== "string" ||
    !Number.isFinite(Date.parse(v.evaluatedAt)) ||
    (v.validUntil !== null &&
      (typeof v.validUntil !== "string" ||
        !Number.isFinite(Date.parse(v.validUntil))))
  )
    throw new Error("invalid_payload");
  if (
    v.nextCursor !== null &&
    (typeof v.nextCursor !== "string" ||
      !/^[a-f0-9]{64}:\d+$/.test(v.nextCursor))
  )
    throw new Error("invalid_payload");
  for (const field of ["items", "recent"]) {
    if (!Array.isArray(v[field]) || v[field].length > 100)
      throw new Error("invalid_payload");
    for (const raw of v[field]) {
      const r = object(raw);
      for (const key of [
        "id",
        "kind",
        "title",
        "status",
        "source",
        "at",
        "href",
        "summary",
        "reason",
      ])
        if (typeof r[key] !== "string") throw new Error("invalid_payload");
      if (
        !Number.isSafeInteger(r.version) ||
        !Number.isSafeInteger(r.revision) ||
        !(r.href as string).startsWith("/project/") ||
        (r.href as string).includes("\\")
      )
        throw new Error("invalid_payload");
      for (const key of ["actions", "related"])
        if (
          !Array.isArray(r[key]) ||
          r[key].some((x: unknown) => typeof x !== "string")
        )
          throw new Error("invalid_payload");
    }
  }
  const brief = object(v.brief);
  if (
    typeof brief.question !== "string" ||
    typeof brief.task !== "string" ||
    (brief.id !== null && typeof brief.id !== "string")
  )
    throw new Error("invalid_payload");
  return v as unknown as WorkspaceDto;
}
