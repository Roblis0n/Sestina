import {
  KernelFault,
  freezeKernel,
  kernelRecord,
  kernelId,
  kernelInteger,
  kernelSha,
  kernelText,
  kernelCanonicalJson,
  type KernelJson,
} from "./records.js";
export const KERNEL_BRIEF_SECTIONS = [
  "projectQuestion",
  "currentStage",
  "currentTask",
  "targetArtifacts",
  "fixedDecisions",
  "allowedChanges",
  "forbiddenChanges",
  "expectedDeltas",
  "evidenceBoundaries",
  "explicitNonGoals",
  "knownUnknowns",
] as const;
export interface KernelBriefMetadata {
  readonly schemaVersion: "2.0.0";
  readonly legacySchemaVersion: "1.0.0";
  readonly legacyPayloadHash: string;
  readonly currentVersionId: string;
  readonly versions: readonly {
    readonly versionId: string;
    readonly sections: Readonly<
      Record<
        string,
        {
          readonly state: "provided" | "intentionally_empty" | "not_provided";
          readonly publicReason?: string;
        }
      >
    >;
    readonly decisionLinks: readonly {
      readonly legacyConstraintId: string;
      readonly decisionId: string | null;
      readonly mapping:
        "unambiguous_existing_decision" | "legacy_constraint_not_promoted";
    }[];
    readonly evidenceThreshold: {
      readonly kind: "legacy_text_rule";
      readonly rules: readonly KernelJson[];
      readonly interpretation: "not_inferred";
      readonly quality: "unproven";
    };
    readonly limitations: readonly string[];
  }[];
}
export function parseKernelBriefMetadata(input: unknown): KernelBriefMetadata {
  const m = kernelRecord(input, [
    "schemaVersion",
    "legacySchemaVersion",
    "legacyPayloadHash",
    "currentVersionId",
    "versions",
  ]);
  if (m.schemaVersion !== "2.0.0")
    throw new KernelFault(
      typeof m.schemaVersion === "string" && m.schemaVersion > "2.0.0"
        ? "future_schema"
        : "invalid_record",
    );
  if (m.legacySchemaVersion !== "1.0.0")
    throw new KernelFault("invalid_record");
  kernelSha(m.legacyPayloadHash);
  kernelId(m.currentVersionId, "rbrf_");
  if (
    !Array.isArray(m.versions) ||
    m.versions.length === 0 ||
    m.versions.length > 10000
  )
    throw new KernelFault("invalid_record");
  const seen = new Set<string>();
  for (const input of m.versions) {
    const v = kernelRecord(input, [
      "versionId",
      "sections",
      "decisionLinks",
      "evidenceThreshold",
      "limitations",
    ]);
    kernelId(v.versionId, "rbrf_");
    if (seen.has(v.versionId)) throw new KernelFault("invalid_record");
    seen.add(v.versionId);
    const sections = kernelRecord(v.sections, KERNEL_BRIEF_SECTIONS);
    if (Object.keys(sections).length !== KERNEL_BRIEF_SECTIONS.length)
      throw new KernelFault("invalid_record");
    for (const value of Object.values(sections)) {
      const s = kernelRecord(value, ["state", "publicReason"]);
      if (
        !["provided", "intentionally_empty", "not_provided"].includes(
          String(s.state),
        )
      )
        throw new KernelFault("invalid_record");
      if (s.state === "intentionally_empty" || s.publicReason !== undefined)
        kernelText(s.publicReason);
    }
    if (
      !Array.isArray(v.decisionLinks) ||
      v.decisionLinks.length > 10000 ||
      !Array.isArray(v.limitations) ||
      v.limitations.length > 64
    )
      throw new KernelFault("invalid_record");
    for (const input of v.decisionLinks) {
      const link = kernelRecord(input, [
        "legacyConstraintId",
        "decisionId",
        "mapping",
      ]);
      kernelId(link.legacyConstraintId, "rbrf_");
      if (link.decisionId !== null) kernelId(link.decisionId, "rdec_");
      if (
        link.mapping !==
        (link.decisionId === null
          ? "legacy_constraint_not_promoted"
          : "unambiguous_existing_decision")
      )
        throw new KernelFault("invalid_record");
    }
    for (const limitation of v.limitations) kernelText(limitation);
    const t = kernelRecord(v.evidenceThreshold, [
      "kind",
      "rules",
      "interpretation",
      "quality",
    ]);
    if (
      t.kind !== "legacy_text_rule" ||
      t.interpretation !== "not_inferred" ||
      t.quality !== "unproven" ||
      !Array.isArray(t.rules)
    )
      throw new KernelFault("invalid_record");
    kernelCanonicalJson(t.rules);
  }
  if (!seen.has(m.currentVersionId)) throw new KernelFault("invalid_record");
  return freezeKernel(m as unknown as KernelBriefMetadata);
}
export interface KernelBriefMetadataRecord {
  readonly projectId: string;
  readonly briefId: string;
  readonly version: number;
  readonly metadata: KernelBriefMetadata;
}
export function parseKernelBriefMetadataRecord(
  input: unknown,
): KernelBriefMetadataRecord {
  const r = kernelRecord(input, [
    "projectId",
    "briefId",
    "version",
    "metadata",
  ]);
  kernelId(r.projectId, "rprj_");
  kernelId(r.briefId, "rbrf_");
  kernelInteger(r.version);
  return freezeKernel({
    projectId: r.projectId,
    briefId: r.briefId,
    version: r.version,
    metadata: parseKernelBriefMetadata(r.metadata),
  });
}
