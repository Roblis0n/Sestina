import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { coreErr, coreOk, openSestina, type CoreResult, type SestinaCore } from "../src/index.js";

const USER = { kind: "user", actorId: "ui-02-owner" } as const;
const roots: string[] = [];
const cores: SestinaCore[] = [];
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function stressId(prefix: "rdec_" | "riss_", index: number): string {
  let value = BigInt(index + 1);
  let encoded = "";
  do {
    encoded = `${CROCKFORD[Number(value % 32n)]}${encoded}`;
    value /= 32n;
  } while (value > 0n);
  return `${prefix}${encoded.padStart(26, "0")}`;
}

function valueOf<T>(result: CoreResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

async function createWorkspace(title = "UI-02 workspace") {
  const root = await mkdtemp(join(tmpdir(), "sestina-ui02-core-"));
  roots.push(root);
  const databasePath = join(root, "state.sqlite");
  const core = valueOf(await openSestina({ databasePath }));
  cores.push(core);
  const project = valueOf(core.initializeProject({ title, actor: USER }));
  const created = valueOf(core.createArtifactWithInitialRevision({
    projectId: project.id,
    actor: USER,
    kind: "research_note",
    relativePath: "notes/ui-02.md",
    content: "# UI-02\n\nA bounded local research note.",
    mediaType: "text/markdown",
  }));
  const brief = valueOf(core.activateBrief({
    projectId: project.id,
    actor: USER,
    projectQuestion: "How can the current research objects remain inspectable and continuous?",
    currentStage: "revision",
    currentTask: "Expose durable object workspaces without changing research authority.",
    targetArtifacts: [created.artifact.id],
    fixedDecisions: [{ statement: "The user remains the only research authority.", scope: { target: { kind: "project_path", relativePath: "notes" }, operations: ["rewrite"] } }],
    allowedChanges: [{ target: { kind: "artifact", artifactId: created.artifact.id }, operations: ["add", "rewrite"] }],
    forbiddenChanges: [{ target: { kind: "project_path", relativePath: "archives" }, operations: ["delete"] }],
    expectedDeltas: [{ statement: "Add inspectable continuity across research objects.", scope: { target: { kind: "artifact", artifactId: created.artifact.id }, operations: ["add"] } }],
    evidenceBoundaries: [{ statement: "No file scan is evidence.", scope: { target: { kind: "project_path", relativePath: "notes" }, operations: ["rewrite"] }, forbiddenInferenceKinds: ["causal"] }],
    explicitNonGoals: ["Replace the Research Room", "Claim external validation"],
  }));
  return { core, root, databasePath, project, artifact: created.artifact, revision: created.revision, briefVersionId: brief.currentVersionId };
}

afterEach(async () => {
  while (cores.length > 0) cores.pop()?.close();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
});

describe("UI-02 research object workspace projections", () => {
  it("projects overview, brief history, decisions, issues, and attention from canonical state", async () => {
    const state = await createWorkspace();
    const decision = valueOf(state.core.recordDecision({
      projectId: state.project.id,
      actor: USER,
      statement: "Keep every authority-bearing mutation behind an explicit user confirmation.",
      scope: { kind: "project" },
      rationale: "Navigation must never become an authority bypass.",
      effectiveBriefVersionId: state.briefVersionId,
      reopenConditions: ["The authority contract changes."],
      status: "accepted",
    }));
    const issue = valueOf(state.core.openIssue({
      projectId: state.project.id,
      actor: USER,
      kind: "evidence_boundary",
      target: { kind: "artifact", artifactId: state.artifact.id },
      violatedCriterion: "evidence_boundary",
      rationaleConcepts: ["local_state", "provenance"],
      summary: "The current note still needs a canonical evidence link.",
      sourceArtifactId: state.artifact.id,
      sourceRevisionId: state.revision.id,
      sourceRevisionContentHash: state.revision.content.contentHash,
      lineageRootRevisionId: state.revision.id,
    }));
    valueOf(state.core.proposeBriefChange({
      projectId: state.project.id,
      actor: USER,
      changes: { currentTask: "Inspect the pending Brief change before activation." },
      reason: "UI-02 candidate-save contract",
    }));

    const overview = valueOf(state.core.getProjectOverviewProjection(state.project.id, { providerStatus: "ledger_only" }));
    expect(overview).toMatchObject({
      schemaVersion: "1.0.0",
      project: { id: state.project.id, title: "UI-02 workspace" },
      providerStatus: "ledger_only",
      counts: { decisions: 1, issues: 1, evidence: 0, episodes: 0, receipts: 0 },
      attention: { total: 2 },
    });

    const brief = valueOf(state.core.getBriefWorkspaceProjection(state.project.id));
    expect(brief.active.currentTask).toContain("Expose durable object workspaces");
    expect(brief.versions).toHaveLength(1);
    expect(brief.candidates[0]).toMatchObject({ status: "pending", diffFields: ["currentTask"], impact: { currentTaskChanged: true, highImpactDirectionChange: false, expectedEntityVersion: 2 } });
    expect(brief.candidates[0]?.diff.some((field) => field.field === "currentTask" && field.change === "changed")).toBe(true);

    const decisions = valueOf(state.core.listDecisionProjections(state.project.id, { limit: 50 }));
    expect(decisions.items[0]).toMatchObject({ id: decision.id, status: "accepted", version: 2 });
    const decisionDetail = valueOf(state.core.getDecisionProjection(state.project.id, decision.id));
    expect(decisionDetail?.timeline).toHaveLength(2);
    expect(decisionDetail?.availableActions).toEqual(["freeze", "supersede"]);

    const issues = valueOf(state.core.listIssueProjections(state.project.id, { limit: 50, status: "open" }));
    expect(issues.items[0]).toMatchObject({ id: issue.id, status: "open" });
    const attention = valueOf(state.core.getAttentionProjection(state.project.id));
    expect(attention.items.map((item) => item.kind)).toEqual(expect.arrayContaining(["brief_candidate", "issue"]));
  });

  it("keeps all ten overview slots available to one recent object kind", async () => {
    const state = await createWorkspace();
    for (let index = 0; index < 7; index += 1) {
      valueOf(state.core.recordDecision({
        projectId: state.project.id,
        actor: USER,
        statement: `Recent Decision ${index}`,
        scope: { kind: "project" },
        rationale: "One object kind can legitimately account for the latest project changes.",
        effectiveBriefVersionId: state.briefVersionId,
        reopenConditions: [],
      }));
    }
    const overview = valueOf(state.core.getProjectOverviewProjection(state.project.id, { providerStatus: "ledger_only" }));
    expect(overview.recentChanges.filter((item) => item.kind === "decision")).toHaveLength(7);
  });

  it("uses bounded, project-bound, dataset-bound cursors and rejects stale continuation", async () => {
    const firstState = await createWorkspace("First project");
    for (const statement of ["Decision alpha", "Decision beta", "Decision gamma"]) {
      valueOf(firstState.core.recordDecision({
        projectId: firstState.project.id,
        actor: USER,
        statement,
        scope: { kind: "project" },
        rationale: `Rationale for ${statement}.`,
        effectiveBriefVersionId: firstState.briefVersionId,
        reopenConditions: ["New evidence changes the decision."],
      }));
    }
    const firstPage = valueOf(firstState.core.listDecisionProjections(firstState.project.id, { limit: 1 }));
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    const secondPage = valueOf(firstState.core.listDecisionProjections(firstState.project.id, { limit: 1, cursor: firstPage.nextCursor }));
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);

    const secondState = await createWorkspace("Second project");
    const crossProject = secondState.core.listDecisionProjections(secondState.project.id, { limit: 1, cursor: firstPage.nextCursor });
    expect(crossProject).toMatchObject({ ok: false, error: { code: "stale_state" } });

    valueOf(firstState.core.recordDecision({
      projectId: firstState.project.id,
      actor: USER,
      statement: "Decision delta",
      scope: { kind: "project" },
      rationale: "Mutates the dataset after the cursor was issued.",
      effectiveBriefVersionId: firstState.briefVersionId,
      reopenConditions: ["Never"],
    }));
    const stale = firstState.core.listDecisionProjections(firstState.project.id, { limit: 1, cursor: firstPage.nextCursor });
    expect(stale).toMatchObject({ ok: false, error: { code: "stale_state" } });
  });

  it("searches only structured objects in the current project and returns navigable targets", async () => {
    const state = await createWorkspace();
    const decision = valueOf(state.core.recordDecision({
      projectId: state.project.id,
      actor: USER,
      statement: "Use structured workspace projections for continuity.",
      scope: { kind: "project" },
      rationale: "The search boundary is canonical state, not arbitrary project files.",
      effectiveBriefVersionId: state.briefVersionId,
      reopenConditions: ["A canonical index replaces the projection."],
    }));
    const second = valueOf(state.core.recordDecision({
      projectId: state.project.id,
      actor: USER,
      statement: "A second structured workspace result",
      scope: { kind: "brief", briefVersionId: state.briefVersionId },
      rationale: "Makes project-local search pagination observable.",
      effectiveBriefVersionId: state.briefVersionId,
      reopenConditions: ["The search contract changes."],
    }));
    const results = valueOf(state.core.searchResearchObjects(state.project.id, { query: "structured workspace", limit: 1 }));
    expect(results).toMatchObject({ schemaVersion: "1.0.0", projectId: state.project.id, truncated: true });
    expect(typeof results.nextCursor).toBe("string");
    expect(typeof results.datasetVersion).toBe("string");
    expect(results.items[0]).toMatchObject({ kind: "decision", projectId: state.project.id, status: "proposed", source: "user_recorded:user" });
    const continuation = valueOf(state.core.searchResearchObjects(state.project.id, { query: "structured workspace", limit: 1, cursor: results.nextCursor }));
    expect(continuation.items).toHaveLength(1);
    expect(continuation.items[0]?.id).not.toBe(results.items[0]?.id);
    expect(new Set([...results.items, ...continuation.items].map((item) => item.id))).toEqual(new Set([decision.id, second.id]));
    expect(state.core.searchResearchObjects(state.project.id, { query: "different query", limit: 1, cursor: results.nextCursor })).toMatchObject({ ok: false, error: { code: "stale_state" } });
    expect(valueOf(state.core.searchResearchObjects(state.project.id, { query: "", limit: 20 })).items).toEqual([]);
    await writeFile(join(state.root, "not-imported.md"), "disk-only-token-must-never-enter-search", "utf8");
    expect(valueOf(state.core.searchResearchObjects(state.project.id, { query: "disk-only-token", limit: 20 })).items).toEqual([]);
  });

  it("projects complete Decision and Issue continuity fields and applies the documented ledger filters", async () => {
    const state = await createWorkspace();
    const current = valueOf(state.core.recordDecision({
      projectId: state.project.id,
      actor: USER,
      statement: "Current Brief project decision",
      scope: { kind: "project" },
      rationale: "This decision is current and user-recorded.",
      effectiveBriefVersionId: state.briefVersionId,
      reopenConditions: ["The active Brief changes."],
      status: "accepted",
    }));
    const historical = valueOf(state.core.recordDecision({
      projectId: state.project.id,
      actor: USER,
      statement: "Historical artifact decision",
      scope: { kind: "artifact", artifactId: state.artifact.id },
      rationale: "This decision will be rejected.",
      effectiveBriefVersionId: state.briefVersionId,
      reopenConditions: [],
    }));
    valueOf(state.core.transitionDecision({ projectId: state.project.id, decisionId: historical.id, actor: USER, target: "rejected", reason: "Keep the historical record.", expectedVersion: historical.version }));
    const issue = valueOf(state.core.openIssue({
      projectId: state.project.id,
      actor: USER,
      kind: "evidence_boundary",
      target: { kind: "artifact", artifactId: state.artifact.id },
      violatedCriterion: "canonical_evidence_required",
      rationaleConcepts: ["provenance"],
      summary: "Current Brief target still needs canonical evidence.",
      sourceArtifactId: state.artifact.id,
      sourceRevisionId: state.revision.id,
      sourceRevisionContentHash: state.revision.content.contentHash,
      lineageRootRevisionId: state.revision.id,
    }));
    const episode = valueOf(state.core.startRevisionEpisode({ projectId: state.project.id, artifactId: state.artifact.id, baselineRevisionId: state.revision.id, briefVersionId: state.briefVersionId, actor: USER }));

    expect(valueOf(state.core.listDecisionProjections(state.project.id, { limit: 50, scope: "project", source: "user", active: true, referencedByCurrentBrief: true })).items.map((item) => item.id)).toEqual([current.id]);
    expect(valueOf(state.core.listDecisionProjections(state.project.id, { limit: 50, active: false })).items.map((item) => item.id)).toEqual([historical.id]);
    expect(valueOf(state.core.listIssueProjections(state.project.id, { limit: 50, issueKind: "evidence_boundary", source: "user", relevance: "current_brief", unresolved: true })).items.map((item) => item.id)).toEqual([issue.id]);

    const decision = valueOf(state.core.getDecisionProjection(state.project.id, current.id));
    expect(decision).toMatchObject({
      referencedByCurrentBrief: true,
      relatedBriefVersionIds: [state.briefVersionId],
      relatedEpisodeIds: [episode.id],
      relationsTruncated: false,
      availableActions: ["freeze", "supersede"],
    });
    expect(typeof decision?.createdAt).toBe("string");
    expect(decision?.lineage[0]).toMatchObject({ id: current.id, status: "accepted", relation: "current" });
    const issueDetail = valueOf(state.core.getIssueProjection(state.project.id, issue.id));
    expect(issueDetail).toMatchObject({
      recurrenceCount: 1,
      requiresUserAction: true,
      relatedEpisodeIds: [episode.id],
      relatedEvidenceIds: [],
      relationsTruncated: false,
      availableActions: ["resolve", "waive", "dispute"],
    });
    expect(issueDetail?.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(typeof issueDetail?.firstSeenAt).toBe("string");
    expect(typeof issueDetail?.lastSeenAt).toBe("string");
  });

  it("derives stale Manifest and waiting-disposition Review Attention without making a new domain truth", async () => {
    const state = await createWorkspace();
    const stale = valueOf(state.core.prepareResearchRoomReview({ projectId: state.project.id, suggestion: "A prepared suggestion whose binding will become stale.", evidenceClass: "owner_scenario", countsAsExternalEvidence: false }));
    valueOf(state.core.recordDecision({
      projectId: state.project.id,
      actor: USER,
      statement: "Change the bound active Decision set",
      scope: { kind: "project" },
      rationale: "Makes the prepared Manifest stale.",
      effectiveBriefVersionId: state.briefVersionId,
      reopenConditions: [],
      status: "accepted",
    }));
    const staleAttention = valueOf(state.core.getAttentionProjection(state.project.id));
    expect(staleAttention.items).toContainEqual(expect.objectContaining({ id: stale.reviewId, kind: "manifest", valid: true, primaryAction: "Rebuild Context Manifest" }));

    const waiting = valueOf(state.core.prepareResearchRoomReview({ projectId: state.project.id, suggestion: "A fresh suggestion awaiting an owner disposition.", evidenceClass: "owner_scenario", countsAsExternalEvidence: false }));
    valueOf(await state.core.analyzeResearchRoomSuggestion({ reviewId: waiting.reviewId, confirmationNonce: waiting.confirmationNonce, manifestHash: waiting.manifestHash }));
    const waitingAttention = valueOf(state.core.getAttentionProjection(state.project.id));
    expect(waitingAttention.items).toContainEqual(expect.objectContaining({ id: waiting.reviewId, kind: "review", valid: true, sourceObject: { kind: "review", id: waiting.reviewId } }));
  });

  it("keeps Review Room and bounded pages usable with 5,000 Decisions and 1,000 Issues", async () => {
    const state = await createWorkspace();
    const decision = valueOf(state.core.recordDecision({ projectId: state.project.id, actor: USER, statement: "Historical Decision template", scope: { kind: "project" }, rationale: "A historical record must not block the active Review Room.", effectiveBriefVersionId: state.briefVersionId, reopenConditions: [] }));
    valueOf(state.core.transitionDecision({ projectId: state.project.id, decisionId: decision.id, actor: USER, target: "rejected", reason: "Retain as history.", expectedVersion: decision.version }));
    const issue = valueOf(state.core.openIssue({ projectId: state.project.id, actor: USER, kind: "evidence_boundary", target: { kind: "artifact", artifactId: state.artifact.id }, violatedCriterion: "bounded-history-stress", rationaleConcepts: ["bounded_projection"], summary: "Historical Issue template", sourceArtifactId: state.artifact.id, sourceRevisionId: state.revision.id, sourceRevisionContentHash: state.revision.content.contentHash, lineageRootRevisionId: state.revision.id }));
    valueOf(state.core.waiveIssue({ projectId: state.project.id, issueId: issue.id, actor: USER, scope: { kind: "issue", issueId: issue.id }, reason: "Retain as historical Issue.", invalidationCondition: "The bounded projection contract changes.", expectedVersion: issue.version }));

    const raw = new DatabaseSync(state.databasePath, { open: true });
    try {
      const decisionRow = raw.prepare("SELECT * FROM research_decisions WHERE decision_id = ?").get(decision.id) as Record<string, unknown>;
      const decisionTransitions = raw.prepare("SELECT * FROM research_decision_transitions WHERE decision_id = ? ORDER BY transition_index").all(decision.id) as Record<string, unknown>[];
      const issueRow = raw.prepare("SELECT * FROM research_issues WHERE issue_id = ?").get(issue.id) as Record<string, unknown>;
      const issueTransitions = raw.prepare("SELECT * FROM research_issue_transitions WHERE issue_id = ? ORDER BY transition_index").all(issue.id) as Record<string, unknown>[];
      const insertDecision = raw.prepare("INSERT INTO research_decisions (decision_id, project_id, scope_kind, scope_key, status, version, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
      const insertDecisionTransition = raw.prepare("INSERT INTO research_decision_transitions (project_id, decision_id, transition_index, from_status, to_status, occurred_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)");
      const insertIssue = raw.prepare("INSERT INTO research_issues (issue_id, project_id, fingerprint, source_artifact_id, source_revision_id, lineage_root_revision_id, status, version, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      const insertIssueTransition = raw.prepare("INSERT INTO research_issue_transitions (project_id, issue_id, transition_index, from_status, to_status, occurred_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)");
      raw.exec("BEGIN IMMEDIATE");
      for (let index = 0; index < 4_999; index += 1) {
        const id = stressId("rdec_", index);
        const data = { ...(JSON.parse(String(decisionRow.data)) as Record<string, unknown>), id, statement: `Historical Decision ${String(index).padStart(4, "0")}` };
        insertDecision.run(id, decisionRow.project_id, decisionRow.scope_kind, decisionRow.scope_key, decisionRow.status, decisionRow.version, decisionRow.created_at, decisionRow.updated_at, JSON.stringify(data));
        for (const transition of decisionTransitions) insertDecisionTransition.run(transition.project_id, id, transition.transition_index, transition.from_status, transition.to_status, transition.occurred_at, transition.data);
      }
      for (let index = 0; index < 999; index += 1) {
        const id = stressId("riss_", index);
        const data = { ...(JSON.parse(String(issueRow.data)) as Record<string, unknown>), id, summary: `Historical Issue ${String(index).padStart(4, "0")}` };
        insertIssue.run(id, issueRow.project_id, issueRow.fingerprint, issueRow.source_artifact_id, issueRow.source_revision_id, issueRow.lineage_root_revision_id, issueRow.status, issueRow.version, issueRow.created_at, issueRow.updated_at, JSON.stringify(data));
        for (const transition of issueTransitions) insertIssueTransition.run(transition.project_id, id, transition.transition_index, transition.from_status, transition.to_status, transition.occurred_at, transition.data);
      }
      raw.exec("COMMIT");
    } catch (error) {
      try { raw.exec("ROLLBACK"); } catch { /* transaction may not have started */ }
      throw error;
    } finally {
      raw.close();
    }

    expect(valueOf(state.core.getResearchRoomState(state.project.id)).decisions).toEqual([]);
    const decisionPage = valueOf(state.core.listDecisionProjections(state.project.id, { limit: 50, active: false }));
    const issuePage = valueOf(state.core.listIssueProjections(state.project.id, { limit: 50, unresolved: false }));
    expect(decisionPage.items).toHaveLength(50);
    expect(decisionPage.nextCursor).toEqual(expect.any(String));
    expect(issuePage.items).toHaveLength(50);
    expect(issuePage.nextCursor).toEqual(expect.any(String));
  });

  it("keeps Brief candidate activation and its file projection in one recoverable authority transaction", async () => {
    const state = await createWorkspace();
    const before = valueOf(state.core.getBriefWorkspaceProjection(state.project.id));
    const proposal = valueOf(state.core.proposeBriefChange({
      projectId: state.project.id,
      actor: USER,
      changes: { currentTask: "Activate this only after the projection is publishable." },
      reason: "Exercise the UI-02 projection transaction.",
      expectedVersion: before.entityVersion,
    }));
    expect(valueOf(state.core.getBriefWorkspaceProjection(state.project.id)).active.currentTask).toBe(before.active.currentTask);

    const failed = state.core.acceptBriefChangeWithProjection({
      projectId: state.project.id,
      proposalId: proposal.proposal.id,
      actor: USER,
      reason: "Confirm after reviewing the field diff.",
      expectedVersion: proposal.brief.version,
    }, () => coreErr("projection_write_failure"));
    expect(failed).toMatchObject({ ok: false, error: { code: "projection_write_failure" } });
    const afterFailure = valueOf(state.core.getBriefWorkspaceProjection(state.project.id));
    expect(afterFailure.active.id).toBe(before.active.id);
    expect(afterFailure.candidates[0]).toMatchObject({ id: proposal.proposal.id, status: "pending" });

    let published = "";
    let finalized = 0;
    const accepted = valueOf(state.core.acceptBriefChangeWithProjection({
      projectId: state.project.id,
      proposalId: proposal.proposal.id,
      actor: USER,
      reason: "Confirm after reviewing the field diff.",
      expectedVersion: proposal.brief.version,
    }, (yaml) => {
      published = yaml;
      return coreOk({ rollback: () => undefined, finalize: () => { finalized += 1; } });
    }));
    expect(accepted.version.currentTask).toContain("projection is publishable");
    expect(published).toContain("Activate this only after the projection is publishable.");
    expect(finalized).toBe(1);
  });

  it("fails the corrupted object projection closed while unrelated Brief state remains readable", async () => {
    const state = await createWorkspace();
    const decision = valueOf(state.core.recordDecision({
      projectId: state.project.id,
      actor: USER,
      statement: "This row will be corrupted after a valid canonical write.",
      scope: { kind: "project" },
      rationale: "Exercise per-object fail-closed recovery.",
      effectiveBriefVersionId: state.briefVersionId,
      reopenConditions: [],
    }));
    const raw = new DatabaseSync(state.databasePath, { open: true });
    try {
      raw.prepare("UPDATE research_decisions SET data = ? WHERE project_id = ? AND decision_id = ?")
        .run("{}", state.project.id, decision.id);
    } finally {
      raw.close();
    }

    expect(state.core.listDecisionProjections(state.project.id, { limit: 50 })).toMatchObject({ ok: false, error: { code: "infrastructure_failure" } });
    expect(valueOf(state.core.getBriefWorkspaceProjection(state.project.id)).active.id).toBe(state.briefVersionId);
  });

  it("preserves Decision lineage and refuses Issue resolution without canonical project Evidence", async () => {
    const state = await createWorkspace();
    const original = valueOf(state.core.recordDecision({
      projectId: state.project.id,
      actor: USER,
      statement: "Original bounded decision",
      scope: { kind: "project" },
      rationale: "The initial research constraint.",
      effectiveBriefVersionId: state.briefVersionId,
      reopenConditions: ["The constraint changes."],
      status: "accepted",
    }));
    const replacement = valueOf(state.core.supersedeDecision({
      projectId: state.project.id,
      decisionId: original.id,
      actor: USER,
      statement: "Replacement bounded decision",
      scope: { kind: "project" },
      rationale: "New user-confirmed constraint.",
      effectiveBriefVersionId: state.briefVersionId,
      reopenConditions: ["New contradictory evidence."],
      reason: "Replace without deleting the original lineage.",
      expectedVersion: original.version,
    }));
    expect(valueOf(state.core.getDecisionProjection(state.project.id, original.id))).toMatchObject({ status: "superseded", supersededByDecisionId: replacement.replacement.id });
    expect(valueOf(state.core.getDecisionProjection(state.project.id, replacement.replacement.id))).toMatchObject({ status: "accepted", supersedesDecisionId: original.id });

    const issue = valueOf(state.core.openIssue({
      projectId: state.project.id,
      actor: USER,
      kind: "evidence_boundary",
      target: { kind: "artifact", artifactId: state.artifact.id },
      violatedCriterion: "canonical_evidence_required",
      rationaleConcepts: ["provenance"],
      summary: "Resolution needs a canonical Evidence record.",
      sourceArtifactId: state.artifact.id,
      sourceRevisionId: state.revision.id,
      sourceRevisionContentHash: state.revision.content.contentHash,
      lineageRootRevisionId: state.revision.id,
    }));
    const missingEvidence = state.core.resolveIssueWithCanonicalEvidence({
      projectId: state.project.id,
      issueId: issue.id,
      actor: USER,
      reason: "This must not resolve against a made-up identifier.",
      resolutionEvidenceId: "revd_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      expectedVersion: issue.version,
    });
    expect(missingEvidence).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(valueOf(state.core.getIssueProjection(state.project.id, issue.id))?.status).toBe("open");
  });
});
