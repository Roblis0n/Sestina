import {
  BRIEF_SECTIONS,
  KernelFault,
  kernelHash,
  kernelInteger,
  kernelRecord,
  kernelText,
  parseKernelCoverageScope,
  type KernelCoverageScope,
  parseResearchBrief,
  type BriefSection,
  type BriefSectionState,
  type KernelEffectKind,
  type KernelManifest,
  type ResearchBriefVersion,
} from "@sestina/research";
import { projectKernelContext, type KernelProjectionSelection, type KernelSnapshot } from "@sestina/research-store";
import { unwrapKernelDomain } from "./kernel-effects.js";

function textValue(value: unknown): string {
  if (typeof value !== "string") throw new KernelFault("corrupt_state");
  return value;
}

export function kernelObjectLabels(snapshot: KernelSnapshot): Record<string, string> {
  const labels = Object.fromEntries(snapshot.state.objects.filter(o => ["artifact", "decision", "evidence", "issue"].includes(o.kind)).map(o => {
    const candidate = o.data.statement ?? o.data.summary ?? o.data.title ?? o.data.relativePath;
    return [o.id, typeof candidate === "string" ? candidate : o.kind];
  }));
  for(const object of snapshot.state.objects.filter(o=>o.kind==="brief")) {
    const brief=unwrapKernelDomain(parseResearchBrief(object.data));
    for(const version of brief.versions) labels[version.id]=`${version.projectQuestion || version.currentTask} · ${version.versionNumber}`;
    labels[brief.id]=labels[brief.currentVersionId] ?? "";
  }
  return labels;
}

export function projectBrief(snapshot: KernelSnapshot) {
  const rows = snapshot.state.objects.filter((o) => o.kind === "brief");
  if (rows.length > 1) throw new KernelFault("relation_mismatch");
  const brief = rows[0]
    ? unwrapKernelDomain(parseResearchBrief(rows[0].data))
    : null;
  const active = brief?.versions.at(-1) ?? null;
  const sections: Partial<Record<BriefSection, BriefSectionState>> = {};
  if (active?.progressive) Object.assign(sections, active.progressive.sections);
  else if (brief) {
    const group = snapshot.state.metadata.find(
      (m) => (m as { table?: string }).table === "research_brief_metadata",
    ) as { rows?: { brief_id: string; data: string }[] } | undefined;
    const row = group?.rows?.find((r) => r.brief_id === brief.id);
    const metadata = row
      ? (JSON.parse(row.data) as {
          versions: {
            versionId: string;
            sections: Record<string, { state: string; publicReason?: string }>;
          }[];
        })
      : undefined;
    const stored = metadata?.versions.find(
      (v) => v.versionId === active?.id,
    )?.sections;
    for (const key of BRIEF_SECTIONS) {
      const s = stored?.[key];
      sections[key] = s
        ? ({
            status: s.state,
            ...(s.publicReason ? { publicReason: s.publicReason } : {}),
          } as BriefSectionState)
        : { status: "not_provided" };
    }
  }
  return {
    projectId: snapshot.head.projectId,
    projectStateRevision: snapshot.head.revision,
    brief,
    active,
    sections,
    objectLabels: kernelObjectLabels(snapshot),
    objectVersions: snapshot.state.objects.filter(o => ["artifact", "decision", "issue", "evidence"].includes(o.kind)).map(o => ({kind:o.kind,id:o.id,version:o.version})),
  };
}

/** Coverage informs assessment, never the user's permission to commit an effect. */
export function briefCoverage(
  snapshot: KernelSnapshot,
  effect: KernelEffectKind | null,
  suggestion: string,
  targetKinds: readonly string[] = [],
): NonNullable<KernelManifest["contextSelection"]["briefCoverage"]> {
  kernelText(suggestion, 65536);
  const required: Record<KernelEffectKind, readonly BriefSection[]> = {
    record_only: [],
    create_decision: [
      "projectQuestion",
      "currentTask",
      "acceptedDecisions",
      "allowedChanges",
      "forbiddenChanges",
    ],
    add_evidence: ["evidenceThresholds", "evidenceBoundaries", "knownUnknowns"],
    create_or_resolve_issue: [
      "currentTask",
      "knownUnknowns",
      "evidenceThresholds",
    ],
    patch_brief: ["allowedChanges", "forbiddenChanges"],
    formal_direction_change: [
      "projectQuestion",
      "acceptedDecisions",
      "allowedChanges",
      "forbiddenChanges",
      "explicitNonGoals",
      "knownUnknowns",
    ],
  };
  if (effect !== null && !Object.hasOwn(required, effect)) throw new KernelFault("invalid_record");
  if (
    targetKinds.some(
      (k) =>
        !["artifact", "decision", "evidence", "issue", "brief"].includes(k),
    )
  )
    throw new KernelFault("invalid_record");
  const needed = new Set([
    ...(effect === null ? ["projectQuestion", "currentTask"] as const : required[effect]),
    ...(targetKinds.includes("artifact") ? ["targetArtifacts" as const] : []),
  ]);
  const { sections } = projectBrief(snapshot);
  return BRIEF_SECTIONS.map((section) => ({
    section,
    status: !needed.has(section)
      ? "not_applicable"
      : !sections[section] || sections[section].status === "not_provided"
        ? "limited"
        : "sufficient",
    reason: !needed.has(section)
      ? "not_required_for_this_effect"
      : !sections[section] || sections[section].status === "not_provided"
        ? "not_provided"
        : sections[section].status === "intentionally_empty"
          ? "user_explicitly_empty"
          : "provided_for_this_effect",
    requiredForEffectKinds: needed.has(section) && effect !== null ? [effect] : [],
    canSkip: true,
    authorityBlocked: false,
  }));
}

export type KernelReviewContextSelection = KernelProjectionSelection & { readonly coverageScope?: KernelCoverageScope };

/** One snapshot supplies both the inspected Coverage and the serialized request. */
export function projectReviewContext(snapshot: KernelSnapshot, suggestion: string, selection: KernelReviewContextSelection, independentSecondOpinion = false) {
  kernelRecord(selection, ["evidenceIds", "issueIds", "memory", "coverageScope"]);
  const coverageScope = parseKernelCoverageScope(selection.coverageScope ?? { effectKind: null, targetKinds: [] });
  const objects = { evidenceIds: selection.evidenceIds, issueIds: selection.issueIds, memory: selection.memory };
  const base = projectKernelContext(snapshot, suggestion, objects);
  const coverage = briefCoverage(snapshot, coverageScope.effectKind, suggestion, coverageScope.targetKinds);
  const limitations = [
    ...base.limitations.filter(text => !/^Brief .+: not_provided\.$/.test(text) && text !== "Brief not provided."),
    ...coverage.filter(row => row.status === "limited").map(row => `Brief ${row.section}: not_provided.`),
  ];
  const projection = {
    ...base.projection,
    policyVersion: "1.1.0",
    coverageScope,
    assessmentPurpose: independentSecondOpinion ? "independent_second_opinion" : "review_suggestion",
    briefCoverage: coverage,
    categories: base.projection.categories.filter(category => !independentSecondOpinion || category.kind !== "outcome_summaries").map(category => category.kind === "limitations" ? { kind: category.kind, items: limitations } : category),
  };
  return { ...base, projection, contextProjectionHash: kernelHash(projection), limitations, excludedFields: [...base.excludedFields, ...(independentSecondOpinion ? ["original_assessment_verdict", "original_assessment_rationale", "original_assessment_confidence", "outcome_summaries"] : [])] };
}

export function briefFieldDiff(
  base: ResearchBriefVersion,
  current: ResearchBriefVersion,
  candidate: Record<string, unknown>,
) {
  const paths = [...BRIEF_SECTIONS.filter(key => !["knownUnknowns", "acceptedDecisions", "evidenceThresholds"].includes(key)), ...["knownUnknowns", "acceptedDecisions", "evidenceThresholds", "objectReferences"].map(key => `progressive.${key}`), ...BRIEF_SECTIONS.map(key => `progressive.sections.${key}`)];
  const get = (value: unknown, path: string): unknown => {
    let result = value;
    for(const part of path.split(".")) {
      if (result === null || typeof result !== "object" || Array.isArray(result)) return undefined;
      result = (result as Record<string,unknown>)[part];
    }
    return result;
  };
  return paths
    .filter(path => get(candidate,path) !== undefined || kernelHash(get(base,path) ?? null) !== kernelHash(get(current,path) ?? null))
    .map((field) => {
      const b = get(base,field) ?? null,
        c = get(current,field) ?? null,
        proposed = get(candidate,field) ?? b;
      return {
        field,
        base: b,
        current: c,
        candidate: proposed,
        changed: kernelHash(b) !== kernelHash(proposed),
        conflict:
          kernelHash(b) !== kernelHash(c) &&
          kernelHash(c) !== kernelHash(proposed),
      };
    });
}

export function briefRelationships(snapshot: KernelSnapshot, input: unknown) {
  const q = kernelRecord(input, ["kind", "search", "limit", "cursor", "purpose"]);
  if (q.purpose !== undefined && q.purpose !== "reference" && q.purpose !== "transition") throw new KernelFault("invalid_record");
  if (!["decision", "evidence", "issue", "artifact"].includes(String(q.kind)))
    throw new KernelFault("invalid_record");
  if (typeof q.search !== "string" || q.search.length > 512)
    throw new KernelFault("invalid_record");
  const search = q.search.normalize("NFC").toLocaleLowerCase();
  kernelInteger(q.limit);
  if (q.limit < 1 || q.limit > 50)
    throw new KernelFault("invalid_record");
  const binding = kernelHash({
    kind: q.kind,
    purpose: q.purpose ?? "reference",
    search: q.search,
    revision: snapshot.head.revision,
    projectId: snapshot.head.projectId,
  });
  let start = 0;
  if (q.cursor !== undefined) {
    kernelText(q.cursor, 256);
    const parts = q.cursor.split(":");
    if (parts.length !== 2 || parts[0] !== binding || !parts[1] || !/^\d+$/.test(parts[1]))
      throw new KernelFault("stale_revision");
    start = Number(parts[1]);
    if (!Number.isSafeInteger(start)) throw new KernelFault("invalid_record");
  }
  const matches = snapshot.state.objects
    .filter((o) => o.kind === q.kind)
    .map((o) => ({
      kind: o.kind,
      id: o.id,
      version: o.version,
      name: textValue(
        o.data.statement ??
          o.data.summary ??
          o.data.title ??
          o.data.relativePath ??
          "",
      ),
      status: textValue(o.data.status ?? o.data.state ?? "current"),
      source: o.data.provenance ?? o.data.source ?? null,
      selectable:
        o.kind === "decision"
          ? q.purpose === "transition" ? o.data.status !== "superseded" : o.data.status === "accepted" || o.data.status === "frozen"
          : o.kind === "evidence"
            ? o.data.state === "current"
            : o.kind === "artifact" ? o.data.tombstone === undefined : true,
    }))
    .filter((o) =>
      o.name
        .normalize("NFC")
        .toLocaleLowerCase()
        .includes(search),
    );
  return {
    items: matches.slice(start, start + q.limit),
    nextCursor:
      start + q.limit < matches.length
        ? `${binding}:${start + q.limit}`
        : null,
    projectStateRevision: snapshot.head.revision,
  };
}
