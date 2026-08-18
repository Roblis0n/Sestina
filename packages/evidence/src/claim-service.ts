import {
  SestinaError,
  SestinaErrorCode,
  ClaimSchema,
  type ActorProvenance,
  type Claim,
  type ClaimEvidenceLink,
  type ClaimEvidenceRelation,
  type ClaimEvidenceStrength,
  type EvidenceItem,
} from "@sestina/schema";
import { isPeer, peerCeilingStatus } from "./peer-provenance.js";
import type { ClaimStore, CursorInput, DeliverableStore, EvidencePorts, EvidenceStore, HistoryWrite, Page } from "./ports.js";

// ── Claim Service (docs/22 Task 10, docs/09 §9/§15) ──
// A claim and its evidence must live in the same project AND task. Without
// valid (live, verified) evidence a claim is unverified. Correlational-only
// evidence can never push a causal claim above partially_supported.
// Contradictions project to `contradicted` but never overwrite a human
// assessment (not_applicable). Completion claims additionally require
// deliverable-verified evidence. Peer-recorded claims are reported facts and
// stay at the unverified ceiling.

export interface RecordClaimInput {
  taskId: string;
  text: string;
  type: Claim["type"];
  importance: Claim["importance"];
  confidence: number;
  limitations: string[];
  provenance: ActorProvenance;
  evidenceRefs: string[];
}

function parseClaim(value: unknown): Claim {
  const parsed = ClaimSchema.safeParse(value);
  if (!parsed.success) {
    throw new SestinaError(SestinaErrorCode.validation_failed, "Claim failed schema validation", undefined, {
      issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    });
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

export class ClaimService {
  readonly #claims: ClaimStore;
  readonly #evidence: EvidenceStore;
  readonly #deliverables: DeliverableStore;
  readonly #ports: EvidencePorts;

  constructor(
    claims: ClaimStore,
    evidence: EvidenceStore,
    deliverables: DeliverableStore,
    ports: EvidencePorts,
  ) {
    this.#claims = claims;
    this.#evidence = evidence;
    this.#deliverables = deliverables;
    this.#ports = ports;
  }

  /**
   * Records a claim. Every evidence ref must exist in the same project and
   * task; a claim with no valid evidence is recorded as unverified.
   */
  record(projectId: string, input: RecordClaimInput): Claim {
    this.#assertEvidenceInTask(projectId, input.taskId, input.evidenceRefs);
    const claim = parseClaim({
      claimId: this.#ports.newId(),
      taskId: input.taskId,
      text: input.text,
      type: input.type,
      importance: input.importance,
      confidence: input.confidence,
      evidenceRefs: input.evidenceRefs,
      status: "unverified",
      limitations: input.limitations,
      provenance: input.provenance,
      createdAt: this.#ports.now(),
      version: 1,
    });
    this.#claims.insert(projectId, claim);
    return claim;
  }

  get(projectId: string, claimId: string): Claim | undefined {
    return this.#claims.get(projectId, claimId);
  }

  listByTask(projectId: string, taskId: string, input: CursorInput): Page<Claim> {
    return this.#claims.listByTask(projectId, taskId, input);
  }

  /** Links evidence to a claim (same project + same task enforced downstream). */
  linkEvidence(
    projectId: string,
    input: {
      claimId: string;
      evidenceId: string;
      relation: ClaimEvidenceRelation;
      strength: ClaimEvidenceStrength;
      provenance: ActorProvenance;
    },
  ): void {
    const claim = this.#claims.get(projectId, input.claimId);
    if (!claim) {
      throw new SestinaError(SestinaErrorCode.claim_not_found, "Claim not found");
    }
    this.#assertEvidenceInTask(projectId, claim.taskId, [input.evidenceId]);
    const existing = this.#evidence
      .listClaimLinks(projectId, input.claimId)
      .find((link) => link.evidenceId === input.evidenceId);
    if (
      existing === undefined &&
      isPeer(input.provenance) &&
      (input.relation !== "context" || input.strength !== "reported")
    ) {
      throw new SestinaError(
        SestinaErrorCode.forbidden,
        "peer provenance can only create contextual reported evidence links",
      );
    }
    const link: ClaimEvidenceLink = {
      claimId: input.claimId,
      evidenceId: input.evidenceId,
      relation: input.relation,
      strength: input.strength,
      provenance: input.provenance,
      linkedAt: this.#ports.now(),
    };
    this.#evidence.linkClaimEvidence(projectId, link);
  }

  listEvidenceLinks(projectId: string, claimId: string): ClaimEvidenceLink[] {
    return this.#evidence.listClaimLinks(projectId, claimId);
  }

  /**
   * Recomputes the claim status from its evidence links (CAS + history).
   * Rules:
   * - not_applicable is a human assessment and is never overwritten;
   * - disputed/superseded/unavailable/expired evidence never verifies;
   * - a contradiction from live verified evidence projects to `contradicted`;
   * - peer-recorded claims are reported facts: the ceiling is `unverified`
   *   (a contradiction still projects);
   * - causal claims need causal-strength support to reach `supported`;
   *   correlational-only support caps them at `partially_supported`;
   * - completion claims reach `supported` only through evidence that a
   *   satisfied deliverable also references (deliverable-verified evidence);
   * - no live supporting evidence at all means `unverified`.
   */
  recomputeStatus(projectId: string, claimId: string, expectedVersion: number): Claim {
    const current = this.#claims.get(projectId, claimId);
    if (!current) {
      throw new SestinaError(SestinaErrorCode.claim_not_found, "Claim not found");
    }
    if (current.version !== expectedVersion) {
      throw new SestinaError(
        SestinaErrorCode.stale_state,
        "Claim was modified concurrently; reload and retry",
      );
    }
    if (current.status === "not_applicable") {
      return current;
    }
    const links = this.#evidence.listClaimLinks(projectId, claimId);
    const evidenceById = new Map(
      this.#evidence.listByIds(projectId, links.map((link) => link.evidenceId))
        .map((item) => [item.evidenceId, item]),
    );
    const nowMs = this.#ports.nowMs();
    const live = (item: EvidenceItem | undefined): item is EvidenceItem =>
      item?.status === "verified" &&
      (item.expiresAt === undefined || Date.parse(item.expiresAt) > nowMs);
    const supports = links.filter((link) => link.relation === "supports" && live(evidenceById.get(link.evidenceId)));
    const contradicts = links.filter(
      (link) => link.relation === "contradicts" && live(evidenceById.get(link.evidenceId)),
    );

    let nextStatus: Claim["status"];
    if (contradicts.length > 0) {
      nextStatus = "contradicted";
    } else if (supports.length === 0) {
      nextStatus = "unverified";
    } else if (isPeer(current.provenance)) {
      nextStatus = peerCeilingStatus();
    } else if (current.type === "causal") {
      const causalSupports = supports.filter((link) => link.strength === "causal");
      nextStatus = causalSupports.length > 0 ? "supported" : "partially_supported";
    } else if (current.type === "completion") {
      nextStatus = this.#hasDeliverableVerifiedEvidence(projectId, current.taskId, supports)
        ? "supported"
        : "partially_supported";
    } else {
      nextStatus = "supported";
    }

    const next = parseClaim({
      ...current,
      status: nextStatus,
      assessedAt: this.#ports.now(),
      version: expectedVersion + 1,
    });
    this.#claims.transition(
      projectId,
      claimId,
      expectedVersion,
      next,
      historyEntry(
        this.#ports,
        "recompute",
        expectedVersion,
        current.provenance,
        nextStatus,
        `evidence supports=${supports.length} contradicts=${contradicts.length}`,
      ),
    );
    return next;
  }

  history(projectId: string, claimId: string) {
    return this.#claims.history(projectId, claimId);
  }

  #hasDeliverableVerifiedEvidence(
    projectId: string,
    taskId: string,
    supports: ClaimEvidenceLink[],
  ): boolean {
    const satisfied = this.#deliverables
      .listByTask(projectId, taskId)
      .filter((entry) => entry.active && entry.required && entry.status === "satisfied");
    return supports.some((link) =>
      satisfied.some((entry) => entry.evidenceRefs.includes(link.evidenceId)),
    );
  }

  #assertEvidenceInTask(projectId: string, taskId: string, evidenceRefs: readonly string[]): void {
    if (evidenceRefs.length === 0) {
      return;
    }
    const found = this.#evidence.listByIds(projectId, evidenceRefs);
    const byId = new Map(found.map((item) => [item.evidenceId, item]));
    for (const ref of evidenceRefs) {
      const item = byId.get(ref);
      if (item?.taskId !== taskId) {
        throw new SestinaError(
          SestinaErrorCode.validation_failed,
          "claim evidence must exist in the same project and task",
        );
      }
    }
  }
}
