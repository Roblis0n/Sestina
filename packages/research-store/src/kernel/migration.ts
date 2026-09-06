import {
  KernelFault,
  kernelHash,
  kernelBytesHash,
  kernelCanonicalJson,
  parseKernelReview,
  parseResearchRoomReceipt,
  parseCorrectionAppeal,
  parseDeliberationRoom,
  parseClosedExternalAppPilot,
  parseResumeCheckpoint,
  parseKernelAttempt,
  parseKernelManifest,
  parseKernelCorrection,
  parseKernelReceipt,
  type KernelReview,
  parseResearchBrief,
  parseResearchDecision,
  type ResearchBriefVersion,
} from "@sestina/research";
import {
  withTransaction,
  withReadSnapshot,
  KERNEL_MIGRATIONS,
  KERNEL_SCHEMA_VERSION,
  verifyKernelTargetShape,
  type StorageDatabase,
} from "@sestina/storage";
import {
  appendKernelEvent,
  decodeKernelJson,
  readCanonicalState,
  validateKernelChain,
} from "./state.js";
import { validateKernelRelations } from "./repositories.js";

function required<T>(item: T | undefined): T {
  if (item === undefined) throw new KernelFault("corrupt_state");
  return item;
}
export interface KernelMigrationProvenance {
  readonly runId: string;
  readonly sourceSchema: number;
  readonly sourceHash: string;
  readonly backupHash: string;
  readonly createdAt: string;
  readonly tableMappings: readonly {
    readonly name: string;
    readonly rows: number;
    readonly contentHash: string;
    readonly disposition: string;
  }[];
}
export function derivedKernelId(prefix: string, value: unknown): string {
  return prefix + kernelHash(value).slice(0, 26).toUpperCase();
}
function value<T>(
  result: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!result.ok) throw new KernelFault("corrupt_state");
  return result.value;
}
function insertReview(db: StorageDatabase, input: KernelReview) {
  const r = parseKernelReview(input);
  db.run(
    "INSERT INTO research_reviews(review_id,project_id,status,base_revision,version,suggestion_hash,manifest_id,created_at,updated_at,data) VALUES(?,?,?,?,?,?,?,?,?,?)",
    r.id,
    r.projectId,
    r.status,
    r.baseProjectStateRevision,
    r.version,
    r.suggestionHash,
    r.manifestId,
    r.createdAt,
    r.updatedAt,
    kernelCanonicalJson(r),
  );
}
function mapping(
  db: StorageDatabase,
  projectId: string,
  kind: string,
  id: string,
  raw: string,
  classification: string,
  projection: unknown,
) {
  db.run(
    "INSERT INTO research_legacy_mappings(project_id,source_kind,source_id,source_hash,classification,data) VALUES(?,?,?,?,?,?)",
    projectId,
    kind,
    id,
    kernelBytesHash(raw),
    classification,
    kernelCanonicalJson({
      schemaVersion: "2.0.0",
      sourceKind: kind,
      sourceId: id,
      legacyPayloadHash: kernelBytesHash(raw),
      projection,
      canonicalAuthority: false,
      canCreate: false,
      canRetry: false,
      canChallenge: false,
      canResolve: false,
    }),
  );
}

/** One-time backfill in the verified staging copy; never emits invented effects. */
export function backfillKernelProject(
  db: StorageDatabase,
  provenance: KernelMigrationProvenance,
): void {
  withTransaction(db, () => {
    db.withKernelWrite("migration", () => {
      const projects = db.all<{ project_id: string }>(
        "SELECT project_id FROM research_projects ORDER BY project_id",
      );
      if (projects.length !== 1) throw new KernelFault("relation_mismatch");
      const projectId = required(projects[0]).project_id;
      if (db.get("SELECT 1 FROM research_project_state_heads"))
        throw new KernelFault("corrupt_state");
      for (const row of db.all<{
        brief_id: string;
        version: number;
        data: string;
      }>(
        "SELECT brief_id,version,data FROM research_briefs WHERE project_id=? ORDER BY brief_id",
        projectId,
      )) {
        const brief = value(parseResearchBrief(decodeKernelJson(row.data)));
        const decisions = db
          .all<{ data: string }>(
            "SELECT data FROM research_decisions WHERE project_id=?",
            projectId,
          )
          .map((r) => value(parseResearchDecision(decodeKernelJson(r.data))));
        const versions = brief.versions.map((version) => {
          const sections = Object.fromEntries(
            [
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
            ].map((field) => {
              const raw: unknown =
                field === "knownUnknowns"
                  ? undefined
                  : version[field as keyof ResearchBriefVersion];
              const empty =
                raw === "" || (Array.isArray(raw) && raw.length === 0);
              const knownUserSave =
                version.source.authority === "user_recorded";
              return [
                field,
                raw === undefined
                  ? { state: "not_provided" }
                  : empty && knownUserSave
                    ? {
                        state: "intentionally_empty",
                        publicReason: "migration_interpreted_empty",
                      }
                    : empty
                      ? { state: "not_provided" }
                      : { state: "provided" },
              ];
            }),
          );
          const decisionLinks = version.fixedDecisions.map((fixed) => {
            const matching = decisions.filter(
              (decision) =>
                decision.statement === fixed.statement &&
                fixed.scope.target.kind === "artifact" &&
                decision.scope.kind === "artifact" &&
                fixed.scope.target.artifactId === decision.scope.artifactId,
            );
            return matching.length === 1
              ? {
                  legacyConstraintId: fixed.id,
                  decisionId: required(matching[0]).id,
                  mapping: "unambiguous_existing_decision",
                }
              : {
                  legacyConstraintId: fixed.id,
                  decisionId: null,
                  mapping: "legacy_constraint_not_promoted",
                };
          });
          return {
            versionId: version.id,
            sections,
            decisionLinks,
            evidenceThreshold: {
              kind: "legacy_text_rule",
              rules: version.evidenceBoundaries,
              interpretation: "not_inferred",
              quality: "unproven",
            },
            limitations: [
              "Typed thresholds were not recorded by the legacy runtime.",
              "Known unknowns were not a legacy field.",
            ],
          };
        });
        db.run(
          "INSERT INTO research_brief_metadata(project_id,brief_id,version,data) VALUES(?,?,?,?)",
          projectId,
          row.brief_id,
          row.version,
          kernelCanonicalJson({
            schemaVersion: "2.0.0",
            legacySchemaVersion: "1.0.0",
            legacyPayloadHash: kernelBytesHash(row.data),
            currentVersionId: brief.currentVersionId,
            versions,
          }),
        );
      }
      for (const row of db.all<{ receipt_id: string; data: string }>(
        "SELECT receipt_id,data FROM research_room_receipts WHERE project_id=? ORDER BY created_at,receipt_id",
        projectId,
      )) {
        const receipt = value(
          parseResearchRoomReceipt(decodeKernelJson(row.data)),
        );
        let classification = "lossless";
        let kind = "record_only";
        const resultingObjects: {
          kind: string;
          id: string;
          version: number;
        }[] = [];
        if (
          ["accepted", "modified_accepted"].includes(receipt.disposition.kind)
        ) {
          kind = "legacy_record_only_unresolved_effect";
          classification = "lossy";
        }
        if (receipt.disposition.kind === "direction_changed") {
          const rows = db.all<{ data: string }>(
            "SELECT data FROM research_briefs WHERE project_id=?",
            projectId,
          );
          const versions = rows.flatMap(
            (r) => value(parseResearchBrief(decodeKernelJson(r.data))).versions,
          );
          const before = versions.find(
            (v) => v.id === receipt.before.briefVersionId,
          );
          const after = versions.find(
            (v) => v.id === receipt.after.briefVersionId,
          );
          if (
            before &&
            after &&
            before.id !== after.id &&
            after.projectQuestion === receipt.disposition.redirectQuestion &&
            before.projectQuestion === receipt.rollback.priorQuestion
          ) {
            kind = "formal_direction_change";
            resultingObjects.push({
              kind: "brief_version",
              id: after.id,
              version: receipt.after.briefVersionNumber,
            });
          } else {
            kind = "legacy_record_only_unresolved_effect";
            classification = "lossy";
          }
        }
        const suggestion = receipt.analysis.proposal.normalize("NFC");
        insertReview(db, {
          schemaVersion: "2.0.0",
          id: receipt.reviewId,
          projectId,
          source: { kind: "legacy_receipt", id: receipt.id },
          suggestion,
          suggestionHash: kernelBytesHash(suggestion),
          requestedTarget: null,
          status: "disposed",
          baseProjectStateRevision: 1,
          manifestId: null,
          attemptIds: [],
          effectDraft: null,
          terminalOutcome: { kind, receiptId: null, resultingObjects },
          staleReason: null,
          version: 1,
          createdAt: receipt.createdAt,
          updatedAt: receipt.updatedAt,
        });
        mapping(
          db,
          projectId,
          "research_room_receipts",
          row.receipt_id,
          row.data,
          classification,
          {
            reviewId: receipt.reviewId,
            outcomeKind: kind,
            canonical_effect_unresolved:
              kind === "legacy_record_only_unresolved_effect",
            originalReceiptHash: receipt.receiptHash,
            originalStatus: receipt.status,
            resultingObjects,
            compensationProvenance:
              receipt.status === "rolled_back" ? receipt.rollback : null,
            historicalRevisionSequence: "not_reconstructed",
          },
        );
      }
      for (const [table, idColumn, parser] of [
        ["correction_appeals", "appeal_id", parseCorrectionAppeal],
        ["deliberation_rooms", "room_id", parseDeliberationRoom],
        ["closed_external_app_pilots", "pilot_id", parseClosedExternalAppPilot],
      ] as const) {
        for (const row of db.all<{ id: string; data: string }>(
          `SELECT ${idColumn} id,data FROM ${table} WHERE project_id=? ORDER BY ${idColumn}`,
          projectId,
        )) {
          const parsed = parser(decodeKernelJson(row.data));
          if (!parsed.ok) throw new KernelFault("corrupt_state");
          const legacy = parsed.value;
          const status = legacy.status;
          let classification = [
            "resolved",
            "closed",
            "completed",
            "cancelled",
          ].includes(status)
            ? "lossless"
            : "legacy_incomplete";
          const reviewId =
            table === "correction_appeals"
              ? value(parseCorrectionAppeal(decodeKernelJson(row.data))).source
                  .reviewId
              : null;
          if (
            reviewId &&
            !db.get(
              "SELECT 1 FROM research_reviews WHERE project_id=? AND review_id=?",
              projectId,
              reviewId,
            )
          )
            classification = "orphan";
          mapping(db, projectId, table, row.id, row.data, classification, {
            originalStatus: status,
            reviewId,
            originalResolutionIsCanonical: false,
            recoveryAction: "history_only_no_resume",
            assessmentIndependence: "unproven",
          });
        }
      }
      for (const row of db.all<{
        item_id: string;
        state: string;
        version: number;
        data: string;
      }>(
        "SELECT item_id,status state,version,data FROM project_working_memory WHERE project_id=? ORDER BY item_id",
        projectId,
      )) {
        db.run(
          "INSERT INTO research_memory_metadata(project_id,item_id,last_confirmed_revision,version) VALUES(?,?,?,?)",
          projectId,
          row.item_id,
          row.state === "active" ? 1 : null,
          row.version,
        );
        if (row.state === "forgotten") {
          const data = {
            schemaVersion: "2.0.0",
            kind: "legacy_forget_tombstone",
            objectId: row.item_id,
            bodyAvailable: false,
            backupCopyCoverage: "unknown_before_migration",
          };
          db.run(
            "INSERT INTO research_privacy_redactions(redaction_id,project_id,object_kind,object_id,source_revision,created_at,data) VALUES(?,?,?,?,?,?,?)",
            derivedKernelId("rapc_", { projectId, forgotten: row.item_id }),
            projectId,
            "memory",
            row.item_id,
            1,
            provenance.createdAt,
            kernelCanonicalJson(data),
          );
        }
      }
      for (const row of db.all<{ checkpoint_id: string; data: string }>(
        "SELECT checkpoint_id,data FROM resume_checkpoints WHERE project_id=?",
        projectId,
      )) {
        value(parseResumeCheckpoint(decodeKernelJson(row.data)));
        db.run(
          "INSERT INTO research_resume_metadata(project_id,checkpoint_id,source_revision,data) VALUES(?,?,1,?)",
          projectId,
          row.checkpoint_id,
          kernelCanonicalJson({
            schemaVersion: "2.0.0",
            legacyPayloadHash: kernelBytesHash(row.data),
            boundToMigrationBaseline: true,
            historicalRevisionSequence: "not_reconstructed",
          }),
        );
      }
      const state = readCanonicalState(db, projectId);
      const canonicalHash = kernelHash(state);
      const eventId = derivedKernelId("rpev_", {
        projectId,
        baseline: provenance.sourceHash,
      });
      appendKernelEvent(db, {
        schemaVersion: "2.0.0",
        id: eventId,
        projectId,
        revision: 1,
        transactionId: `migration:${provenance.runId}`,
        effectKind: "migration_baseline",
        reviewId: null,
        changedObjectRefs: state.objects.map(({ kind, id, version }) => ({
          kind,
          id,
          version,
        })),
        previousCanonicalHash: "0".repeat(64),
        nextCanonicalHash: canonicalHash,
        publicSummary:
          "Migration baseline of preserved research state; earlier revisions were not reconstructed.",
        createdAt: provenance.createdAt,
        compensatesReceiptId: null,
      });
      db.run(
        "INSERT INTO research_project_state_heads(project_id,revision,canonical_hash,event_id,updated_at) VALUES(?,1,?,?,?)",
        projectId,
        canonicalHash,
        eventId,
        provenance.createdAt,
      );
      db.run(
        "INSERT INTO research_projection_outbox(project_id,revision,event_id) VALUES(?,1,?)",
        projectId,
        eventId,
      );
      for (const kind of ["search", "attention", "today", "resume", "history"])
        db.run(
          "INSERT INTO research_projection_metadata(project_id,projection_kind,source_revision,status,version,data) VALUES(?,?,0,'rebuilding',1,?)",
          projectId,
          kind,
          kernelCanonicalJson({
            schemaVersion: "2.0.0",
            legacyIndexUsedAsAuthority: false,
          }),
        );
      db.run(
        "INSERT INTO research_projection_metadata(project_id,projection_kind,source_revision,status,version,data) VALUES(?,'brief_file',1,'ready',1,?)",
        projectId,
        kernelCanonicalJson({
          schemaVersion: "1.0.0",
          contentHash: kernelBytesHash(kernelBriefDocument(db, projectId)),
        }),
      );
      db.run(
        "INSERT INTO research_migration_runs(run_id,project_id,source_schema,target_schema,source_hash,backup_hash,data) VALUES(?,?,?,25,?,?,?)",
        provenance.runId,
        projectId,
        provenance.sourceSchema,
        provenance.sourceHash,
        provenance.backupHash,
        kernelCanonicalJson(provenance),
      );
      db.run(
        "INSERT INTO research_copy_inventory(copy_id,project_id,copy_kind,location_token,source_revision,content_hash,status,created_at,data) VALUES(?,?,'pre_migration_backup',?,0,?,'retained',?,?)",
        provenance.runId,
        projectId,
        provenance.runId,
        provenance.backupHash,
        provenance.createdAt,
        kernelCanonicalJson({
          schemaVersion: "2.0.0",
          containsPreMigrationState: true,
          externalCopies: "unknown",
          deletion: "user_controlled",
        }),
      );
    });
  });
}

/** Target Brief is a deterministic YAML-compatible JSON projection of DB truth. */
export function kernelBriefDocument(
  db: StorageDatabase,
  projectId: string,
): string {
  const rows = db.all<{
    brief_id: string;
    current_version_id: string;
    data: string;
    metadata: string;
  }>(
    "SELECT b.brief_id,b.current_version_id,b.data,m.data metadata FROM research_briefs b JOIN research_brief_metadata m USING(project_id,brief_id) WHERE b.project_id=? ORDER BY b.brief_id",
    projectId,
  );
  return (
    kernelCanonicalJson({
      schemaVersion: "2.0.0",
      projectId,
      sourceProjectStateRevision:
        db.get<{ revision: number }>(
          "SELECT revision FROM research_project_state_heads WHERE project_id=?",
          projectId,
        )?.revision ?? 1,
      briefs: rows.map((r) => ({
        id: r.brief_id,
        activeVersionId: r.current_version_id,
        content: decodeKernelJson(r.data),
        metadata: decodeKernelJson(r.metadata),
      })),
    }) + "\n"
  );
}
export function validateKernelDatabase(
  db: StorageDatabase,
  projectId: string,
  briefDocument?: string,
  allowVerifiedCachedBrief = false,
): void {
  withReadSnapshot(db, () => {
    verifyKernelTargetShape(db);
    const journal = db.all<{ version: number; name: string; status: string }>(
      "SELECT version,name,status FROM migrations ORDER BY version",
    );
    if (
      journal.length !== KERNEL_SCHEMA_VERSION ||
      journal.some(
        (r, i) =>
          r.version !== i + 1 ||
          r.status !== "completed" ||
          r.name !== KERNEL_MIGRATIONS[i]?.name,
      )
    )
      throw new KernelFault(
        journal.some((r) => r.version > 25) ? "future_schema" : "corrupt_state",
      );
    if (
      db.pragma("integrity_check") !== "ok" ||
      db.all("PRAGMA foreign_key_check").length
    )
      throw new KernelFault("corrupt_state");
    if (
      db.all("SELECT project_id FROM research_projects").length !==
      db.all("SELECT project_id FROM research_project_state_heads").length
    )
      throw new KernelFault("corrupt_state");
    validateKernelChain(db, projectId);
    validateKernelRelations(db, projectId);
    for (const [table, parser] of [
      ["research_reviews", parseKernelReview],
      ["research_provider_attempts", parseKernelAttempt],
      ["context_manifests", parseKernelManifest],
      ["research_review_corrections", parseKernelCorrection],
      ["research_transition_receipts", parseKernelReceipt],
    ] as const) {
      for (const row of db.all<{ data: string }>(
        `SELECT data FROM ${table} WHERE project_id=?`,
        projectId,
      )) {
        const item = (parser as (v: unknown) => { projectId: string })(
          decodeKernelJson(row.data),
        );
        if (item.projectId !== projectId)
          throw new KernelFault("corrupt_state");
      }
    }
    for (const row of db.all<{
      source_kind: string;
      source_id: string;
      source_hash: string;
    }>(
      "SELECT source_kind,source_id,source_hash FROM research_legacy_mappings WHERE project_id=?",
      projectId,
    )) {
      const columns: Record<string, string> = {
        research_room_receipts: "receipt_id",
        correction_appeals: "appeal_id",
        deliberation_rooms: "room_id",
        closed_external_app_pilots: "pilot_id",
      };
      const column = columns[row.source_kind];
      if (!column) throw new KernelFault("corrupt_state");
      const old = db.get<{ data: string }>(
        `SELECT data FROM ${row.source_kind} WHERE project_id=? AND ${column}=?`,
        projectId,
        row.source_id,
      );
      if (!old || kernelBytesHash(old.data) !== row.source_hash)
        throw new KernelFault("corrupt_state");
    }
    if (
      briefDocument !== undefined &&
      briefDocument !== kernelBriefDocument(db, projectId)
    ) {
      const cached = db.get<{ data: string; source_revision: number }>(
        "SELECT data,source_revision FROM research_projection_metadata WHERE project_id=? AND projection_kind='brief_file'",
        projectId,
      );
      const known = cached
        ? (decodeKernelJson(cached.data) as { contentHash?: unknown })
        : undefined;
      if (
        !allowVerifiedCachedBrief ||
        known?.contentHash !== kernelBytesHash(briefDocument)
      )
        throw new KernelFault("relation_mismatch");
    }
  });
}
