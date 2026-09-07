import {
  openResearchDeliberationKernel,
  KernelApplicationFault,
  type KernelApplicationOptions,
  type ResearchDeliberationKernel,
} from "@sestina/core";
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
  constructor(
    private readonly options: Omit<KernelApplicationOptions, "resolveUser">,
  ) {}
  get active() {
    return this.#kernel !== undefined;
  }
  close() {
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
    ]);
    if (body.projectId !== k.projectId)
      throw new KernelFault("relation_mismatch");
    const action = body.action;
    const fields: Record<string, readonly string[]> = {
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
      skip_assessment: ["reviewId", "expectedVersion"],
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
        "evidenceIds",
        "issueIds",
        "memory",
      ]);
      return k.prepareManifest(id, version, selection, body.useProvider, cap);
    }
    if (action === "skip_assessment") return k.skipAssessment(id, version, cap);
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
    return k.commitEffect(
      id,
      version,
      body.previewHash,
      body.authorityCommandId,
      cap,
    );
  }
}
