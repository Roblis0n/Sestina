import {
  KernelFault,
  FixedClock,
  freezeKernel,
  kernelHash,
  kernelRecord,
  kernelText,
  kernelInteger,
  createResearchDecision,
  transitionResearchDecision,
  supersedeResearchDecision,
  parseResearchDecision,
  createResearchIssue,
  resolveResearchIssue,
  parseResearchIssue,
  parseResearchBrief,
  createBriefChangeProposal,
  createResearchBrief,
  confirmBriefChangeProposal,
  parseArgumentEvidence,
  parseClaimEvidenceLink,
  parseMechanismEvidenceLink,
  type KernelEffectKind,
  type KernelJson,
  type KernelObjectRef,
  type ResearchActor,
  type ResearchRepositories,
  type ResearchResult,
  type ResearchDecision,
  type ResearchIssue,
  type ResearchBrief,
  type ArgumentEvidence,
  type ClaimEvidenceLink,
  type MechanismEvidenceLink,
  type DecisionScope,
  type DecisionStatus,
  type ResearchIssueInput,
  type BriefChangeSet,
  type ResearchBriefVersionFields,
} from "@sestina/research";
import { type KernelSnapshot } from "@sestina/research-store";
export type CanonicalEffectPayload =
  | {
      kind: "record_only";
      outcome:
        "rejected" | "deferred" | "reference_only" | "assessment_disputed";
      reason: string;
    }
  | {
      kind: "create_decision";
      mode: "create";
      statement: string;
      rationale: string;
      scope: DecisionScope;
      reopenConditions: readonly string[];
      replaces?: {
        targetId: string;
        expectedVersion: number;
      };
      reason: string;
    }
  | {
      kind: "create_decision";
      mode: "transition";
      targetId: string;
      expectedVersion: number;
      status: DecisionStatus;
      reason: string;
    }
  | {
      kind: "add_evidence";
      evidence: Omit<
        ArgumentEvidence,
        "id" | "projectId" | "source" | "version"
      >;
      links: readonly (
        | {
            kind: "claim";
            claimId: string;
            role: ClaimEvidenceLink["role"];
            status: "unproven" | "disputed" | "stale";
          }
        | {
            kind: "mechanism";
            mechanismLinkId: string;
            stepIndex: number;
            status: "unproven" | "disputed" | "stale";
          }
      )[];
      reason: string;
    }
  | {
      kind: "create_or_resolve_issue";
      mode: "create";
      issue: Omit<ResearchIssueInput, "projectId" | "source">;
      reason: string;
    }
  | {
      kind: "create_or_resolve_issue";
      mode: "resolve";
      targetId: string;
      expectedVersion: number;
      resolutionEvidenceId: string;
      reason: string;
    }
  | {
      kind: "patch_brief";
      mode: "initialize";
      fields: ResearchBriefVersionFields;
      reason: string;
    }
  | {
      kind: "patch_brief";
      mode?: "patch";
      targetId: string;
      expectedVersion: number;
      baseVersionId: string;
      changes: BriefChangeSet;
      reason: string;
    }
  | {
      kind: "formal_direction_change";
      targetId: string;
      expectedVersion: number;
      baseVersionId: string;
      newQuestion: string;
      impactSummary: string;
      reason: string;
    };
export function unwrapKernelDomain<T>(result: ResearchResult<T>): T {
  if (!result.ok) throw new KernelFault("invalid_record");
  return result.value;
}
export function requireKernelValue<T>(value: T | undefined | null): T {
  if (value === undefined || value === null)
    throw new KernelFault("corrupt_state");
  return value;
}
export function parseCanonicalEffect(input: unknown): CanonicalEffectPayload {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new KernelFault("invalid_record");
  const kind = (input as Record<string, unknown>).kind;
  const common = ["kind", "reason"];
  const fields: Record<KernelEffectKind, readonly string[]> = {
    record_only: ["outcome"],
    create_decision: [
      "mode",
      "statement",
      "rationale",
      "scope",
      "reopenConditions",
      "targetId",
      "expectedVersion",
      "status",
      "replaces",
    ],
    add_evidence: ["evidence", "links"],
    create_or_resolve_issue: [
      "mode",
      "issue",
      "targetId",
      "expectedVersion",
      "resolutionEvidenceId",
    ],
    patch_brief: (input as Record<string, unknown>).mode === "initialize" ? ["mode", "fields"] : ["mode", "targetId", "expectedVersion", "baseVersionId", "changes"],
    formal_direction_change: [
      "targetId",
      "expectedVersion",
      "baseVersionId",
      "newQuestion",
      "impactSummary",
    ],
  };
  if (typeof kind !== "string" || !Object.hasOwn(fields, kind))
    throw new KernelFault("invalid_record");
  const v = kernelRecord(input, [
    ...common,
    ...fields[kind as KernelEffectKind],
  ]);
  kernelText(v.reason);
  if (
    kind === "record_only" &&
    !["rejected", "deferred", "reference_only", "assessment_disputed"].includes(
      String(v.outcome),
    )
  )
    throw new KernelFault("invalid_record");
  if (kind === "create_decision") {
    if (v.mode === "create") {
      kernelRecord(v, [
        ...common,
        "mode",
        "statement",
        "rationale",
        "scope",
        "reopenConditions",
        "replaces",
      ]);
      if (v.replaces !== undefined) {
        const replacement = kernelRecord(v.replaces, [
          "targetId",
          "expectedVersion",
        ]);
        kernelText(replacement.targetId, 160);
        kernelInteger(replacement.expectedVersion);
      }
      kernelText(v.statement, 8192);
      kernelText(v.rationale, 8192);
      const scope = kernelRecord(v.scope, [
        "kind",
        "artifactId",
        "briefVersionId",
        "issueId",
      ]);
      const scopeFields: Record<string, string[]> = {
        project: [],
        artifact: ["artifactId"],
        brief: ["briefVersionId"],
        issue: ["issueId"],
      };
      if (
        typeof scope.kind !== "string" ||
        !Object.hasOwn(scopeFields, scope.kind)
      )
        throw new KernelFault("invalid_record");
      kernelRecord(scope, [
        "kind",
        ...requireKernelValue(scopeFields[scope.kind]),
      ]);
      for (const field of requireKernelValue(scopeFields[scope.kind]))
        kernelText(scope[field], 160);
      if (!Array.isArray(v.reopenConditions) || v.reopenConditions.length > 64)
        throw new KernelFault("invalid_record");
      v.reopenConditions.forEach((x) => {
        kernelText(x);
      });
    } else if (v.mode === "transition")
      kernelRecord(v, [
        ...common,
        "mode",
        "targetId",
        "expectedVersion",
        "status",
      ]);
    else throw new KernelFault("invalid_record");
  }
  if (kind === "create_or_resolve_issue") {
    if (v.mode === "create") {
      kernelRecord(v, [...common, "mode", "issue"]);
      const issue = kernelRecord(v.issue, [
        "kind",
        "target",
        "violatedCriterion",
        "rationaleConcepts",
        "summary",
        "sourceArtifactId",
        "sourceRevisionId",
        "sourceRevisionContentHash",
        "lineageRootRevisionId",
      ]);
      const target = kernelRecord(issue.target, [
        "kind",
        "artifactId",
        "heading",
        "blockId",
        "relativePath",
      ]);
      const fields: Record<string, string[]> = {
        artifact: ["artifactId"],
        heading: ["artifactId", "heading"],
        block: ["artifactId", "blockId"],
        project_path: ["relativePath"],
      };
      if (
        typeof target.kind !== "string" ||
        !Object.hasOwn(fields, target.kind)
      )
        throw new KernelFault("invalid_record");
      kernelRecord(target, ["kind", ...(fields[target.kind] ?? [])]);
    } else if (v.mode === "resolve")
      kernelRecord(v, [
        ...common,
        "mode",
        "targetId",
        "expectedVersion",
        "resolutionEvidenceId",
      ]);
    else throw new KernelFault("invalid_record");
  }
  if (
    (kind === "patch_brief" && v.mode !== "initialize") ||
    kind === "formal_direction_change" ||
    v.mode === "transition" ||
    v.mode === "resolve"
  ) {
    kernelText(v.targetId, 160);
    kernelInteger(v.expectedVersion);
  }
  if (kind === "patch_brief" && v.mode === "initialize") {
    const fields = kernelRecord(v.fields, ["projectQuestion", "currentStage", "currentTask", "targetArtifacts", "fixedDecisions", "allowedChanges", "forbiddenChanges", "expectedDeltas", "evidenceBoundaries", "explicitNonGoals", "progressive"]);
    if (!fields.progressive) throw new KernelFault("invalid_record");
  }
  if (kind === "patch_brief" && v.mode !== "initialize") {
    if (v.mode !== undefined && v.mode !== "patch") throw new KernelFault("invalid_record");
    const changes = kernelRecord(v.changes, [
      "currentStage",
      "currentTask",
      "targetArtifacts",
      "fixedDecisions",
      "allowedChanges",
      "forbiddenChanges",
      "expectedDeltas",
      "evidenceBoundaries",
      "explicitNonGoals",
      "progressive",
    ]);
    if (Object.keys(changes).length === 0)
      throw new KernelFault("invalid_record");
    const scope = (input: unknown) => {
      const rule = kernelRecord(input, ["target", "operations"]),
        target = kernelRecord(rule.target, [
          "kind",
          "artifactId",
          "heading",
          "blockId",
          "relativePath",
        ]);
      const fields: Record<string, string[]> = {
        artifact: ["artifactId"],
        heading: ["artifactId", "heading"],
        block: ["artifactId", "blockId"],
        project_path: ["relativePath"],
      };
      if (
        typeof target.kind !== "string" ||
        !Object.hasOwn(fields, target.kind)
      )
        throw new KernelFault("invalid_record");
      kernelRecord(target, [
        "kind",
        ...requireKernelValue(fields[target.kind]),
      ]);
    };
    for (const field of [
      "fixedDecisions",
      "expectedDeltas",
      "evidenceBoundaries",
      "allowedChanges",
      "forbiddenChanges",
    ] as const) {
      const items = changes[field];
      if (items === undefined) continue;
      if (!Array.isArray(items) || items.length > 32)
        throw new KernelFault("invalid_record");
      for (const item of items) {
        if (field === "allowedChanges" || field === "forbiddenChanges")
          scope(item);
        else {
          const row = kernelRecord(item, [
            "id",
            "statement",
            "scope",
            ...(field === "evidenceBoundaries"
              ? ["forbiddenInferenceKinds", "allowedSourceIds"]
              : []),
          ]);
          scope(row.scope);
        }
      }
    }
    kernelText(v.baseVersionId, 160);
  }
  if (kind === "formal_direction_change") {
    kernelText(v.newQuestion, 8192);
    kernelText(v.impactSummary);
    kernelText(v.baseVersionId, 160);
  }
  if (kind === "add_evidence") {
    const evidence = kernelRecord(v.evidence, [
      "kind",
      "summary",
      "state",
      "inferenceCapacity",
      "artifactId",
      "revisionId",
      "contentVersionHash",
      "provenance",
    ]);
    kernelText(evidence.summary, 8192);
    if (
      [
        evidence.artifactId,
        evidence.revisionId,
        evidence.contentVersionHash,
      ].some((x) => x !== undefined)
    ) {
      kernelText(evidence.artifactId, 160);
      kernelText(evidence.revisionId, 160);
      kernelText(evidence.contentVersionHash, 64);
    }
    const provenance = kernelRecord(evidence.provenance, [
      "citation",
      "locator",
    ]);
    kernelText(provenance.citation, 8192);
    if (provenance.locator !== undefined) kernelText(provenance.locator);
    if (!Array.isArray(v.links) || v.links.length > 64)
      throw new KernelFault("invalid_record");
    for (const link of v.links) {
      const l = kernelRecord(link, [
        "kind",
        "claimId",
        "role",
        "mechanismLinkId",
        "stepIndex",
        "status",
      ]);
      if (
        !["unproven", "disputed", "stale"].includes(String(l.status)) ||
        !["claim", "mechanism"].includes(String(l.kind))
      )
        throw new KernelFault("invalid_record");
      kernelRecord(
        l,
        l.kind === "claim"
          ? ["kind", "claimId", "role", "status"]
          : ["kind", "mechanismLinkId", "stepIndex", "status"],
      );
    }
  }
  return freezeKernel(v as unknown as CanonicalEffectPayload);
}
type Mutation =
  | {
      kind: "decision";
      before: ResearchDecision | null;
      after: ResearchDecision;
    }
  | {
      kind: "issue";
      before: ResearchIssue | null;
      after: ResearchIssue;
    }
  | {
      kind: "brief";
      before: ResearchBrief | null;
      after: ResearchBrief;
    }
  | {
      kind: "evidence";
      before: null;
      after: ArgumentEvidence;
    }
  | {
      kind: "claim_evidence_link";
      before: null;
      after: ClaimEvidenceLink;
    }
  | {
      kind: "mechanism_evidence_link";
      before: null;
      after: MechanismEvidenceLink;
    };
export function buildCanonicalEffect(input: {
  payload: CanonicalEffectPayload;
  snapshot: KernelSnapshot;
  actor: ResearchActor;
  at: string;
  allocatedIds: readonly string[];
}) {
  const { payload: p, snapshot, actor, at, allocatedIds } = input;
  const projectId = snapshot.head.projectId,
    clock = new FixedClock(at);
  const source = { actor, authority: "user_recorded" as const, recordedAt: at };
  const mutations: Mutation[] = [];
  const get = (kind: string, id?: string) => {
    const candidates = snapshot.state.objects.filter(
      (o) => o.kind === kind && (id === undefined || id === o.id),
    );
    if (candidates.length !== 1) throw new KernelFault("relation_mismatch");
    return requireKernelValue(candidates[0]);
  };
  const idFor = (prefix: string, index = 0) => {
    const id = allocatedIds.filter((x) => x.startsWith(prefix))[index];
    if (!id) throw new KernelFault("invalid_record");
    return id;
  };
  const versions: KernelObjectRef[] = [];
  const bind = (kind: string, id: string, expected?: number) => {
    const object = get(kind, id);
    if (expected !== undefined && object.version !== expected)
      throw new KernelFault("stale_object", [
        { kind, id, version: object.version },
      ]);
    if (!versions.some((r) => r.kind === kind && r.id === id))
      versions.push({ kind, id, version: object.version });
    return object;
  };
  if (p.kind === "create_decision") {
    if (p.mode === "create") {
      const brief = unwrapKernelDomain(parseResearchBrief(get("brief").data));
      bind("brief", brief.id);
      if (p.scope.kind === "artifact") bind("artifact", p.scope.artifactId);
      if (p.scope.kind === "issue") bind("issue", p.scope.issueId);
      if (p.scope.kind === "brief") {
        const versionId = p.scope.briefVersionId;
        if (!brief.versions.some((v) => v.id === versionId))
          throw new KernelFault("relation_mismatch");
      }
      const created = unwrapKernelDomain(
        createResearchDecision(
          {
            projectId,
            statement: p.statement,
            rationale: p.rationale,
            scope: p.scope,
            reopenConditions: p.reopenConditions,
            effectiveBriefVersionId: brief.currentVersionId,
            source,
          },
          { clock, idFactory: { create: () => idFor("rdec_") } },
        ),
      );
      let accepted: ResearchDecision;
      if (p.replaces) {
        const before = unwrapKernelDomain(
          parseResearchDecision(
            bind("decision", p.replaces.targetId, p.replaces.expectedVersion)
              .data,
          ),
        );
        const result = unwrapKernelDomain(
          supersedeResearchDecision(
            before,
            created,
            actor,
            before.version,
            created.version,
            p.reason,
            clock,
          ),
        );
        mutations.push({ kind: "decision", before, after: result.superseded });
        accepted = result.replacement;
      } else
        accepted = unwrapKernelDomain(
          transitionResearchDecision(
            created,
            "accepted",
            actor,
            created.version,
            p.reason,
            clock,
          ),
        );
      // Entity versions count persisted mutations; this creation has one atomic save.
      mutations.push({
        kind: "decision",
        before: null,
        after: unwrapKernelDomain(
          parseResearchDecision({ ...accepted, version: 1 }),
        ),
      });
    } else {
      const before = unwrapKernelDomain(
        parseResearchDecision(
          bind("decision", p.targetId, p.expectedVersion).data,
        ),
      );
      mutations.push({
        kind: "decision",
        before,
        after: unwrapKernelDomain(
          transitionResearchDecision(
            before,
            p.status,
            actor,
            before.version,
            p.reason,
            clock,
          ),
        ),
      });
    }
  } else if (p.kind === "add_evidence") {
    const after = unwrapKernelDomain(
      parseArgumentEvidence({
        ...p.evidence,
        id: idFor("revd_"),
        projectId,
        version: 1,
        source,
      }),
    );
    if (after.artifactId) {
      bind("artifact", after.artifactId);
      const revision = bind(
        "revision",
        requireKernelValue(after.revisionId),
      ).data;
      if (
        revision.artifactId !== after.artifactId ||
        (
          revision.content as {
            contentHash: string;
          }
        ).contentHash !== after.contentVersionHash
      )
        throw new KernelFault("relation_mismatch");
    }
    if (
      snapshot.state.objects.some(
        (o) =>
          o.kind === "evidence" &&
          kernelHash({
            kind: o.data.kind,
            summary: o.data.summary,
            provenance: o.data.provenance ?? null,
          }) ===
            kernelHash({
              kind: after.kind,
              summary: after.summary,
              provenance: after.provenance ?? null,
            }),
      )
    )
      throw new KernelFault("idempotency_conflict");
    mutations.push({ kind: "evidence", before: null, after });
    for (const link of p.links) {
      if (link.kind === "claim") {
        bind("claim", link.claimId);
        mutations.push({
          kind: "claim_evidence_link",
          before: null,
          after: unwrapKernelDomain(
            parseClaimEvidenceLink({
              ...link,
              projectId,
              evidenceId: after.id,
              source,
              version: 1,
            }),
          ),
        });
      } else {
        const mechanism = bind("mechanism", link.mechanismLinkId).data;
        if (
          !Array.isArray(mechanism.intermediateSteps) ||
          link.stepIndex >= mechanism.intermediateSteps.length
        )
          throw new KernelFault("invalid_record");
        mutations.push({
          kind: "mechanism_evidence_link",
          before: null,
          after: unwrapKernelDomain(
            parseMechanismEvidenceLink({
              ...link,
              projectId,
              evidenceId: after.id,
              source,
              version: 1,
            }),
          ),
        });
      }
    }
  } else if (p.kind === "create_or_resolve_issue") {
    if (p.mode === "create") {
      kernelRecord(p.issue, [
        "kind",
        "target",
        "violatedCriterion",
        "rationaleConcepts",
        "summary",
        "sourceArtifactId",
        "sourceRevisionId",
        "sourceRevisionContentHash",
        "lineageRootRevisionId",
      ]);
      const revision = bind("revision", p.issue.sourceRevisionId).data;
      bind("artifact", p.issue.sourceArtifactId);
      if (p.issue.target.kind !== "project_path")
        bind("artifact", p.issue.target.artifactId);
      if (
        bind("revision", p.issue.lineageRootRevisionId).data.artifactId !==
        p.issue.sourceArtifactId
      )
        throw new KernelFault("relation_mismatch");
      if (
        revision.artifactId !== p.issue.sourceArtifactId ||
        (
          revision.content as {
            contentHash: string;
          }
        ).contentHash !== p.issue.sourceRevisionContentHash
      )
        throw new KernelFault("relation_mismatch");
      const after = unwrapKernelDomain(
        createResearchIssue(
          { ...p.issue, projectId, source },
          { clock, idFactory: { create: () => idFor("riss_") } },
        ),
      );
      if (
        snapshot.state.objects.some(
          (o) =>
            o.kind === "issue" &&
            o.data.fingerprint === after.fingerprint &&
            !(
              typeof o.data.status === "string" &&
              ["resolved", "suppressed", "waived"].includes(o.data.status)
            ),
        )
      )
        throw new KernelFault("idempotency_conflict");
      mutations.push({ kind: "issue", before: null, after });
    } else {
      const before = unwrapKernelDomain(
        parseResearchIssue(bind("issue", p.targetId, p.expectedVersion).data),
      );
      if (before.status === "resolved")
        throw new KernelFault("already_resolved");
      const evidence = bind("evidence", p.resolutionEvidenceId);
      if (evidence.data.state !== "current")
        throw new KernelFault("invalid_record");
      mutations.push({
        kind: "issue",
        before,
        after: unwrapKernelDomain(
          resolveResearchIssue(
            before,
            actor,
            before.version,
            p.reason,
            { resolutionEvidenceId: p.resolutionEvidenceId },
            clock,
          ),
        ),
      });
    }
  } else if (p.kind === "patch_brief" && p.mode === "initialize") {
    if (snapshot.state.objects.some(o => o.kind === "brief")) throw new KernelFault("illegal_transition");
    let cursor = 0;
    const fields = { ...p.fields };
    for (const key of ["fixedDecisions", "expectedDeltas", "evidenceBoundaries"] as const) {
      Object.assign(fields, { [key]: fields[key].map(item => { if (item.id) throw new KernelFault("invalid_record"); return { ...item, id: idFor("rbrf_", cursor++) }; }) });
    }
    const after = unwrapKernelDomain(createResearchBrief({ ...fields, projectId, source }, { clock, idFactory: { create: () => idFor("rbrf_", cursor++) } }));
    const active = requireKernelValue(after.versions[0]);
    for (const id of active.targetArtifacts) bind("artifact", id);
    for (const rule of [...active.allowedChanges, ...active.forbiddenChanges, ...[...active.fixedDecisions, ...active.expectedDeltas, ...active.evidenceBoundaries].map(item => item.scope)]) {
      if (rule.target.kind !== "project_path") bind("artifact", rule.target.artifactId);
    }
    for (const boundary of active.evidenceBoundaries) for (const id of boundary.allowedSourceIds ?? []) bind("evidence", id);
    for (const ref of [...(active.progressive?.objectReferences ?? []), ...(active.progressive?.acceptedDecisions ?? []), ...(active.progressive?.knownUnknowns ?? []).flatMap(item => item.relatedObjectRefs)]) {
      const object = bind(ref.kind, ref.id, ref.version);
      if (ref.kind === "decision" && active.progressive?.acceptedDecisions.some(item => item.id === ref.id) && !["accepted", "frozen"].includes(typeof object.data.status === "string" ? object.data.status : "")) throw new KernelFault("relation_mismatch");
      if (ref.kind === "evidence" && object.data.state !== "current") throw new KernelFault("relation_mismatch");
    }
    mutations.push({ kind: "brief", before: null, after });
  } else if (p.kind === "patch_brief" || p.kind === "formal_direction_change") {
    const before = unwrapKernelDomain(
      parseResearchBrief(bind("brief", p.targetId, p.expectedVersion).data),
    );
    if (before.currentVersionId !== p.baseVersionId)
      throw new KernelFault("stale_object");
    const active = requireKernelValue(before.versions.at(-1));
    const changes: BriefChangeSet =
      p.kind === "patch_brief"
        ? { ...p.changes }
        : { projectQuestion: p.newQuestion, ...(active.progressive ? { progressive: { ...active.progressive, sections: { ...active.progressive.sections, projectQuestion: { status: "provided" as const } } } } : {}) };
    if (p.kind === "patch_brief") {
      let nextId = 2;
      for (const field of [
        "fixedDecisions",
        "expectedDeltas",
        "evidenceBoundaries",
      ] as const) {
        const items = changes[field];
        if (!items) continue;
        const mapped = items.map((item) => {
          if (item.id && !active[field].some((old) => old.id === item.id))
            throw new KernelFault("relation_mismatch");
          return { ...item, id: item.id || idFor("rbrf_", nextId++) };
        });
        Object.assign(changes, { [field]: mapped });
      }
      for (const id of changes.targetArtifacts ?? []) bind("artifact", id);
      const scopes = [
        ...(changes.allowedChanges ?? []),
        ...(changes.forbiddenChanges ?? []),
        ...[
          ...(changes.fixedDecisions ?? []),
          ...(changes.expectedDeltas ?? []),
          ...(changes.evidenceBoundaries ?? []),
        ].map((x) => x.scope),
      ];
      for (const rule of scopes)
        if (rule.target.kind !== "project_path")
          bind("artifact", rule.target.artifactId);
      for (const boundary of changes.evidenceBoundaries ?? [])
        for (const id of boundary.allowedSourceIds ?? []) bind("evidence", id);
      for (const ref of [ ...(changes.progressive?.objectReferences ?? []), ...(changes.progressive?.acceptedDecisions ?? []), ...(changes.progressive?.knownUnknowns ?? []).flatMap(u => u.relatedObjectRefs) ]) {
        const object = bind(ref.kind, ref.id, ref.version);
        if (ref.kind === "decision" && changes.progressive?.acceptedDecisions.some(r => r.id === ref.id) && !["accepted", "frozen"].includes(typeof object.data.status === "string" ? object.data.status : "")) throw new KernelFault("relation_mismatch");
        if (ref.kind === "evidence" && object.data.state !== "current") throw new KernelFault("relation_mismatch");
      }
    }
    if (
      Object.entries(changes).every(
        ([k, v]) =>
          kernelHash(v) === kernelHash(active[k as keyof typeof active] ?? null),
      )
    )
      throw new KernelFault("invalid_record");
    if (
      p.kind === "formal_direction_change" &&
      p.newQuestion.normalize("NFC").trim() ===
        active.projectQuestion.normalize("NFC").trim()
    )
      throw new KernelFault("invalid_record");
    const proposal = unwrapKernelDomain(
      createBriefChangeProposal(
        before,
        { changes, reason: p.reason, source },
        { clock, idFactory: { create: () => idFor("rbrf_") } },
      ),
    );
    const confirmed = unwrapKernelDomain(
      confirmBriefChangeProposal(
        proposal.brief,
        proposal.proposal.id,
        actor,
        proposal.brief.version,
        { clock, idFactory: { create: () => idFor("rbrf_", 1) } },
      ),
    );
    mutations.push({
      kind: "brief",
      before,
      after: unwrapKernelDomain(
        parseResearchBrief({ ...confirmed, version: before.version + 1 }),
      ),
    });
  }
  function mutationRef(m: Mutation): KernelObjectRef {
    const id =
      m.kind === "claim_evidence_link"
        ? `${m.after.claimId}:${m.after.evidenceId}`
        : m.kind === "mechanism_evidence_link"
          ? `${m.after.mechanismLinkId}:${m.after.evidenceId}`
          : m.after.id;
    return { kind: m.kind, id, version: m.after.version };
  }
  for (const m of mutations) {
    const ref = mutationRef(m);
    if (!versions.some((v) => v.kind === ref.kind && v.id === ref.id))
      versions.push({ ...ref, version: 0 });
  }
  if (
    new Set(mutations.map((m) => `${mutationRef(m).kind}:${mutationRef(m).id}`))
      .size !== mutations.length
  )
    throw new KernelFault("invalid_record");
  const objects = mutations.map((m) => ({
    ...mutationRef(m),
    before: m.before,
    after: m.after,
  }));
  return {
    mutations,
    objectVersions: versions,
    objects,
    unchangedObjects: snapshot.state.objects
      .filter((o) => !objects.some((m) => m.kind === o.kind && m.id === o.id))
      .map((o) => ({ kind: o.kind, id: o.id, version: o.version })),
    apply(repos: ResearchRepositories) {
      for (const m of mutations) {
        if (m.kind === "decision")
          unwrapKernelDomain(
            m.before
              ? repos.decisions.appendTransition(m.after, m.before.version)
              : repos.decisions.create(m.after),
          );
        else if (m.kind === "issue")
          unwrapKernelDomain(
            m.before
              ? repos.issues.appendTransition(m.after, m.before.version)
              : repos.issues.create(m.after),
          );
        else if (m.kind === "brief")
          unwrapKernelDomain(
            m.before ? repos.briefs.compareAndSwap(m.after, m.before.version) : repos.briefs.create(m.after),
          );
        else if (m.kind === "evidence")
          unwrapKernelDomain(repos.argumentEvidence.create(m.after));
        else if (m.kind === "claim_evidence_link")
          unwrapKernelDomain(repos.claimEvidenceLinks.create(m.after));
        else unwrapKernelDomain(repos.mechanismEvidenceLinks.create(m.after));
      }
    },
  };
}
export function effectJson(value: unknown): KernelJson {
  return JSON.parse(JSON.stringify(value)) as KernelJson;
}

