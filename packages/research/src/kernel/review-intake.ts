import {
  KernelFault,
  kernelRecord,
  kernelText,
  kernelId,
  kernelHash,
  kernelTime,
  kernelInteger,
  freezeKernel,
} from "./records.js";
export interface ReviewDraftEnvelope {
  readonly schemaVersion: "1.0.0";
  readonly projectId: string;
  readonly suggestion: string;
  readonly publicReason?: string;
  readonly source: {
    readonly kind: "host" | "skill" | "hook" | "clipboard_import";
    readonly hostId: string;
    readonly invocationId: string;
    readonly skillId?: string;
    readonly skillVersion?: string;
  };
  readonly requestedTarget?: {
    readonly kind: "brief" | "decision" | "evidence" | "issue" | "artifact";
    readonly id?: string;
  };
  readonly fileReferences?: readonly {
    readonly displayName: string;
    readonly pathToken: string;
    readonly contentHash?: string;
    readonly lineStart?: number;
    readonly lineEnd?: number;
  }[];
  readonly createdAt: string;
  readonly envelopeHash: string;
}
export function reviewEnvelopeHash(
  input: Omit<ReviewDraftEnvelope, "envelopeHash"> | ReviewDraftEnvelope,
): string {
  return kernelHash(
    Object.fromEntries(
      Object.entries(input).filter(([k]) => k !== "envelopeHash"),
    ),
  );
}
export function parseReviewDraftEnvelope(input: unknown): ReviewDraftEnvelope {
  const v = kernelRecord(input, [
    "schemaVersion",
    "projectId",
    "suggestion",
    "publicReason",
    "source",
    "requestedTarget",
    "fileReferences",
    "createdAt",
    "envelopeHash",
  ]);
  if (
    v.schemaVersion !== "1.0.0" ||
    Buffer.byteLength(JSON.stringify(input)) > 131072
  )
    throw new KernelFault("invalid_record");
  kernelId(v.projectId, "rprj_");
  kernelText(v.suggestion, 65536);
  kernelTime(v.createdAt);
  if (v.publicReason !== undefined) kernelText(v.publicReason, 8192);
  const s = kernelRecord(v.source, [
    "kind",
    "hostId",
    "invocationId",
    "skillId",
    "skillVersion",
  ]);
  if (!["host", "skill", "hook", "clipboard_import"].includes(String(s.kind)))
    throw new KernelFault("invalid_record");
  kernelText(s.hostId, 128);
  kernelText(s.invocationId, 128);
  if (s.kind === "skill") {
    kernelText(s.skillId, 128);
    kernelText(s.skillVersion, 32);
  } else if (s.skillId !== undefined || s.skillVersion !== undefined)
    throw new KernelFault("invalid_record");
  if (v.requestedTarget !== undefined) {
    const t = kernelRecord(v.requestedTarget, ["kind", "id"]);
    if (
      !["brief", "decision", "evidence", "issue", "artifact"].includes(
        String(t.kind),
      )
    )
      throw new KernelFault("invalid_record");
    if (t.id !== undefined) kernelText(t.id, 160);
  }
  if (v.fileReferences !== undefined) {
    if (!Array.isArray(v.fileReferences) || v.fileReferences.length > 32)
      throw new KernelFault("invalid_record");
    for (const item of v.fileReferences) {
      const f = kernelRecord(item, [
        "displayName",
        "pathToken",
        "contentHash",
        "lineStart",
        "lineEnd",
      ]);
      kernelText(f.displayName, 256);
      kernelText(f.pathToken, 1024);
      if (
        f.contentHash !== undefined &&
        !(
          typeof f.contentHash === "string" &&
          /^[a-f0-9]{64}$/.test(f.contentHash)
        )
      )
        throw new KernelFault("invalid_record");
      if (f.lineStart !== undefined || f.lineEnd !== undefined) {
        kernelInteger(f.lineStart);
        kernelInteger(f.lineEnd);
        if (f.lineEnd < f.lineStart) throw new KernelFault("invalid_record");
      }
    }
  }
  if (
    reviewEnvelopeHash(v as unknown as ReviewDraftEnvelope) !== v.envelopeHash
  )
    throw new KernelFault("invalid_record");
  return freezeKernel(v as unknown as ReviewDraftEnvelope);
}
export interface ReviewIntake {
  readonly envelope: ReviewDraftEnvelope;
  readonly connectionId: string;
  readonly authority: "draft_only";
  readonly fileAccess: "not_read";
}
export function parseReviewIntake(input: unknown): ReviewIntake {
  const v = kernelRecord(input, [
    "envelope",
    "connectionId",
    "authority",
    "fileAccess",
  ]);
  parseReviewDraftEnvelope(v.envelope);
  kernelText(v.connectionId, 160);
  if (v.authority !== "draft_only" || v.fileAccess !== "not_read")
    throw new KernelFault("invalid_record");
  return freezeKernel(v as unknown as ReviewIntake);
}
