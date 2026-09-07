import {
  openResearchDeliberationKernel,
  repairMissingKernelBrief,
  KernelApplicationFault,
  type KernelApplicationOptions,
  type ResearchDeliberationKernel,
} from "@sestina/core";
import { HostDraftBridge } from "./host-draft-bridge.js";
import {
  KernelFault,
  kernelRecord,
  kernelText,
  kernelInteger,
} from "@sestina/core";

/** Thin transport mapping; state transitions and authority checks remain in Core. */
export class KernelApplicationApi {
  #kernel: ResearchDeliberationKernel | undefined;
  #opening = false;
  readonly #capability = Object.freeze({});
  readonly #bridge = new HostDraftBridge((body, connectionId) => {
    if (!this.#kernel) throw new KernelFault("illegal_transition");
    return this.#kernel.importReviewEnvelope(body, connectionId);
  }, (connectionId, invocationId) => this.#kernel?.hostDraftStatus(connectionId, invocationId));
  constructor(
    private readonly options: Omit<KernelApplicationOptions, "resolveUser">,
  ) {}
  get active() {
    return this.#kernel !== undefined;
  }
  status() { return { projectId: this.#kernel?.projectId ?? null, automaticSend: false }; }
  close() {
    this.#bridge.close();
    this.#kernel?.close();
    this.#kernel = undefined;
  }
  async open(input: unknown) {
    const body = kernelRecord(input, ["projectPath"]);
    kernelText(body.projectPath, 4096);
    if (this.#opening) throw new KernelFault("storage_unavailable");
    this.#opening = true;
    try {
      this.close();
      this.#kernel = await openResearchDeliberationKernel(body.projectPath, {
        ...this.options,
        resolveUser: (c) =>
          c === this.#capability
            ? { kind: "user", actorId: "local-research-owner" }
            : undefined,
      });
      return {
        projectId: this.#kernel.projectId,
        schema: 25,
        mode: "persistent_review",
        automaticSend: false,
      };
    } finally {
      this.#opening = false;
    }
  }
  async repairBrief(input: unknown) {
    const body=kernelRecord(input,["projectPath","confirmed"]);
    kernelText(body.projectPath,4096);
    if(body.confirmed!==true) throw new KernelFault("authority_required");
    if(this.#opening) throw new KernelFault("storage_unavailable");
    this.#opening=true;
    try {this.close();return await repairMissingKernelBrief(body.projectPath);}
    finally {this.#opening=false;}
  }
  async execute(input: unknown) {
    const k = this.#kernel;
    if (!k)
      throw new KernelApplicationFault("illegal_transition", [
        "kernel_project_not_open",
      ]);
    const body = kernelRecord(input, [
      "action",
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
      "requestedCorrection", "findingIndex",
      "envelope", "commandId", "expectedRevision", "input", "trigger", "objectIds",
      "sourceKind", "sourceId",
      "planHash", "resume",
      "copyAction",
      "objectRef",
    ]);
    if (body.projectId !== k.projectId)
      throw new KernelFault("relation_mismatch");
    const action = body.action;
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
        "requestedCorrection", "findingIndex",
        "reviewId",
        "expectedVersion",
        "attemptId",
        "originalAssessmentHash",
        "reason",
      ],
    };
    if (typeof action !== "string" || !Object.hasOwn(fields, action))
      throw new KernelFault("invalid_record");
    kernelRecord(body, ["action", "projectId", ...(fields[action] ?? [])]);
    if (
      ["confirm_manifest", "start_attempt", "commit"].includes(action) &&
      body.confirmed !== true
    )
      throw new KernelFault("authority_required");
    const cap = this.#capability;
    if (action === "legacy_history") {
      kernelText(body.sourceKind, 80); kernelInteger(body.limit);
      if (body.cursor !== undefined) kernelText(body.cursor, 160);
      return k.legacyHistory(body.sourceKind, { limit: body.limit, ...(body.cursor ? { cursor: body.cursor } : {}) }, cap);
    }
    if (action === "convert_legacy") {
      kernelText(body.sourceKind, 80); kernelText(body.sourceId, 160); kernelText(body.suggestion, 65536);
      return k.convertLegacy(body.sourceKind, body.sourceId, body.suggestion, cap);
    }
    if (action === "enable_host_bridge") return this.#bridge.enable();
    if (action === "revoke_host_bridge") { this.#bridge.close(); return { revoked: true }; }
    if (action === "import_envelope") return k.importReviewEnvelope(body.envelope, "local-user-import");
    if (action === "memory") return k.memory(cap);
    if (action === "privacy_status") return k.privacyStatus(cap);
    if (action === "privacy_copy_preview") return k.privacyCopyPreview(cap);
    if (action === "privacy_cleanup") {
      if (body.confirmed !== true || typeof body.resume !== "boolean") throw new KernelFault("authority_required");
      if(body.copyAction!==undefined && body.copyAction!=="delete" && body.copyAction!=="retire") throw new KernelFault("invalid_record");
      kernelText(body.planHash, 64); return k.cleanupPrivacy(body.planHash, body.resume, cap, body.copyAction);
    }
    if (action === "recall_memory") {
      kernelText(body.trigger, 80);
      if (!Array.isArray(body.objectIds) || body.objectIds.length > 100 || body.objectIds.some(v => typeof v !== "string")) throw new KernelFault("invalid_record");
      return k.recallMemory(body.trigger, body.objectIds, cap);
    }
    if (action === "govern_memory") {
      kernelText(body.commandId, 160); kernelInteger(body.expectedRevision);
      return k.governMemory(body.commandId, body.expectedRevision, body.input, cap);
    }
    if (action === "correction_history") { kernelText(body.reviewId, 160); return k.correctionHistory(body.reviewId, cap); }
    if (action === "brief") return k.brief(cap);
    if (action === "publish_brief") return k.publishBrief(cap);
    if (action === "memory_source") return k.memorySource(body.objectRef, cap);
    if (action === "relationships") return k.relationships(body.query, cap);
    if (action === "artifact_context") return k.artifactContext(body.objectRef, cap);
    if (action === "coverage") {
      kernelText(body.reviewId, 160);
      if (!Array.isArray(body.targetKinds) || body.targetKinds.some(t => typeof t !== "string")) throw new KernelFault("invalid_record");
      return k.coverage(body.reviewId, body.effectKind as Parameters<typeof k.coverage>[1], body.targetKinds, cap);
    }
    if (action === "brief_conflict") { kernelText(body.reviewId, 160); return k.briefConflict(body.reviewId, cap); }
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
        { requestedCorrection: (body.requestedCorrection ?? "qualify") as "qualify", ...(body.findingIndex === undefined ? {} : { findingIndex: body.findingIndex as number }) },
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
    if (action === "skip_assessment") return k.skipAssessment(id, version, cap, body.selection === undefined ? undefined : kernelRecord(body.selection, ["coverageScope", "evidenceIds", "issueIds", "memory"]));
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
    const receipt = k.commitEffect(id, version, body.previewHash, body.authorityCommandId, cap);
    if (["patch_brief", "formal_direction_change"].includes(receipt.effectKind)) {
      try { return { ...receipt, briefPublication: k.publishBrief(cap) }; }
      catch { return { ...receipt, briefPublication: { status: "repair_required", canonicalResultSaved: true } }; }
    }
    return receipt;
  }
}
