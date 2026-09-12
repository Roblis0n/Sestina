import {
  openResearchDeliberationKernel,
  createKernelProject,
  previewKernelPreMigrationRestore,
  restoreKernelPreMigrationBackup,
  previewKernelMigration,
  migrateKernelProject,
  recoverKernelMigration,
  kernelHash,
  repairMissingKernelBrief,
  KernelFault,
  KernelApplicationFault,
  kernelRecord,
  kernelText,
  kernelInteger,
  type KernelApplicationOptions,
  type ResearchDeliberationKernel,
  ProjectRecoveryConfirmationService,
  createProjectStateBackup,
  createPreUpgradeProjectStateBackup,
  inspectProjectRecovery,
  recoverInterruptedProjectStateRestore,
  type CoreResult,
} from "@sestina/core";
import { HostDraftBridge } from "./host-draft-bridge.js";
import type { KernelApplicationPort } from "@sestina/application-ports";

/** Thin transport mapping; state transitions and authority checks remain in Core. */
export class KernelApplicationApi implements KernelApplicationPort {
  #kernel: ResearchDeliberationKernel | undefined;
  #opening = false;
  #openingOpId = 0;
  #epoch = 0;
  #disposed = false;
  #readOnly = false;
  #maintaining = false;
  readonly #recovery = new ProjectRecoveryConfirmationService();
  get maintaining() {
    return this.#maintaining;
  }
  readonly #capability = Object.freeze({});
  readonly #bridge = new HostDraftBridge(
    (body, connectionId) => {
      if (!this.#kernel) throw new KernelFault("illegal_transition");
      return this.#kernel.importReviewEnvelope(body, connectionId);
    },
    (connectionId, invocationId) =>
      this.#kernel?.hostDraftStatus(connectionId, invocationId),
  );
  constructor(
    private readonly options: Omit<KernelApplicationOptions, "resolveUser">,
  ) {}
  get active() {
    return this.#kernel !== undefined && !this.#disposed;
  }
  get disposed() {
    return this.#disposed;
  }
  status() {
    return {
      projectId: this.#kernel?.projectId ?? null,
      sessionGeneration: this.#epoch,
      automaticSend: false,
      readOnly: this.#readOnly,
    };
  }
  close(options?: { dispose?: boolean }) {
    if (options?.dispose) {
      this.#disposed = true;
    }
    this.#epoch++;
    this.#bridge.close();
    const k = this.#kernel;
    this.#kernel = undefined;
    k?.close();
  }
  dispose() {
    this.close({ dispose: true });
  }
  async create(input: unknown) {
    if (this.#disposed || this.#opening || this.#maintaining)
      throw new KernelFault("storage_unavailable");
    const body = kernelRecord(input, ["projectPath", "title", "confirmed"]);
    kernelText(body.projectPath, 4096);
    this.close();
    const epoch = this.#epoch;
    this.#opening = true;
    try {
      await createKernelProject(body);
      if (this.disposed || epoch !== this.#epoch)
        throw new KernelFault("storage_unavailable");
    } finally {
      this.#opening = false;
    }
    return this.open({ projectPath: body.projectPath });
  }
  async maintenance(input: unknown) {
    const body = kernelRecord(input, [
      "projectPath",
      "action",
      "confirmed",
      "previewHash",
      "sessionGeneration",
      "backupId",
      "confirmationNonce",
      "expectedStateBinding",
    ]);
    kernelText(body.projectPath, 4096);
    if (this.#disposed || this.#opening || this.#maintaining || this.active)
      throw new KernelFault("storage_unavailable");
    if (
      [
        "backup",
        "pre_upgrade_backup",
        "backup_status",
        "backup_restore_preview",
        "backup_restore",
        "backup_recover",
      ].includes(String(body.action))
    ) {
      if (body.sessionGeneration !== this.#epoch)
        throw new KernelFault("stale_revision");
      const sessionBinding = kernelHash({ generation: this.#epoch });
      const options = { projectRoot: body.projectPath, kernelRecovery: true };
      const unwrap = <T>(result: CoreResult<T>): T => {
        if (!result.ok)
          throw Object.assign(new Error(result.error.code), {
            code: result.error.code,
          });
        return result.value;
      };
      this.#maintaining = true;
      try {
        if (body.action === "backup")
          return unwrap(await createProjectStateBackup(options));
        if (body.action === "pre_upgrade_backup")
          return unwrap(await createPreUpgradeProjectStateBackup(options));
        if (body.action === "backup_status")
          return unwrap(await inspectProjectRecovery(options));
        if (body.action === "backup_recover")
          return unwrap(
            await recoverInterruptedProjectStateRestore({
              ...options,
              confirmed: body.confirmed === true,
            }),
          );
        kernelText(body.backupId, 128);
        const input = { ...options, backupId: body.backupId, sessionBinding };
        if (body.action === "backup_restore_preview")
          return unwrap(await this.#recovery.prepare(input));
        kernelText(body.confirmationNonce, 64);
        kernelText(body.expectedStateBinding, 64);
        return unwrap(
          await this.#recovery.execute({
            ...input,
            confirmed: body.confirmed === true,
            confirmationNonce: body.confirmationNonce,
            expectedStateBinding: body.expectedStateBinding,
          }),
        );
      } finally {
        this.#maintaining = false;
      }
    }
    this.#maintaining = true;
    try {
      if (body.action === "restore_preview")
        return await previewKernelPreMigrationRestore(body.projectPath);
      if (body.action === "preview") {
        const preview = await previewKernelMigration(body.projectPath);
        return { ...preview, previewHash: kernelHash(preview) };
      }
      if (body.confirmed !== true) throw new KernelFault("authority_required");
      if (body.action === "restore") {
        kernelText(body.previewHash, 64);
        return await restoreKernelPreMigrationBackup(
          body.projectPath,
          undefined,
          body.previewHash,
        );
      }
      if (body.action === "recover")
        return await recoverKernelMigration(body.projectPath);
      if (body.action !== "migrate") throw new KernelFault("invalid_record");
      const preview = await previewKernelMigration(body.projectPath);
      if (body.previewHash !== kernelHash(preview))
        throw new KernelFault("stale_revision");
      return await migrateKernelProject({
        projectRoot: body.projectPath,
        expectedSource: {
          projectId: preview.projectId,
          sourceDatabaseHash: preview.sourceDatabaseHash,
          sourceBriefHash: preview.sourceBriefHash,
          sourceWalHash: preview.sourceWalHash,
        },
      });
    } finally {
      this.#maintaining = false;
    }
  }
  async open(input: unknown) {
    if (this.#disposed || this.#maintaining)
      throw new KernelFault("storage_unavailable");
    const body = kernelRecord(input, ["projectPath", "readOnly"]);
    kernelText(body.projectPath, 4096);
    if (body.readOnly !== undefined && typeof body.readOnly !== "boolean")
      throw new KernelFault("invalid_record");
    if (this.#opening) throw new KernelFault("storage_unavailable");
    this.#opening = true;
    const opId = ++this.#openingOpId;
    this.close();
    const currentEpoch = ++this.#epoch;
    let openedKernel: ResearchDeliberationKernel | undefined;
    try {
      openedKernel = await openResearchDeliberationKernel(body.projectPath, {
        ...this.options,
        readOnly: body.readOnly === true,
        resolveUser: (c) =>
          c === this.#capability &&
          !this.#disposed &&
          this.#epoch === currentEpoch
            ? { kind: "user", actorId: "local-research-owner" }
            : undefined,
      });
      if (this.disposed || this.#epoch !== currentEpoch) {
        openedKernel.close();
        openedKernel = undefined;
        throw new KernelFault("storage_unavailable");
      }
      this.#kernel = openedKernel;
      this.#readOnly = body.readOnly === true;
      return {
        projectId: this.#kernel.projectId,
        sessionGeneration: this.#epoch,
        schema: 25,
        mode: "persistent_review",
        automaticSend: false,
        readOnly: this.#readOnly,
      };
    } catch (error) {
      if (openedKernel) {
        try {
          openedKernel.close();
        } catch {
          /* Preserve the original open error after best-effort handle cleanup. */
        }
      }
      throw error;
    } finally {
      if (this.#openingOpId === opId) {
        this.#opening = false;
      }
    }
  }
  async repairBrief(input: unknown) {
    if (this.#disposed || this.#maintaining)
      throw new KernelFault("storage_unavailable");
    const body = kernelRecord(input, ["projectPath", "confirmed"]);
    kernelText(body.projectPath, 4096);
    if (body.confirmed !== true) throw new KernelFault("authority_required");
    if (this.#opening) throw new KernelFault("storage_unavailable");
    this.#opening = true;
    const opId = ++this.#openingOpId;
    this.close();
    const currentEpoch = ++this.#epoch;
    try {
      const result = await repairMissingKernelBrief(body.projectPath);
      if (this.disposed || this.#epoch !== currentEpoch) {
        throw new KernelFault("storage_unavailable");
      }
      return result;
    } finally {
      if (this.#openingOpId === opId) {
        this.#opening = false;
      }
    }
  }
  async execute(input: unknown, requireSession = false) {
    const k = this.#kernel;
    if (!k || this.#disposed)
      throw new KernelApplicationFault("illegal_transition", [
        "kernel_project_not_open",
      ]);
    const body = kernelRecord(input, [
      "action",
      "sessionGeneration",
      "projectId",
      "reviewId",
      "expectedVersion",
      "suggestion",
      "sourceReviewId",
      "selection",
      "useProvider",
      "confirmed",
      "manifestIdentityHash",
      "payload",
      "previewHash",
      "authorityCommandId",
      "limit",
      "cursor",
      "receiptId",
      "attemptId",
      "originalAssessmentHash",
      "reason",
      "query",
      "effectKind",
      "targetKinds",
      "requestedCorrection",
      "findingIndex",
      "envelope",
      "commandId",
      "expectedRevision",
      "input",
      "trigger",
      "objectIds",
      "sourceKind",
      "sourceId",
      "planHash",
      "resume",
      "copyAction",
      "objectRef",
    ]);
    if (body.projectId !== k.projectId)
      throw new KernelFault("relation_mismatch");
    if (
      (requireSession || body.sessionGeneration !== undefined) &&
      body.sessionGeneration !== this.#epoch
    )
      throw new KernelApplicationFault("authority_required", [
        "project_session_changed",
      ]);
    const action = body.action;
    if (
      this.#readOnly &&
      ![
        "workspace",
        "read",
        "brief",
        "relationships",
        "artifact_context",
        "coverage",
        "brief_conflict",
        "correction_history",
        "list",
        "lookup",
        "legacy_history",
        "legacy_detail",
        "memory",
        "privacy_status",
        "memory_source",
      ].includes(typeof action === "string" ? action : "")
    )
      throw new KernelApplicationFault("authority_required", [
        "project_read_only",
      ]);
    const fields: Record<string, readonly string[]> = {
      enable_host_bridge: [],
      legacy_history: ["sourceKind", "limit", "cursor"],
      convert_legacy: ["sourceKind", "sourceId", "suggestion"],
      revoke_host_bridge: [],
      import_envelope: ["envelope"],
      memory: [],
      privacy_status: [],
      privacy_copy_preview: [],
      privacy_cleanup: ["planHash", "resume", "confirmed", "copyAction"],
      recall_memory: ["trigger", "objectIds"],
      govern_memory: ["commandId", "expectedRevision", "input"],
      brief: [],
      publish_brief: [],
      memory_source: ["objectRef"],
      relationships: ["query"],
      artifact_context: ["objectRef"],
      coverage: ["reviewId", "effectKind", "targetKinds"],
      brief_conflict: ["reviewId"],
      correction_history: ["reviewId"],
      create: ["suggestion", "sourceReviewId"],
      read: ["reviewId"],
      manifest: ["reviewId"],
      list: ["limit", "cursor"],
      workspace: ["query"],
      rebuild_views: [],
      legacy_detail: ["sourceKind", "sourceId"],
      lookup: ["authorityCommandId"],
      edit: ["reviewId", "expectedVersion", "suggestion"],
      prepare_manifest: [
        "reviewId",
        "expectedVersion",
        "selection",
        "useProvider",
      ],
      confirm_manifest: [
        "reviewId",
        "expectedVersion",
        "manifestIdentityHash",
        "confirmed",
      ],
      skip_assessment: ["reviewId", "expectedVersion", "selection"],
      prepare_attempt: ["reviewId", "expectedVersion"],
      start_attempt: [
        "reviewId",
        "expectedVersion",
        "manifestIdentityHash",
        "confirmed",
      ],
      cancel_attempt: ["reviewId", "expectedVersion"],
      cancel: ["reviewId", "expectedVersion"],
      prepare_effect: ["reviewId", "expectedVersion", "payload"],
      commit: [
        "reviewId",
        "expectedVersion",
        "previewHash",
        "authorityCommandId",
        "confirmed",
      ],
      prepare_compensation: ["receiptId", "payload"],
      append_correction: [
        "requestedCorrection",
        "findingIndex",
        "reviewId",
        "expectedVersion",
        "attemptId",
        "originalAssessmentHash",
        "reason",
      ],
    };
    if (typeof action !== "string" || !Object.hasOwn(fields, action))
      throw new KernelFault("invalid_record");
    kernelRecord(body, [
      "action",
      "projectId",
      "sessionGeneration",
      ...(fields[action] ?? []),
    ]);
    if (
      ["confirm_manifest", "start_attempt", "commit"].includes(action) &&
      body.confirmed !== true
    )
      throw new KernelFault("authority_required");
    const cap = this.#capability;
    if (action === "workspace") return k.workspace(body.query, cap);
    if (action === "legacy_detail") {
      kernelText(body.sourceKind, 80);
      kernelText(body.sourceId, 160);
      return k.legacyDetail(body.sourceKind, body.sourceId, cap);
    }
    if (action === "legacy_history") {
      kernelText(body.sourceKind, 80);
      kernelInteger(body.limit);
      if (body.cursor !== undefined) kernelText(body.cursor, 160);
      return k.legacyHistory(
        body.sourceKind,
        { limit: body.limit, ...(body.cursor ? { cursor: body.cursor } : {}) },
        cap,
      );
    }
    if (action === "convert_legacy") {
      kernelText(body.sourceKind, 80);
      kernelText(body.sourceId, 160);
      kernelText(body.suggestion, 65536);
      return k.convertLegacy(
        body.sourceKind,
        body.sourceId,
        body.suggestion,
        cap,
      );
    }
    if (action === "rebuild_views") return k.rebuildWorkspace(cap);
    if (action === "enable_host_bridge") return this.#bridge.enable();
    if (action === "revoke_host_bridge") {
      this.#bridge.close();
      return { revoked: true };
    }
    if (action === "import_envelope")
      return k.importReviewEnvelope(body.envelope, "local-user-import");
    if (action === "memory") return k.memory(cap);
    if (action === "privacy_status") return k.privacyStatus(cap);
    if (action === "privacy_copy_preview") return k.privacyCopyPreview(cap);
    if (action === "privacy_cleanup") {
      if (body.confirmed !== true || typeof body.resume !== "boolean")
        throw new KernelFault("authority_required");
      if (
        body.copyAction !== undefined &&
        body.copyAction !== "delete" &&
        body.copyAction !== "retire"
      )
        throw new KernelFault("invalid_record");
      kernelText(body.planHash, 64);
      return k.cleanupPrivacy(body.planHash, body.resume, cap, body.copyAction);
    }
    if (action === "recall_memory") {
      kernelText(body.trigger, 80);
      if (
        !Array.isArray(body.objectIds) ||
        body.objectIds.length > 100 ||
        body.objectIds.some((v) => typeof v !== "string")
      )
        throw new KernelFault("invalid_record");
      return k.recallMemory(body.trigger, body.objectIds, cap);
    }
    if (action === "govern_memory") {
      kernelText(body.commandId, 160);
      kernelInteger(body.expectedRevision);
      return k.governMemory(
        body.commandId,
        body.expectedRevision,
        body.input,
        cap,
      );
    }
    if (action === "correction_history") {
      kernelText(body.reviewId, 160);
      return k.correctionHistory(body.reviewId, cap);
    }
    if (action === "brief") return k.brief(cap);
    if (action === "publish_brief") return k.publishBrief(cap);
    if (action === "memory_source") return k.memorySource(body.objectRef, cap);
    if (action === "relationships") return k.relationships(body.query, cap);
    if (action === "artifact_context")
      return k.artifactContext(body.objectRef, cap);
    if (action === "coverage") {
      kernelText(body.reviewId, 160);
      if (
        !Array.isArray(body.targetKinds) ||
        body.targetKinds.some((t) => typeof t !== "string")
      )
        throw new KernelFault("invalid_record");
      return k.coverage(
        body.reviewId,
        body.effectKind as Parameters<typeof k.coverage>[1],
        body.targetKinds,
        cap,
      );
    }
    if (action === "brief_conflict") {
      kernelText(body.reviewId, 160);
      return k.briefConflict(body.reviewId, cap);
    }
    if (action === "prepare_compensation") {
      kernelText(body.receiptId, 160);
      return k.prepareCompensation(body.receiptId, body.payload, cap);
    }
    if (action === "create") {
      kernelText(body.suggestion, 65_536);
      if (body.sourceReviewId !== undefined)
        kernelText(body.sourceReviewId, 160);
      return k.createReview(body.suggestion, cap, body.sourceReviewId);
    }
    if (action === "list") {
      kernelInteger(body.limit);
      if (body.cursor !== undefined) kernelText(body.cursor, 8192);
      return k.list(cap, {
        limit: body.limit,
        ...(body.cursor ? { cursor: body.cursor } : {}),
      });
    }
    if (action === "lookup") {
      kernelText(body.authorityCommandId, 160);
      return k.lookupCommand(body.authorityCommandId, cap) ?? null;
    }
    kernelText(body.reviewId, 160);
    const id = body.reviewId;
    if (action === "read") return k.readReview(id, cap);
    if (action === "manifest") return k.inspectManifest(id, cap) ?? null;
    kernelInteger(body.expectedVersion);
    const version = body.expectedVersion;
    if (action === "append_correction") {
      kernelText(body.attemptId, 160);
      kernelText(body.originalAssessmentHash, 64);
      kernelText(body.reason, 8192);
      return k.appendCorrection(
        id,
        version,
        body.attemptId,
        body.originalAssessmentHash,
        body.reason,
        cap,
        {
          requestedCorrection: (body.requestedCorrection ??
            "qualify") as "qualify",
          ...(body.findingIndex === undefined
            ? {}
            : { findingIndex: body.findingIndex as number }),
        },
      );
    }
    if (action === "edit") {
      kernelText(body.suggestion, 65_536);
      return k.edit(id, version, body.suggestion, cap);
    }
    if (action === "prepare_manifest") {
      if (typeof body.useProvider !== "boolean")
        throw new KernelFault("invalid_record");
      const selection = kernelRecord(body.selection, [
        "coverageScope",
        "evidenceIds",
        "issueIds",
        "memory",
      ]);
      return k.prepareManifest(id, version, selection, body.useProvider, cap);
    }
    if (action === "skip_assessment")
      return k.skipAssessment(
        id,
        version,
        cap,
        body.selection === undefined
          ? undefined
          : kernelRecord(body.selection, [
              "coverageScope",
              "evidenceIds",
              "issueIds",
              "memory",
            ]),
      );
    if (action === "confirm_manifest" || action === "start_attempt") {
      kernelText(body.manifestIdentityHash, 64);
      return action === "confirm_manifest"
        ? k.confirmManifest(id, version, body.manifestIdentityHash, cap)
        : k.startAttempt(id, version, body.manifestIdentityHash, cap);
    }
    if (action === "prepare_attempt") return k.prepareAttempt(id, version, cap);
    if (action === "cancel_attempt") return k.cancelAttempt(id, version, cap);
    if (action === "cancel") return k.cancel(id, version, cap);
    if (action === "prepare_effect")
      return k.prepareEffect(id, version, body.payload, cap);
    kernelText(body.previewHash, 64);
    kernelText(body.authorityCommandId, 160);
    const receipt = k.commitEffect(
      id,
      version,
      body.previewHash,
      body.authorityCommandId,
      cap,
    );
    if (
      ["patch_brief", "formal_direction_change"].includes(receipt.effectKind)
    ) {
      try {
        return { ...receipt, briefPublication: k.publishBrief(cap) };
      } catch {
        return {
          ...receipt,
          briefPublication: {
            status: "repair_required",
            canonicalResultSaved: true,
          },
        };
      }
    }
    return receipt;
  }
}
