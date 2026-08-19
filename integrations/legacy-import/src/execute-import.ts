import {
  canonicalStringify,
  parseResearchSource,
  validateResearchActor,
  type ResearchArtifact,
  type ResearchBrief,
  type ResearchDecision,
  type ResearchProject,
  type ResearchRepositories,
  type ResearchResult,
} from "@sestina/research";
import { createResearchStore } from "@sestina/research-store";
import type { StorageDatabase } from "@sestina/storage";
import { createVerificationReport } from "./import-report.js";
import { deterministicResearchId } from "./identity.js";
import { verifyLegacyImportPlan } from "./import-plan.js";
import { mapLegacyContract } from "./map-contract.js";
import { mapLegacyCorrection } from "./map-correction.js";
import { mapLegacyProject } from "./map-project.js";
import { loadLegacySnapshot } from "./scan-legacy.js";
import type {
  LegacyImportError,
  LegacyImportExecutionResult,
  LegacyImportPlan,
  LegacyImportSelection,
  LegacyScanItem,
} from "./types.js";

type PlannedWrite =
  | { readonly kind: "project"; readonly value: ResearchProject }
  | { readonly kind: "artifact"; readonly value: ResearchArtifact }
  | { readonly kind: "brief"; readonly value: ResearchBrief }
  | { readonly kind: "decision"; readonly value: ResearchDecision };

function failure(code: LegacyImportError["code"], message: string): LegacyImportExecutionResult {
  return { ok: false, error: { code, message } };
}

function sameValue(left: unknown, right: unknown): boolean {
  const a = canonicalStringify(left); const b = canonicalStringify(right);
  return a.ok && b.ok && a.value === b.value;
}

function sourceFor(item: LegacyScanItem, recordedAt: string) {
  return parseResearchSource({
    actor: { kind: "import", sourceSystem: `legacy:${item.planItemId.slice(0, 16)}` },
    authority: "imported_unconfirmed",
    recordedAt,
  });
}

function getExisting(repositories: ResearchRepositories, write: PlannedWrite): ResearchResult<unknown | undefined> {
  switch (write.kind) {
    case "project": return repositories.projects.getById(write.value.id);
    case "artifact": return repositories.artifacts.getById(write.value.projectId, write.value.id);
    case "brief": return repositories.briefs.getById(write.value.projectId, write.value.id);
    case "decision": return repositories.decisions.getById(write.value.projectId, write.value.id);
  }
}

function createWrite(repositories: ResearchRepositories, write: PlannedWrite): ResearchResult<unknown> {
  switch (write.kind) {
    case "project": return repositories.projects.create(write.value);
    case "artifact": return repositories.artifacts.create(write.value);
    case "brief": return repositories.briefs.create(write.value);
    case "decision": return repositories.decisions.create(write.value);
  }
}

export async function executeLegacyImport(input: {
  readonly sourcePath: string;
  readonly targetDatabase: StorageDatabase;
  readonly plan: LegacyImportPlan;
  readonly selection: LegacyImportSelection;
}): Promise<LegacyImportExecutionResult> {
  if (!verifyLegacyImportPlan(input.plan)) return failure("legacy_plan_invalid", "Legacy import plan is invalid");
  const actor = validateResearchActor(input.selection.selectedBy);
  if (!actor.ok || actor.value.kind !== "user") return failure("legacy_selection_invalid", "Legacy import selection requires a user");
  const selected = [...new Set(input.selection.planItemIds)].sort();
  if (selected.length !== input.selection.planItemIds.length || selected.some((id) => !input.plan.items.some((item) => item.planItemId === id && item.mappingStatus === "mappable"))) {
    return failure("legacy_selection_invalid", "Legacy import selection is invalid");
  }
  const snapshot = await loadLegacySnapshot(input.sourcePath);
  if (snapshot.scan.status === "unavailable") return failure("legacy_source_unavailable", "Legacy research source is unavailable");
  if (snapshot.scan.sourceFingerprint !== input.plan.sourceFingerprint || snapshot.scan.sourceDatabaseFingerprint !== input.plan.sourceDatabaseFingerprint) {
    return failure("legacy_source_changed", "Legacy research source changed after planning");
  }

  const planItem = (kind: LegacyScanItem["kind"], legacyId: string) => input.plan.items.find((item) => item.kind === kind && item.legacyId === legacyId);
  const projectTarget = (legacyProjectId: string) => planItem("project", legacyProjectId)?.targetIds[0];
  const writes: PlannedWrite[] = [];
  for (const itemId of selected) {
    const item = input.plan.items.find((candidate) => candidate.planItemId === itemId);
    if (item === undefined) return failure("legacy_selection_invalid", "Legacy import selection is invalid");
    if (item.kind === "project") {
      const row = snapshot.projects.find((value) => value.projectId === item.legacyId);
      if (!row || !item.targetIds[0]) return failure("legacy_import_failed", "A selected legacy project cannot be mapped");
      const source = sourceFor(item, row.createdAt); if (!source.ok) return failure("legacy_import_failed", "A selected legacy project cannot be mapped");
      const mapped = mapLegacyProject(row, item.targetIds[0], source.value);
      if (!mapped) return failure("legacy_import_failed", "A selected legacy project cannot be mapped");
      writes.push({ kind: "project", value: mapped });
    } else if (item.kind === "contract") {
      const row = snapshot.contracts.find((value) => value.contractId === item.legacyId);
      const projectId = row ? projectTarget(row.projectId) : undefined;
      if (!row || !projectId || !selected.includes(planItem("project", row.projectId)?.planItemId ?? "") || !item.targetIds[0] || !item.targetIds[1]) {
        return failure("legacy_selection_invalid", "A selected contract requires its selected project");
      }
      const raw = (() => { try { return JSON.parse(row.data) as { createdAt?: string }; } catch { return {}; } })();
      const at = typeof raw.createdAt === "string" ? raw.createdAt : "1970-01-01T00:00:00.000Z";
      const source = sourceFor(item, at); if (!source.ok) return failure("legacy_import_failed", "A selected legacy contract cannot be mapped");
      const mapped = mapLegacyContract(row, {
        projectId, artifactId: item.targetIds[0], briefId: item.targetIds[1],
        briefVersionId: deterministicResearchId("rbrf_", input.plan.sourceDatabaseFingerprint, "contract", row.contractId, "brief-version", input.plan.mappingVersion),
        expectedDeltaId: deterministicResearchId("rbrf_", input.plan.sourceDatabaseFingerprint, "contract", row.contractId, "expected-delta", input.plan.mappingVersion),
      }, source.value);
      if (!mapped) return failure("legacy_import_failed", "A selected legacy contract cannot be mapped");
      writes.push({ kind: "artifact", value: mapped.artifact }, { kind: "brief", value: mapped.brief });
    } else if (item.kind === "correction") {
      const row = snapshot.corrections.find((value) => value.correctionId === item.legacyId);
      const contract = row ? snapshot.contracts.find((value) => value.projectId === row.projectId) : undefined;
      const contractItem = contract ? planItem("contract", contract.contractId) : undefined;
      const projectId = row ? projectTarget(row.projectId) : undefined;
      if (!row || !contract || !contractItem || !projectId || !selected.includes(contractItem.planItemId) || !item.targetIds[0]) {
        return failure("legacy_selection_invalid", "A selected correction requires a selected contract");
      }
      const raw = (() => { try { return JSON.parse(row.data) as { createdAt?: string }; } catch { return {}; } })();
      const at = typeof raw.createdAt === "string" ? raw.createdAt : "1970-01-01T00:00:00.000Z";
      const source = sourceFor(item, at); if (!source.ok) return failure("legacy_import_failed", "A selected legacy correction cannot be mapped");
      const mapped = mapLegacyCorrection(row, {
        projectId, decisionId: item.targetIds[0],
        briefVersionId: deterministicResearchId("rbrf_", input.plan.sourceDatabaseFingerprint, "contract", contract.contractId, "brief-version", input.plan.mappingVersion),
      }, source.value);
      if (!mapped) return failure("legacy_import_failed", "A selected legacy correction cannot be mapped");
      writes.push({ kind: "decision", value: mapped });
    }
  }

  const store = createResearchStore(input.targetDatabase);
  const pending: PlannedWrite[] = [];
  const skipped: string[] = [];
  for (const write of writes) {
    const existing = getExisting(store, write);
    if (!existing.ok) return failure("legacy_import_failed", "Legacy import target could not be verified");
    if (existing.value === undefined) pending.push(write);
    else if (sameValue(existing.value, write.value)) skipped.push(write.value.id);
    else return failure("legacy_import_conflict", "Legacy import identity conflicts with existing research state");
  }
  const writePriority: Readonly<Record<PlannedWrite["kind"], number>> = { project: 0, artifact: 1, brief: 2, decision: 3 };
  const orderedPending = pending.toSorted((left, right) => writePriority[left.kind] - writePriority[right.kind]);
  const committed = store.unitOfWork.commit((repositories) => {
    for (const write of orderedPending) {
      const result = createWrite(repositories, write);
      if (!result.ok) return result;
    }
    return { ok: true, value: orderedPending.length };
  });
  if (!committed.ok) return failure("legacy_import_failed", "Legacy import transaction failed");
  return { ok: true, report: createVerificationReport(input.plan, selected, pending.map((write) => write.value.id), skipped) };
}
