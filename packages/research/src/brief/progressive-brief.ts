import {
  EVIDENCE_KINDS,
  INFERENCE_CAPACITIES,
  type EvidenceKind,
  type InferenceCapacity,
} from "../argument/evidence.js";
import {
  KernelFault,
  freezeKernel,
  kernelInteger,
  kernelRecord,
  kernelText,
  type KernelObjectRef,
} from "../kernel/records.js";

import { BRIEF_SECTIONS } from "./brief-sections.js";
export { BRIEF_SECTIONS } from "./brief-sections.js";
export type BriefSection = (typeof BRIEF_SECTIONS)[number];
export type BriefSectionState =
  | { readonly status: "not_provided" }
  | { readonly status: "intentionally_empty"; readonly publicReason: string }
  | { readonly status: "provided" };
export interface KnownUnknown {
  readonly statement: string;
  readonly importance: "blocking" | "material" | "background";
  readonly relatedObjectRefs: readonly KernelObjectRef[];
  readonly resolutionCondition?: string;
}
export interface EvidenceThreshold {
  readonly appliesTo: "claim" | "decision" | "direction_change" | "completion";
  readonly minimumSourceClass: EvidenceKind;
  readonly requiredCorroboration?: number;
  readonly acceptedInferenceCapacity: readonly InferenceCapacity[];
  readonly publicReason: string;
}
export interface ProgressiveBrief {
  readonly schemaVersion: "2.0.0";
  readonly sections: Readonly<Record<BriefSection, BriefSectionState>>;
  readonly acceptedDecisions: readonly KernelObjectRef[];
  readonly objectReferences?: readonly KernelObjectRef[];
  readonly knownUnknowns: readonly KnownUnknown[];
  readonly evidenceThresholds: readonly EvidenceThreshold[];
}
function text(value: unknown, max: number): string {
  kernelText(value, max);
  return value;
}
function boundedList(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 100)
    throw new KernelFault("invalid_record");
  return value;
}
function reference(value: unknown): KernelObjectRef {
  const r = kernelRecord(value, ["kind", "id", "version"]);
  const prefixes: Record<string, string> = {
    decision: "rdec_",
    evidence: "revd_",
    issue: "riss_",
    artifact: "rart_",
  };
  if (
    typeof r.kind !== "string" ||
    !Object.hasOwn(prefixes, r.kind) ||
    !text(r.id, 160).startsWith(prefixes[r.kind] ?? "invalid_prefix")
  )
    throw new KernelFault("invalid_record");
  kernelInteger(r.version);
  if (r.version < 1) throw new KernelFault("invalid_record");
  return { kind: r.kind, id: String(r.id), version: r.version };
}
/** Section states describe the same values stored in the Brief, never a second editable copy. */
export function parseProgressiveBrief(
  input: unknown,
  fields: Readonly<Record<string, unknown>>,
): ProgressiveBrief {
  const p = kernelRecord(input, [
    "schemaVersion",
    "sections",
    "acceptedDecisions",
    "knownUnknowns",
    "evidenceThresholds",
    "objectReferences",
  ]);
  if (p.schemaVersion !== "2.0.0") throw new KernelFault("invalid_record");
  const raw = kernelRecord(p.sections, [...BRIEF_SECTIONS]);
  const sections = {} as Record<BriefSection, BriefSectionState>;
  for (const key of BRIEF_SECTIONS) {
    const s = kernelRecord(raw[key], ["status", "publicReason"]);
    if (
      !["not_provided", "intentionally_empty", "provided"].includes(
        String(s.status),
      )
    )
      throw new KernelFault("invalid_record");
    if (s.status === "intentionally_empty")
      sections[key] = {
        status: s.status,
        publicReason: text(s.publicReason, 4096),
      };
    else {
      if (s.publicReason !== undefined) throw new KernelFault("invalid_record");
      sections[key] = { status: s.status as "provided" | "not_provided" };
    }
    const value = key in p ? p[key] : fields[key];
    const filled =
      typeof value === "string"
        ? value.trim().length > 0
        : Array.isArray(value) && value.length > 0;
    if ((s.status === "provided") !== filled)
      throw new KernelFault("invalid_record");
  }
  const acceptedDecisions = boundedList(p.acceptedDecisions).map(reference);
  if (
    acceptedDecisions.some((r) => r.kind !== "decision") ||
    new Set(acceptedDecisions.map((r) => r.id)).size !==
      acceptedDecisions.length
  )
    throw new KernelFault("invalid_record");
  const knownUnknowns = boundedList(p.knownUnknowns).map((value) => {
    const u = kernelRecord(value, [
      "statement",
      "importance",
      "relatedObjectRefs",
      "resolutionCondition",
    ]);
    if (!["blocking", "material", "background"].includes(String(u.importance)))
      throw new KernelFault("invalid_record");
    return {
      statement: text(u.statement, 8192),
      importance: u.importance as KnownUnknown["importance"],
      relatedObjectRefs: boundedList(u.relatedObjectRefs).map(reference),
      ...(u.resolutionCondition === undefined
        ? {}
        : { resolutionCondition: text(u.resolutionCondition, 8192) }),
    };
  });
  const evidenceThresholds = boundedList(p.evidenceThresholds).map((value) => {
    const t = kernelRecord(value, [
      "appliesTo",
      "minimumSourceClass",
      "requiredCorroboration",
      "acceptedInferenceCapacity",
      "publicReason",
    ]);
    if (
      !["claim", "decision", "direction_change", "completion"].includes(
        String(t.appliesTo),
      ) ||
      !EVIDENCE_KINDS.includes(t.minimumSourceClass as EvidenceKind)
    )
      throw new KernelFault("invalid_record");
    const capacities = boundedList(t.acceptedInferenceCapacity);
    if (
      capacities.some(
        (c) => !INFERENCE_CAPACITIES.includes(c as InferenceCapacity),
      ) ||
      new Set(capacities).size !== capacities.length
    )
      throw new KernelFault("invalid_record");
    if (t.requiredCorroboration !== undefined) {
      kernelInteger(t.requiredCorroboration);
      if (
        t.requiredCorroboration < 1 ||
        t.requiredCorroboration > 1000
      )
        throw new KernelFault("invalid_record");
    }
    return {
      appliesTo: t.appliesTo as EvidenceThreshold["appliesTo"],
      minimumSourceClass: t.minimumSourceClass as EvidenceKind,
      acceptedInferenceCapacity: capacities as InferenceCapacity[],
      publicReason: text(t.publicReason, 4096),
      ...(t.requiredCorroboration === undefined
        ? {}
        : { requiredCorroboration: t.requiredCorroboration }),
    };
  });
  const objectReferences =
    p.objectReferences === undefined
      ? undefined
      : boundedList(p.objectReferences).map(reference);
  if (
    objectReferences &&
    new Set(objectReferences.map((r) => r.id)).size !== objectReferences.length
  )
    throw new KernelFault("invalid_record");
  return freezeKernel({
    schemaVersion: "2.0.0",
    sections,
    acceptedDecisions,
    knownUnknowns,
    evidenceThresholds,
    ...(objectReferences ? { objectReferences } : {}),
  });
}
