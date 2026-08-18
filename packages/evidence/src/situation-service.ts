import {
  SestinaError,
  SestinaErrorCode,
  SituationAssertionSchema,
  canActAsDirectUser,
  validConfirmationSources,
  type ActorProvenance,
  type AssertionKind,
  type AssertionSourceRef,
  type ConfirmationSource,
  type MissingReason,
  type SituationAssertion,
} from "@sestina/schema";
import type {
  ConfirmationAuthority,
  CursorInput,
  EvidenceStore,
  HistoryWrite,
  Page,
  SituationStore,
} from "./ports.js";
import type { EvidencePorts } from "./ports.js";

// ── Situation Service (docs/22 Task 10, docs/09 §15) ──
// The six assertion kinds are never mixed: record() creates one of the five
// non-confirmed kinds, and only confirm() - with a legal ConfirmationSource -
// can ever produce confirmed_fact. A judge opinion is recordable but can
// never confirm, no matter its confidence.

export interface RecordSituationInput {
  projectId: string;
  taskId?: string;
  kind: Exclude<AssertionKind, "confirmed_fact">;
  statement: string;
  sourceRefs: AssertionSourceRef[];
  confidence?: number;
  limitations: string[];
  missingReason?: MissingReason;
  provenance: ActorProvenance;
}

const SYSTEM_ACTOR: ActorProvenance = { actor: "system", channel: "runtime", directUser: false };

function parseAssertion(value: unknown): SituationAssertion {
  const parsed = SituationAssertionSchema.safeParse(value);
  if (!parsed.success) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "SituationAssertion failed schema validation",
      undefined,
      { issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) },
    );
  }
  return parsed.data;
}

function historyEntry(
  ports: EvidencePorts,
  action: string,
  expectedVersion: number,
  actor: ActorProvenance,
  toStatus: string,
  reason?: string,
): HistoryWrite {
  return {
    historyId: ports.newId(),
    action,
    fromStatus: null,
    toStatus,
    expectedVersion,
    actorJson: JSON.stringify(actor),
    reason,
    atMs: ports.nowMs(),
  };
}

export class SituationService {
  readonly #store: SituationStore;
  readonly #evidence: EvidenceStore;
  readonly #confirmationAuthority: ConfirmationAuthority;
  readonly #ports: EvidencePorts;

  constructor(
    store: SituationStore,
    evidence: EvidenceStore,
    confirmationAuthority: ConfirmationAuthority,
    ports: EvidencePorts,
  ) {
    this.#store = store;
    this.#evidence = evidence;
    this.#confirmationAuthority = confirmationAuthority;
    this.#ports = ports;
  }

  /** Records a new assertion. Peers may record reported facts and inferences. */
  record(input: RecordSituationInput): SituationAssertion {
    const now = this.#ports.now();
    const assertion = parseAssertion({
      assertionId: this.#ports.newId(),
      projectId: input.projectId,
      taskId: input.taskId,
      kind: input.kind,
      statement: input.statement,
      sourceRefs: input.sourceRefs,
      confidence: input.confidence,
      limitations: input.limitations,
      missingReason: input.missingReason,
      status: "active",
      provenance: input.provenance,
      createdAt: now,
      version: 1,
      validFrom: now,
    });
    this.#store.insert(assertion);
    return assertion;
  }

  get(projectId: string, assertionId: string): SituationAssertion | undefined {
    return this.#store.get(projectId, assertionId);
  }

  listByTask(projectId: string, taskId: string, input: CursorInput): Page<SituationAssertion> {
    return this.#store.listByTask(projectId, taskId, input);
  }

  listByProject(projectId: string, input: CursorInput): Page<SituationAssertion> {
    return this.#store.listByProject(projectId, input);
  }

  /**
   * Confirms an assertion into a confirmed_fact. The confirmation source must
   * be one that is legally allowed to confirm: verified evidence, a trusted
   * tool result or hook observation, or a direct user. A judge opinion is
   * rejected with insufficient_confirmation_source - high confidence is
   * still an inference.
   */
  confirm(
    projectId: string,
    assertionId: string,
    expectedVersion: number,
    confirmation: ConfirmationSource,
    caller: ActorProvenance,
  ): SituationAssertion {
    const current = this.#require(projectId, assertionId);
    this.#assertVersion(current, expectedVersion);
    if (current.status !== "active") {
      throw new SestinaError(
        SestinaErrorCode.validation_failed,
        "only an active assertion can be confirmed",
      );
    }
    const resolved = this.#resolveConfirmation(current, confirmation, caller);
    if (!resolved || !validConfirmationSources([resolved])) {
      throw new SestinaError(
        SestinaErrorCode.insufficient_confirmation_source,
        "the confirmation source cannot confirm a fact (judge opinions and untrusted tool results never confirm)",
      );
    }
    const actor =
      resolved.sourceType === "direct_user" ? resolved.provenance : SYSTEM_ACTOR;
    return this.#store.confirm(
      projectId,
      assertionId,
      expectedVersion,
      resolved,
      caller,
      historyEntry(this.#ports, "confirm", expectedVersion, actor, "active"),
    );
  }

  /** Marks an assertion disputed (append-only: history keeps the old state). */
  dispute(
    projectId: string,
    assertionId: string,
    expectedVersion: number,
    provenance: ActorProvenance,
    reason: string,
  ): void {
    const current = this.#require(projectId, assertionId);
    this.#assertVersion(current, expectedVersion);
    if (current.status === "superseded" || current.status === "expired") {
      throw new SestinaError(
        SestinaErrorCode.validation_failed,
        "a superseded or expired assertion cannot be disputed",
      );
    }
    const next = parseAssertion({
      ...current,
      status: "disputed",
      version: expectedVersion + 1,
    });
    this.#store.transition(
      projectId,
      assertionId,
      expectedVersion,
      next,
      historyEntry(this.#ports, "dispute", expectedVersion, provenance, "disputed", reason),
    );
  }

  /** Marks an assertion expired. */
  expire(
    projectId: string,
    assertionId: string,
    expectedVersion: number,
    provenance: ActorProvenance,
  ): void {
    const current = this.#require(projectId, assertionId);
    this.#assertVersion(current, expectedVersion);
    if (current.status !== "active" && current.status !== "disputed") {
      throw new SestinaError(
        SestinaErrorCode.validation_failed,
        "only an active or disputed assertion can expire",
      );
    }
    const next = parseAssertion({
      ...current,
      status: "expired",
      validUntil: this.#ports.now(),
      version: expectedVersion + 1,
    });
    this.#store.transition(
      projectId,
      assertionId,
      expectedVersion,
      next,
      historyEntry(this.#ports, "expire", expectedVersion, provenance, "expired"),
    );
  }

  /**
   * Supersedes a target assertion with a new one (append-only chain). The
   * target must exist in the same project AND task, must be strictly older
   * than the new record, and must not already claim a superseder. Missing,
   * cross-project and cross-task targets all fail with the same stable
   * assertion_not_found error - no cross-project existence leak.
   */
  supersede(
    projectId: string,
    taskId: string,
    targetAssertionId: string,
    expectedVersion: number,
    input: Omit<RecordSituationInput, "projectId" | "taskId">,
  ): SituationAssertion {
    const target = this.#store.get(projectId, targetAssertionId);
    if (target?.taskId !== taskId) {
      throw new SestinaError(SestinaErrorCode.assertion_not_found, "Assertion not found");
    }
    this.#assertVersion(target, expectedVersion);
    if (target.supersededBy !== undefined) {
      throw new SestinaError(
        SestinaErrorCode.validation_failed,
        "the target assertion already claims a superseder",
      );
    }
    const now = this.#ports.now();
    if (!(Date.parse(target.createdAt) < Date.parse(now))) {
      throw new SestinaError(
        SestinaErrorCode.validation_failed,
        "the target assertion must be strictly older than the superseding record",
      );
    }
    const successor = this.record({ ...input, projectId, taskId });
    const next = parseAssertion({
      ...target,
      status: "superseded",
      supersededBy: successor.assertionId,
      version: expectedVersion + 1,
    });
    this.#store.transition(
      projectId,
      targetAssertionId,
      expectedVersion,
      next,
      historyEntry(
        this.#ports,
        "supersede",
        expectedVersion,
        input.provenance,
        "superseded",
        `superseded by ${successor.assertionId}`,
      ),
    );
    return successor;
  }

  /** Supersession chain: rows whose superseded_by points at this assertion. */
  listSuperseders(projectId: string, assertionId: string): SituationAssertion[] {
    return this.#store.listSuperseders(projectId, assertionId);
  }

  history(projectId: string, assertionId: string) {
    return this.#store.history(projectId, assertionId);
  }

  #require(projectId: string, assertionId: string): SituationAssertion {
    const current = this.#store.get(projectId, assertionId);
    if (!current) {
      throw new SestinaError(SestinaErrorCode.assertion_not_found, "Assertion not found");
    }
    return current;
  }

  #assertVersion(assertion: SituationAssertion, expectedVersion: number): void {
    if (assertion.version !== expectedVersion) {
      throw new SestinaError(
        SestinaErrorCode.stale_state,
        "Assertion was modified concurrently; reload and retry",
      );
    }
  }

  #resolveConfirmation(
    assertion: SituationAssertion,
    requested: ConfirmationSource,
    caller: ActorProvenance,
  ): ConfirmationSource | undefined {
    switch (requested.sourceType) {
      case "verified_evidence": {
        const evidence = this.#evidence.get(assertion.projectId, requested.evidenceId);
        if (
          evidence === undefined ||
          (assertion.taskId !== undefined && evidence.taskId !== assertion.taskId) ||
          evidence.status !== "verified" ||
          evidence.contentHash === undefined ||
          evidence.contentHash !== requested.contentHash ||
          (evidence.expiresAt !== undefined && Date.parse(evidence.expiresAt) <= this.#ports.nowMs())
        ) {
          return undefined;
        }
        return {
          sourceType: "verified_evidence",
          evidenceId: evidence.evidenceId,
          contentHash: evidence.contentHash,
        };
      }
      case "tool_result":
      case "hook_observation":
        return this.#confirmationAuthority.isTrustedObservation(
          assertion.projectId,
          assertion.taskId,
          requested.sourceType,
          requested.refId,
        )
          ? { sourceType: requested.sourceType, refId: requested.refId, trusted: true }
          : undefined;
      case "direct_user":
        return canActAsDirectUser(caller)
          ? { sourceType: "direct_user", provenance: caller }
          : undefined;
      case "judge_opinion":
        return undefined;
    }
  }
}
