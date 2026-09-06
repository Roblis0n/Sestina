import { createHash } from "node:crypto";
import {
  parseResearchIdFor,
  type ResearchIdPrefix,
} from "../identity/research-id.js";

export type KernelFaultCode =
  | "invalid_record"
  | "corrupt_state"
  | "future_schema"
  | "stale_revision"
  | "stale_object"
  | "idempotency_conflict"
  | "authority_required"
  | "legacy_readonly"
  | "illegal_transition"
  | "relation_mismatch"
  | "storage_unavailable"
  | "commit_uncertain";
export class KernelFault extends Error {
  constructor(
    readonly code: KernelFaultCode,
    readonly changedObjects: readonly KernelObjectRef[] = [],
  ) {
    super(code);
    this.name = "KernelFault";
  }
}
export type KernelResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: KernelFaultCode;
        readonly changedObjects: readonly KernelObjectRef[];
      };
    };
export type KernelJson =
  | null
  | boolean
  | number
  | string
  | readonly KernelJson[]
  | { readonly [key: string]: KernelJson };
export function kernelCanonicalJson(value: unknown): string {
  const seen = new Set<object>();
  function normalize(input: unknown, depth: number): KernelJson {
    if (depth > 64) throw new KernelFault("invalid_record");
    if (input === null || typeof input === "boolean") return input;
    if (typeof input === "string") return input.normalize("NFC");
    if (
      typeof input === "number" &&
      Number.isFinite(input) &&
      (!Number.isInteger(input) || Number.isSafeInteger(input))
    )
      return input;
    if (typeof input !== "object" || seen.has(input))
      throw new KernelFault("invalid_record");
    seen.add(input);
    let result: KernelJson;
    if (Array.isArray(input)) {
      if (input.length > 100_000) throw new KernelFault("invalid_record");
      result = input.map((x) => normalize(x, depth + 1));
    } else {
      if (
        Object.getPrototypeOf(input) !== Object.prototype &&
        Object.getPrototypeOf(input) !== null
      )
        throw new KernelFault("invalid_record");
      const out: Record<string, KernelJson> = Object.create(null) as Record<
        string,
        KernelJson
      >;
      for (const key of Object.keys(input).sort()) {
        if (
          ["__proto__", "prototype", "constructor"].includes(key) ||
          key !== key.normalize("NFC")
        )
          throw new KernelFault("invalid_record");
        out[key] = normalize(
          (input as Record<string, unknown>)[key],
          depth + 1,
        );
      }
      result = out;
    }
    seen.delete(input);
    return result;
  }
  const encoded = JSON.stringify(normalize(value, 0));
  if (Buffer.byteLength(encoded) > 8_388_608)
    throw new KernelFault("invalid_record");
  return encoded;
}
export function kernelHash(value: unknown): string {
  return createHash("sha256")
    .update(kernelCanonicalJson(value), "utf8")
    .digest("hex");
}
export function kernelBytesHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
export function freezeKernel<T>(value: T): T {
  kernelCanonicalJson(value);
  const cloned = JSON.parse(JSON.stringify(value)) as T;
  function freeze(x: unknown) {
    if (typeof x === "object" && x !== null) {
      Object.values(x).forEach(freeze);
      Object.freeze(x);
    }
  }
  freeze(cloned);
  return cloned;
}
export function kernelRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new KernelFault("invalid_record");
  return value as Record<string, unknown>;
}
export function kernelText(
  value: unknown,
  max = 4096,
  empty = false,
): asserts value is string {
  if (
    typeof value !== "string" ||
    (!empty && !value.trim()) ||
    Buffer.byteLength(value) > max ||
    value.includes("\u0000")
  )
    throw new KernelFault("invalid_record");
}
export function kernelInteger(
  value: unknown,
  minimum = 1,
): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum)
    throw new KernelFault("invalid_record");
}
export function kernelSha(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value))
    throw new KernelFault("invalid_record");
}
export function kernelId(
  value: unknown,
  prefix: ResearchIdPrefix,
): asserts value is string {
  if (!parseResearchIdFor(value, prefix).ok)
    throw new KernelFault("invalid_record");
}
export function kernelTime(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new KernelFault("invalid_record");
}
function schema(value: unknown, expected = "2.0.0") {
  if (value !== expected)
    throw new KernelFault(
      typeof value === "string" && value > expected
        ? "future_schema"
        : "invalid_record",
    );
}
function list(value: unknown, max = 1000): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new KernelFault("invalid_record");
}
function texts(value: unknown, max = 64) {
  list(value, max);
  value.forEach((x) => {
    kernelText(x);
  });
}

export const KERNEL_EFFECT_KINDS = [
  "record_only",
  "create_decision",
  "add_evidence",
  "create_or_resolve_issue",
  "patch_brief",
  "formal_direction_change",
] as const;
export type KernelEffectKind = (typeof KERNEL_EFFECT_KINDS)[number];
export const KERNEL_CANONICAL_CHANGES = [
  ...KERNEL_EFFECT_KINDS,
  "record_only_outcome",
  "memory_governance_change",
  "privacy_redaction",
  "episode_change",
  "compensation",
] as const;
export type KernelCanonicalChange = (typeof KERNEL_CANONICAL_CHANGES)[number];
export const KERNEL_REVIEW_STATES = [
  "draft",
  "manifest_prepared",
  "manifest_confirmed",
  "provider_attempt_prepared",
  "provider_attempt_running",
  "provider_attempt_uncertain",
  "provider_attempt_failed",
  "assessment_recorded",
  "stale",
  "disposed",
  "committed",
  "cancelled",
] as const;
export type KernelReviewStatus = (typeof KERNEL_REVIEW_STATES)[number];
export const KERNEL_TERMINAL_STATES: readonly KernelReviewStatus[] = [
  "disposed",
  "committed",
  "cancelled",
];
export interface KernelObjectRef {
  readonly kind: string;
  readonly id: string;
  readonly version: number;
}
export function parseKernelObjectRef(value: unknown): KernelObjectRef {
  const v = kernelRecord(value, ["kind", "id", "version"]);
  kernelText(v.kind, 80);
  kernelText(v.id, 160);
  kernelInteger(v.version, 0);
  return freezeKernel(v as unknown as KernelObjectRef);
}
export interface KernelEffectDraft {
  readonly effectId: string;
  readonly effectKind: KernelEffectKind;
  readonly previewHash: string;
  readonly baseProjectStateRevision: number;
  readonly objectVersions: readonly KernelObjectRef[];
}
export interface KernelReview {
  readonly schemaVersion: "2.0.0";
  readonly id: string;
  readonly projectId: string;
  readonly source: {
    readonly kind: "user" | "host" | "legacy_receipt" | "review";
    readonly id: string | null;
  };
  readonly suggestion: string;
  readonly suggestionHash: string;
  readonly requestedTarget: KernelObjectRef | null;
  readonly status: KernelReviewStatus;
  readonly baseProjectStateRevision: number;
  readonly manifestId: string | null;
  readonly attemptIds: readonly string[];
  readonly effectDraft: KernelEffectDraft | null;
  readonly terminalOutcome: {
    readonly receiptId: string | null;
    readonly kind: string;
    readonly resultingObjects: readonly KernelObjectRef[];
  } | null;
  readonly staleReason: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export function parseKernelReview(value: unknown): KernelReview {
  const v = kernelRecord(value, [
    "schemaVersion",
    "id",
    "projectId",
    "source",
    "suggestion",
    "suggestionHash",
    "requestedTarget",
    "status",
    "baseProjectStateRevision",
    "manifestId",
    "attemptIds",
    "effectDraft",
    "terminalOutcome",
    "staleReason",
    "version",
    "createdAt",
    "updatedAt",
  ]);
  schema(v.schemaVersion);
  kernelId(v.id, "rrvw_");
  kernelId(v.projectId, "rprj_");
  kernelText(v.suggestion, 65_536);
  kernelSha(v.suggestionHash);
  if (v.suggestionHash !== kernelBytesHash(v.suggestion.normalize("NFC")))
    throw new KernelFault("invalid_record");
  const source = kernelRecord(v.source, ["kind", "id"]);
  if (
    !["user", "host", "legacy_receipt", "review"].includes(String(source.kind))
  )
    throw new KernelFault("invalid_record");
  if (source.id !== null) kernelText(source.id, 160);
  if (!KERNEL_REVIEW_STATES.includes(v.status as KernelReviewStatus))
    throw new KernelFault("invalid_record");
  kernelInteger(v.baseProjectStateRevision);
  kernelInteger(v.version);
  kernelTime(v.createdAt);
  kernelTime(v.updatedAt);
  if (v.updatedAt < v.createdAt) throw new KernelFault("invalid_record");
  if (v.manifestId !== null) kernelId(v.manifestId, "rman_");
  if (v.requestedTarget !== null) parseKernelObjectRef(v.requestedTarget);
  list(v.attemptIds, 128);
  v.attemptIds.forEach((id) => {
    kernelId(id, "rpat_");
  });
  if (new Set(v.attemptIds).size !== v.attemptIds.length)
    throw new KernelFault("invalid_record");
  if (v.effectDraft !== null) {
    const d = kernelRecord(v.effectDraft, [
      "effectId",
      "effectKind",
      "previewHash",
      "baseProjectStateRevision",
      "objectVersions",
    ]);
    kernelText(d.effectId, 160);
    kernelSha(d.previewHash);
    kernelInteger(d.baseProjectStateRevision);
    list(d.objectVersions);
    d.objectVersions.forEach(parseKernelObjectRef);
    if (
      !KERNEL_EFFECT_KINDS.includes(d.effectKind as KernelEffectKind) ||
      d.baseProjectStateRevision !== v.baseProjectStateRevision
    )
      throw new KernelFault("invalid_record");
  }
  if (v.terminalOutcome !== null) {
    const t = kernelRecord(v.terminalOutcome, [
      "receiptId",
      "kind",
      "resultingObjects",
    ]);
    if (t.receiptId !== null) kernelId(t.receiptId, "rrcp_");
    kernelText(t.kind, 100);
    list(t.resultingObjects);
    t.resultingObjects.forEach(parseKernelObjectRef);
    if (!KERNEL_TERMINAL_STATES.includes(v.status as KernelReviewStatus))
      throw new KernelFault("invalid_record");
  } else if (["disposed", "committed"].includes(String(v.status)))
    throw new KernelFault("invalid_record");
  if (v.staleReason !== null) kernelText(v.staleReason, 1024);
  return freezeKernel(v as unknown as KernelReview);
}

export interface KernelAssessment {
  readonly availability:
    "not_requested" | "unavailable" | "failed" | "received";
  readonly requestBound: boolean;
  readonly schemaValidated: boolean;
  readonly quotesLocated: boolean;
  readonly claimFieldsParsed: boolean;
  readonly semanticCorrectness: "unproven";
  readonly publicSummary: string;
}
export function parseKernelAssessment(value: unknown): KernelAssessment {
  const v = kernelRecord(value, [
    "availability",
    "requestBound",
    "schemaValidated",
    "quotesLocated",
    "claimFieldsParsed",
    "semanticCorrectness",
    "publicSummary",
  ]);
  if (
    !["not_requested", "unavailable", "failed", "received"].includes(
      String(v.availability),
    ) ||
    v.semanticCorrectness !== "unproven"
  )
    throw new KernelFault("invalid_record");
  for (const key of [
    "requestBound",
    "schemaValidated",
    "quotesLocated",
    "claimFieldsParsed",
  ])
    if (
      typeof v[key] !== "boolean" ||
      (v.availability !== "received" && v[key])
    )
      throw new KernelFault("invalid_record");
  kernelText(v.publicSummary, 8192);
  return freezeKernel(v as unknown as KernelAssessment);
}
export interface KernelAttempt {
  readonly schemaVersion: "2.0.0";
  readonly id: string;
  readonly projectId: string;
  readonly reviewId: string;
  readonly ordinal: number;
  readonly manifestId: string;
  readonly manifestIdentityHash: string;
  readonly status:
    "prepared" | "running" | "completed" | "failed" | "cancelled" | "uncertain";
  readonly assessment: KernelAssessment | null;
  readonly assessmentHash: string | null;
  readonly failureCode: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export function parseKernelAttempt(value: unknown): KernelAttempt {
  const v = kernelRecord(value, [
    "schemaVersion",
    "id",
    "projectId",
    "reviewId",
    "ordinal",
    "manifestId",
    "manifestIdentityHash",
    "status",
    "assessment",
    "assessmentHash",
    "failureCode",
    "version",
    "createdAt",
    "updatedAt",
  ]);
  schema(v.schemaVersion);
  kernelId(v.id, "rpat_");
  kernelId(v.projectId, "rprj_");
  kernelId(v.reviewId, "rrvw_");
  kernelId(v.manifestId, "rman_");
  kernelSha(v.manifestIdentityHash);
  kernelInteger(v.ordinal);
  kernelInteger(v.version);
  kernelTime(v.createdAt);
  kernelTime(v.updatedAt);
  if (
    ![
      "prepared",
      "running",
      "completed",
      "failed",
      "cancelled",
      "uncertain",
    ].includes(String(v.status))
  )
    throw new KernelFault("invalid_record");
  if (v.assessment !== null) {
    parseKernelAssessment(v.assessment);
    if (
      kernelHash(v.assessment) !== v.assessmentHash ||
      v.status !== "completed"
    )
      throw new KernelFault("invalid_record");
  } else if (v.assessmentHash !== null || v.status === "completed")
    throw new KernelFault("invalid_record");
  if (
    v.failureCode !== null &&
    (typeof v.failureCode !== "string" ||
      !/^[a-z][a-z0-9_]{0,79}$/.test(v.failureCode))
  )
    throw new KernelFault("invalid_record");
  return freezeKernel(v as unknown as KernelAttempt);
}
export interface KernelManifest {
  readonly schemaVersion: "2.0.0";
  readonly id: string;
  readonly projectId: string;
  readonly reviewId: string;
  readonly baseProjectStateRevision: number;
  readonly contextProjectionPolicyVersion: string;
  readonly contextProjectionSchemaVersion: string;
  readonly contextProjectionHash: string;
  readonly provider: {
    readonly id: string;
    readonly model: string;
    readonly family: string;
    readonly locality: "local" | "external";
    readonly origin: string;
    readonly configGeneration: number;
    readonly serializerVersion: string;
  } | null;
  readonly exactRequestBody: string | null;
  readonly exactRequestHash: string | null;
  readonly exactRequestBytes: number;
  readonly selectedMemory: readonly (KernelObjectRef & {
    readonly contentHash: string;
  })[];
  readonly excludedFields: readonly string[];
  readonly limitations: readonly string[];
  readonly identityHash: string;
  readonly status: "prepared" | "confirmed" | "sent" | "stale" | "cancelled";
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export function manifestIdentity(
  value: Omit<KernelManifest, "identityHash"> | KernelManifest,
): string {
  return kernelHash(
    Object.fromEntries(
      Object.entries(value).filter(
        ([key]) =>
          ![
            "status",
            "version",
            "createdAt",
            "updatedAt",
            "identityHash",
          ].includes(key),
      ),
    ),
  );
}
export function parseKernelManifest(value: unknown): KernelManifest {
  const v = kernelRecord(value, [
    "schemaVersion",
    "id",
    "projectId",
    "reviewId",
    "baseProjectStateRevision",
    "contextProjectionPolicyVersion",
    "contextProjectionSchemaVersion",
    "contextProjectionHash",
    "provider",
    "exactRequestBody",
    "exactRequestHash",
    "exactRequestBytes",
    "selectedMemory",
    "excludedFields",
    "limitations",
    "identityHash",
    "status",
    "version",
    "createdAt",
    "updatedAt",
  ]);
  schema(v.schemaVersion);
  kernelId(v.id, "rman_");
  kernelId(v.projectId, "rprj_");
  kernelId(v.reviewId, "rrvw_");
  kernelInteger(v.baseProjectStateRevision);
  kernelSha(v.contextProjectionHash);
  kernelText(v.contextProjectionPolicyVersion, 32);
  kernelText(v.contextProjectionSchemaVersion, 32);
  kernelInteger(v.version);
  kernelTime(v.createdAt);
  kernelTime(v.updatedAt);
  if (v.provider === null) {
    if (
      v.exactRequestBody !== null ||
      v.exactRequestHash !== null ||
      v.exactRequestBytes !== 0
    )
      throw new KernelFault("invalid_record");
  } else {
    const p = kernelRecord(v.provider, [
      "id",
      "model",
      "family",
      "locality",
      "origin",
      "configGeneration",
      "serializerVersion",
    ]);
    kernelText(p.id, 128);
    kernelText(p.model, 256);
    kernelText(p.family, 128);
    if (!["local", "external"].includes(String(p.locality)))
      throw new KernelFault("invalid_record");
    kernelInteger(p.configGeneration);
    kernelText(p.serializerVersion, 32);
    kernelText(p.origin, 2048);
    let u: URL;
    try {
      u = new URL(p.origin);
    } catch {
      throw new KernelFault("invalid_record");
    }
    if (
      !["https:", "http:"].includes(u.protocol) ||
      u.origin !== p.origin ||
      u.username ||
      u.password
    )
      throw new KernelFault("invalid_record");
    kernelText(v.exactRequestBody, 2_097_152);
    kernelInteger(v.exactRequestBytes);
    if (
      kernelBytesHash(v.exactRequestBody) !== v.exactRequestHash ||
      Buffer.byteLength(v.exactRequestBody) !== v.exactRequestBytes
    )
      throw new KernelFault("invalid_record");
  }
  list(v.selectedMemory, 64);
  const ids = new Set();
  for (const item of v.selectedMemory) {
    const m = kernelRecord(item, ["kind", "id", "version", "contentHash"]);
    kernelId(m.id, "rmem_");
    kernelInteger(m.version);
    kernelSha(m.contentHash);
    if (m.kind !== "memory" || ids.has(m.id))
      throw new KernelFault("invalid_record");
    ids.add(m.id);
  }
  texts(v.excludedFields);
  texts(v.limitations);
  if (
    !["prepared", "confirmed", "sent", "stale", "cancelled"].includes(
      String(v.status),
    ) ||
    manifestIdentity(v as unknown as KernelManifest) !== v.identityHash
  )
    throw new KernelFault("invalid_record");
  return freezeKernel(v as unknown as KernelManifest);
}
export interface KernelCorrection {
  readonly schemaVersion: "2.0.0";
  readonly id: string;
  readonly projectId: string;
  readonly reviewId: string;
  readonly attemptId: string;
  readonly originalAssessmentHash: string;
  readonly publicReason: string;
  readonly version: 1;
  readonly createdAt: string;
}
export function parseKernelCorrection(value: unknown): KernelCorrection {
  const v = kernelRecord(value, [
    "schemaVersion",
    "id",
    "projectId",
    "reviewId",
    "attemptId",
    "originalAssessmentHash",
    "publicReason",
    "version",
    "createdAt",
  ]);
  schema(v.schemaVersion);
  kernelId(v.id, "rapc_");
  kernelId(v.projectId, "rprj_");
  kernelId(v.reviewId, "rrvw_");
  kernelId(v.attemptId, "rpat_");
  kernelSha(v.originalAssessmentHash);
  kernelText(v.publicReason, 8192);
  kernelTime(v.createdAt);
  if (v.version !== 1) throw new KernelFault("invalid_record");
  return freezeKernel(v as unknown as KernelCorrection);
}

export interface KernelHead {
  readonly projectId: string;
  readonly revision: number;
  readonly canonicalHash: string;
  readonly eventId: string;
  readonly updatedAt: string;
}
export interface KernelEvent {
  readonly schemaVersion: "2.0.0";
  readonly id: string;
  readonly projectId: string;
  readonly revision: number;
  readonly transactionId: string;
  readonly effectKind: KernelCanonicalChange | "migration_baseline";
  readonly reviewId: string | null;
  readonly changedObjectRefs: readonly KernelObjectRef[];
  readonly previousCanonicalHash: string;
  readonly nextCanonicalHash: string;
  readonly publicSummary: string;
  readonly createdAt: string;
  readonly compensatesReceiptId: string | null;
}
export interface KernelReceipt {
  readonly schemaVersion: "2.0.0";
  readonly id: string;
  readonly projectId: string;
  readonly reviewId: string | null;
  readonly authorityCommandId: string;
  readonly effectId: string;
  readonly effectKind: KernelCanonicalChange;
  readonly previewHash: string;
  readonly actorId: string;
  readonly publicReason: string;
  readonly beforeProjectStateRevision: number;
  readonly afterProjectStateRevision: number;
  readonly revisionEventId: string;
  readonly resultingObjects: readonly KernelObjectRef[];
  readonly assessmentAvailability: KernelAssessment["availability"];
  readonly receiptHash: string;
  readonly createdAt: string;
}
export function receiptHash(
  value: Omit<KernelReceipt, "receiptHash"> | KernelReceipt,
): string {
  return kernelHash(
    Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "receiptHash"),
    ),
  );
}
export function parseKernelReceipt(value: unknown): KernelReceipt {
  const v = kernelRecord(value, [
    "schemaVersion",
    "id",
    "projectId",
    "reviewId",
    "authorityCommandId",
    "effectId",
    "effectKind",
    "previewHash",
    "actorId",
    "publicReason",
    "beforeProjectStateRevision",
    "afterProjectStateRevision",
    "revisionEventId",
    "resultingObjects",
    "assessmentAvailability",
    "receiptHash",
    "createdAt",
  ]);
  schema(v.schemaVersion);
  kernelId(v.id, "rrcp_");
  kernelId(v.projectId, "rprj_");
  if (v.reviewId !== null) kernelId(v.reviewId, "rrvw_");
  kernelId(v.revisionEventId, "rpev_");
  kernelText(v.authorityCommandId, 160);
  kernelText(v.effectId, 160);
  kernelSha(v.previewHash);
  kernelText(v.actorId, 128);
  kernelText(v.publicReason);
  kernelInteger(v.beforeProjectStateRevision);
  kernelInteger(v.afterProjectStateRevision);
  kernelTime(v.createdAt);
  list(v.resultingObjects);
  v.resultingObjects.forEach(parseKernelObjectRef);
  if (
    v.afterProjectStateRevision !== v.beforeProjectStateRevision + 1 ||
    !KERNEL_CANONICAL_CHANGES.includes(v.effectKind as KernelCanonicalChange) ||
    !["not_requested", "unavailable", "failed", "received"].includes(
      String(v.assessmentAvailability),
    ) ||
    receiptHash(v as unknown as KernelReceipt) !== v.receiptHash
  )
    throw new KernelFault("invalid_record");
  return freezeKernel(v as unknown as KernelReceipt);
}
export function parseKernelEvent(value: unknown): KernelEvent {
  const v = kernelRecord(value, [
    "schemaVersion",
    "id",
    "projectId",
    "revision",
    "transactionId",
    "effectKind",
    "reviewId",
    "changedObjectRefs",
    "previousCanonicalHash",
    "nextCanonicalHash",
    "publicSummary",
    "createdAt",
    "compensatesReceiptId",
  ]);
  schema(v.schemaVersion);
  kernelId(v.id, "rpev_");
  kernelId(v.projectId, "rprj_");
  kernelInteger(v.revision);
  kernelText(v.transactionId, 160);
  kernelSha(v.previousCanonicalHash);
  kernelSha(v.nextCanonicalHash);
  kernelText(v.publicSummary);
  kernelTime(v.createdAt);
  // A baseline binds the complete preserved project; command previews remain
  // bounded separately. The canonical JSON byte cap still limits this event.
  list(
    v.changedObjectRefs,
    v.effectKind === "migration_baseline" ? 100_000 : 1000,
  );
  v.changedObjectRefs.forEach(parseKernelObjectRef);
  if (v.reviewId !== null) kernelId(v.reviewId, "rrvw_");
  if (v.compensatesReceiptId !== null)
    kernelId(v.compensatesReceiptId, "rrcp_");
  if (
    ![...KERNEL_CANONICAL_CHANGES, "migration_baseline"].includes(
      v.effectKind as KernelCanonicalChange,
    )
  )
    throw new KernelFault("invalid_record");
  if ((v.effectKind === "migration_baseline") !== (v.revision === 1))
    throw new KernelFault("invalid_record");
  return freezeKernel(v as unknown as KernelEvent);
}
