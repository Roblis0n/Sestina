import {
  KernelFault,
  KERNEL_CANONICAL_CHANGES,
  KERNEL_TERMINAL_STATES,
  freezeKernel,
  kernelCanonicalJson,
  kernelHash,
  kernelId,
  kernelInteger,
  kernelSha,
  kernelText,
  kernelTime,
  parseKernelObjectRef,
  parseKernelReceipt,
  receiptHash,
  type KernelCanonicalCommand,
  type KernelCanonicalChange,
  type KernelObjectRef,
  type KernelReceipt,
  type KernelResult,
  type KernelUnitOfWork,
  type KernelUnitOfWorkOptions,
  type ResearchRepositories,
  type KernelAssessment,
} from "@sestina/research";
import {
  withTransaction,
  withReadSnapshot,
  type StorageDatabase,
} from "@sestina/storage";
import { createKernelRepositories } from "./repositories.js";
import {
  appendKernelEvent,
  changedKernelObjects,
  readCanonicalState,
  readKernelSnapshot,
  validateKernelChain,
} from "./state.js";

function result<T>(work: () => T): KernelResult<T> {
  try {
    return { ok: true, value: work() };
  } catch (e) {
    return {
      ok: false,
      error: {
        code: e instanceof KernelFault ? e.code : "storage_unavailable",
        changedObjects: e instanceof KernelFault ? e.changedObjects : [],
      },
    };
  }
}
const allowedChanges: Readonly<
  Record<KernelCanonicalChange, readonly string[]>
> = {
  record_only: [],
  record_only_outcome: [],
  create_decision: ["decision"],
  add_evidence: ["evidence", "claim_evidence_link", "mechanism_evidence_link"],
  create_or_resolve_issue: ["issue"],
  patch_brief: ["brief"],
  formal_direction_change: ["brief"],
  memory_governance_change: ["memory"],
  privacy_redaction: ["memory"],
  episode_change: ["episode", "snapshot"],
  compensation: [
    "brief",
    "decision",
    "issue",
    "evidence",
    "claim_evidence_link",
    "mechanism_evidence_link",
    "memory",
    "episode",
    "snapshot",
  ],
};
function identity(command: KernelCanonicalCommand): string {
  return kernelHash(
    Object.fromEntries(
      Object.entries(command).filter(
        ([key]) =>
          ![
            "receiptId",
            "eventId",
            "createdAt",
            "authorityCapability",
          ].includes(key),
      ),
    ),
  );
}
function validateCommand(c: KernelCanonicalCommand) {
  kernelId(c.projectId, "rprj_");
  kernelId(c.receiptId, "rrcp_");
  kernelId(c.eventId, "rpev_");
  kernelText(c.authorityCommandId, 160);
  kernelText(c.effectId, 160);
  kernelSha(c.previewHash);
  kernelInteger(c.expectedProjectStateRevision);
  kernelTime(c.createdAt);
  kernelText(c.publicReason);
  if (c.reviewId === null) {
    if (
      c.expectedReviewVersion !== null ||
      ![
        "memory_governance_change",
        "privacy_redaction",
        "episode_change",
      ].includes(c.effectKind)
    )
      throw new KernelFault("invalid_record");
  } else {
    kernelId(c.reviewId, "rrvw_");
    kernelInteger(c.expectedReviewVersion);
    if (!KERNEL_CANONICAL_CHANGES.slice(0, 7).includes(c.effectKind))
      throw new KernelFault("invalid_record");
  }
  if (
    !KERNEL_CANONICAL_CHANGES.includes(c.effectKind) ||
    !Array.isArray(c.objectVersions) ||
    c.objectVersions.length > 1000
  )
    throw new KernelFault("invalid_record");
  const objectVersions = c.objectVersions.map((ref: unknown) =>
    parseKernelObjectRef(ref),
  );
  if (
    new Set(objectVersions.map((r) => `${r.kind}:${r.id}`)).size !==
    c.objectVersions.length
  )
    throw new KernelFault("invalid_record");
  if (c.actor.kind !== "user") throw new KernelFault("authority_required");
  kernelText(c.actor.actorId, 128);
  if (c.compensatesReceiptId) kernelId(c.compensatesReceiptId, "rrcp_");
}
/** Extends the existing ResearchUnitOfWork and its connection, not a second store. */
export function createKernelUnitOfWork(
  db: StorageDatabase,
  canonicalRepositories: ResearchRepositories,
  options: KernelUnitOfWorkOptions = {},
): KernelUnitOfWork {
  const repos = createKernelRepositories(db);
  function lookup(
    projectId: string,
    commandId: string,
  ): KernelReceipt | undefined {
    kernelId(projectId, "rprj_");
    kernelText(commandId, 160);
    const row = db.get<{ receipt_id: string }>(
      "SELECT receipt_id FROM research_authority_commands WHERE project_id=? AND command_id=?",
      projectId,
      commandId,
    );
    if (!row) return undefined;
    const receipt = repos.receipts.getById(projectId, row.receipt_id);
    if (!receipt) throw new KernelFault("corrupt_state");
    const event = repos.events.getById(projectId, receipt.revisionEventId);
    const review = receipt.reviewId
      ? repos.reviews.getById(projectId, receipt.reviewId)
      : undefined;
    if (
      event?.revision !== receipt.afterProjectStateRevision ||
      event.reviewId !== receipt.reviewId ||
      (receipt.reviewId && review?.terminalOutcome?.receiptId !== receipt.id)
    )
      throw new KernelFault("corrupt_state");
    return receipt;
  }
  return Object.freeze({
    repositories: repos,
    workflow<T>(work: (repositories: typeof repos) => T): KernelResult<T> {
      return result(() =>
        withTransaction(db, () =>
          db.withKernelWrite("workflow", () => work(repos)),
        ),
      );
    },
    lookupCommand(projectId: string, commandId: string) {
      return result(() =>
        withReadSnapshot(db, () => {
          validateKernelChain(db, projectId);
          return lookup(projectId, commandId);
        }),
      );
    },
    commitCanonical(
      command: KernelCanonicalCommand,
      work: (repositories: ResearchRepositories) => unknown,
    ) {
      return result(() => {
        validateCommand(command);
        if (db.isTransaction) throw new KernelFault("illegal_transition");
        const receipt = withTransaction(db, () =>
          db.withKernelWrite("canonical", () => {
            const commandHash = identity(command);
            const prior = db.get<{ command_hash: string }>(
              "SELECT command_hash FROM research_authority_commands WHERE project_id=? AND command_id=?",
              command.projectId,
              command.authorityCommandId,
            );
            if (prior) {
              if (prior.command_hash !== commandHash)
                throw new KernelFault("idempotency_conflict");
              validateKernelChain(db, command.projectId);
              const found = lookup(
                command.projectId,
                command.authorityCommandId,
              );
              if (!found) throw new KernelFault("corrupt_state");
              return found;
            }
            if (
              !(command.reviewId === null
                ? options.authorizeGovernance?.(command)
                : options.authorize?.(command))
            )
              throw new KernelFault("authority_required");
            const before = readKernelSnapshot(db, command.projectId);
            if (before.head.revision !== command.expectedProjectStateRevision) {
              const changed = db
                .all<{ data: string }>(
                  "SELECT data FROM research_project_state_events WHERE project_id=? AND revision>? ORDER BY revision",
                  command.projectId,
                  command.expectedProjectStateRevision,
                )
                .flatMap(
                  (r) =>
                    (
                      JSON.parse(r.data) as {
                        changedObjectRefs: KernelObjectRef[];
                      }
                    ).changedObjectRefs,
                );
              throw new KernelFault("stale_revision", freezeKernel(changed));
            }
            const review = command.reviewId
              ? repos.reviews.getById(command.projectId, command.reviewId)
              : undefined;
            if (command.reviewId) {
              if (review?.version !== command.expectedReviewVersion)
                throw new KernelFault("stale_object");
              if (
                KERNEL_TERMINAL_STATES.includes(review.status) ||
                ![
                  "manifest_confirmed",
                  "assessment_recorded",
                  "provider_attempt_failed",
                  "provider_attempt_uncertain",
                ].includes(review.status)
              )
                throw new KernelFault("illegal_transition");
              const draft = review.effectDraft;
              if (
                draft?.effectId !== command.effectId ||
                draft.previewHash !== command.previewHash ||
                draft.baseProjectStateRevision !== before.head.revision ||
                kernelHash(draft.objectVersions) !==
                  kernelHash(command.objectVersions)
              )
                throw new KernelFault("stale_object");
              if (
                draft.effectKind !==
                (command.effectKind === "record_only_outcome"
                  ? "record_only"
                  : command.effectKind)
              )
                throw new KernelFault("invalid_record");
            }
            for (const ref of command.objectVersions) {
              const obj = before.state.objects.find(
                (o) => o.kind === ref.kind && o.id === ref.id,
              );
              if ((obj?.version ?? 0) !== ref.version)
                throw new KernelFault("stale_object", [ref]);
            }
            if (
              command.compensatesReceiptId &&
              !repos.receipts.getById(
                command.projectId,
                command.compensatesReceiptId,
              )
            )
              throw new KernelFault("relation_mismatch");
            const failedRepositories: string[] = [];
            const guarded = Object.fromEntries(
              Object.entries(canonicalRepositories).map(
                ([name, repository]) => [
                  name,
                  Object.fromEntries(
                    Object.entries(repository as Record<string, unknown>).map(
                      ([method, fn]) => [
                        method,
                        (...args: unknown[]) => {
                          const response: unknown = (
                            fn as (...a: unknown[]) => unknown
                          )(...args);
                          if (
                            response &&
                            typeof response === "object" &&
                            "ok" in response &&
                            response.ok === false
                          )
                            failedRepositories.push(method);
                          return response;
                        },
                      ],
                    ),
                  ),
                ],
              ),
            ) as unknown as ResearchRepositories;
            const returned = work(guarded);
            if (returned !== undefined || failedRepositories.length > 0)
              throw new KernelFault("invalid_record");
            options.faultInjection?.("object");
            const objectState = readCanonicalState(db, command.projectId);
            const changed = changedKernelObjects(before.state, objectState);
            if (
              changed.some(
                (ref) =>
                  !command.objectVersions.some(
                    (bound) => bound.kind === ref.kind && bound.id === ref.id,
                  ),
              )
            )
              throw new KernelFault("invalid_record");
            if (
              changed.some(
                (o) => !allowedChanges[command.effectKind].includes(o.kind),
              )
            )
              throw new KernelFault("invalid_record");
            if (
              !["record_only", "record_only_outcome"].includes(
                command.effectKind,
              ) &&
              changed.length === 0
            )
              throw new KernelFault("invalid_record");
            for (const ref of changed) {
              const old = before.state.objects.find(
                (o) => o.kind === ref.kind && o.id === ref.id,
              );
              if (ref.version !== (old?.version ?? 0) + 1)
                throw new KernelFault("stale_object", [ref]);
            }
            for (const other of db.all<{ project_id: string }>(
              "SELECT project_id FROM research_project_state_heads WHERE project_id<>?",
              command.projectId,
            ))
              validateKernelChain(db, other.project_id);
            const revision = before.head.revision + 1;
            for (const ref of changed.filter((r) => r.kind === "memory")) {
              const memory = objectState.objects.find(
                (o) => o.kind === "memory" && o.id === ref.id,
              );
              if (!memory) throw new KernelFault("corrupt_state");
              db.run(
                "INSERT INTO research_memory_metadata(project_id,item_id,last_confirmed_revision,version) VALUES(?,?,?,?) ON CONFLICT(project_id,item_id) DO UPDATE SET last_confirmed_revision=excluded.last_confirmed_revision,version=excluded.version",
                command.projectId,
                ref.id,
                memory.data.state === "active" ? revision : null,
                ref.version,
              );
              options.faultInjection?.("memory_metadata");
              if (memory.data.state === "forgotten") {
                db.run(
                  "INSERT INTO research_privacy_redactions(redaction_id,project_id,object_kind,object_id,source_revision,created_at,data) VALUES(?,?,'memory',?,?,?,?)",
                  `rapc_${kernelHash({ commandId: command.authorityCommandId, objectId: ref.id }).slice(0, 26).toUpperCase()}`,
                  command.projectId,
                  ref.id,
                  revision,
                  command.createdAt,
                  kernelCanonicalJson({
                    schemaVersion: "2.0.0",
                    kind: "user_forget_tombstone",
                    objectId: ref.id,
                    bodyAvailable: false,
                    backupCopyCoverage: "requires_inventory_review",
                  }),
                );
                options.faultInjection?.("privacy_redaction");
              }
            }
            const recordOnly = ["record_only", "record_only_outcome"].includes(
              command.effectKind,
            );
            if (review)
              repos.reviews.compareAndSwap(
                {
                  ...review,
                  status: recordOnly ? "disposed" : "committed",
                  terminalOutcome: {
                    receiptId: command.receiptId,
                    kind: command.effectKind,
                    resultingObjects: changed,
                  },
                  version: review.version + 1,
                  updatedAt: command.createdAt,
                },
                review.version,
              );
            options.faultInjection?.("review_terminal");
            const after = readCanonicalState(db, command.projectId);
            const canonicalHash = kernelHash(after);
            appendKernelEvent(db, {
              schemaVersion: "2.0.0",
              id: command.eventId,
              projectId: command.projectId,
              revision,
              transactionId: command.authorityCommandId,
              effectKind: command.effectKind,
              reviewId: command.reviewId,
              changedObjectRefs: changed,
              previousCanonicalHash: before.head.canonicalHash,
              nextCanonicalHash: canonicalHash,
              publicSummary: command.publicReason,
              createdAt: command.createdAt,
              compensatesReceiptId: command.compensatesReceiptId ?? null,
            });
            options.faultInjection?.("revision_event");
            const headUpdate = db.run(
              "UPDATE research_project_state_heads SET revision=?,canonical_hash=?,event_id=?,updated_at=? WHERE project_id=? AND revision=? AND canonical_hash=?",
              revision,
              canonicalHash,
              command.eventId,
              command.createdAt,
              command.projectId,
              before.head.revision,
              before.head.canonicalHash,
            );
            if (Number(headUpdate.changes) !== 1)
              throw new KernelFault("stale_revision");
            options.faultInjection?.("revision_head");
            const lastAttemptId = review?.attemptIds.at(-1);
            const attempt = lastAttemptId
              ? repos.attempts.getById(command.projectId, lastAttemptId)
              : undefined;
            const availability: KernelAssessment["availability"] =
              attempt?.assessment?.availability ??
              (attempt?.status === "failed"
                ? "failed"
                : attempt
                  ? "unavailable"
                  : "not_requested");
            const manifest = review?.manifestId
              ? repos.manifests.getById(command.projectId, review.manifestId)
              : undefined;
            if (review?.manifestId && !manifest)
              throw new KernelFault("relation_mismatch");
            const body: Omit<KernelReceipt, "receiptHash"> = {
              schemaVersion: "2.0.0",
              id: command.receiptId,
              projectId: command.projectId,
              reviewId: command.reviewId,
              authorityCommandId: command.authorityCommandId,
              effectId: command.effectId,
              effectKind: command.effectKind,
              previewHash: command.previewHash,
              actorId:
                command.actor.kind === "user" ? command.actor.actorId : "",
              publicReason: command.publicReason,
              beforeProjectStateRevision: before.head.revision,
              afterProjectStateRevision: revision,
              revisionEventId: command.eventId,
              resultingObjects: changed,
              assessmentAvailability: availability,
              manifestId: manifest?.id ?? null,
              manifestIdentityHash: manifest?.identityHash ?? null,
              assessmentAttemptId: attempt?.id ?? null,
              createdAt: command.createdAt,
            };
            const output = parseKernelReceipt({
              ...body,
              receiptHash: receiptHash(body),
            });
            db.run(
              "INSERT INTO research_transition_receipts(receipt_id,project_id,review_id,authority_command_id,event_id,before_revision,after_revision,effect_kind,receipt_hash,created_at,data) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
              output.id,
              output.projectId,
              output.reviewId,
              output.authorityCommandId,
              output.revisionEventId,
              output.beforeProjectStateRevision,
              output.afterProjectStateRevision,
              output.effectKind,
              output.receiptHash,
              output.createdAt,
              kernelCanonicalJson(output),
            );
            options.faultInjection?.("receipt");
            db.run(
              "INSERT INTO research_authority_commands(project_id,command_id,command_hash,receipt_id,created_at) VALUES(?,?,?,?,?)",
              command.projectId,
              command.authorityCommandId,
              commandHash,
              output.id,
              command.createdAt,
            );
            options.faultInjection?.("command_identity");
            db.run(
              "INSERT INTO research_projection_outbox(project_id,revision,event_id) VALUES(?,?,?)",
              command.projectId,
              revision,
              command.eventId,
            );
            options.faultInjection?.("projection_outbox");
            validateKernelChain(db, command.projectId);
            options.faultInjection?.("before_commit");
            return output;
          }),
        );
        try {
          options.faultInjection?.("after_commit");
        } catch {
          throw new KernelFault("commit_uncertain");
        }
        return receipt;
      });
    },
  });
}
