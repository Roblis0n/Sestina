import {
  CompletionFactsSchema,
  MAX_COMPLETION_DECISIONS,
  MAX_COMPLETION_DELIVERABLES,
  MAX_COMPLETION_EVIDENCE_GAPS,
  MAX_COMPLETION_OPEN_CLAIMS,
  MAX_COMPLETION_TOOL_FAILURES,
  SestinaError,
  SestinaErrorCode,
  type Claim,
  type CompletionFacts,
} from "@sestina/schema";
import type {
  ClaimStore,
  DecisionFactsSource,
  DeliverableStore,
  EvidenceStore,
  ReviewFactsSource,
  TaskScopeSource,
  ToolFailureSource,
  CursorInput,
  Page,
} from "./ports.js";

// ── Completion facts (docs/22 Task 10) ──
// Facts only - no allow_stop, no policy: those belong to Task 11. Exactly
// five structured fields, project-scoped, bounded and stably ordered.

/** Compatibility-only options; authoritative completion facts ignore every field. */
export interface CompletionFactsOptions {
  /**
   * Retained only so older callers cannot turn a source-compatible upgrade
   * into a runtime failure; every field is intentionally ignored.
   */
  /** Look-back window for recentToolFailures, in epoch ms. */
  toolFailureWindowMs?: number;
  maxDeliverables?: number;
  maxOpenCriticalClaims?: number;
  maxUnresolvedDecisions?: number;
  maxToolFailures?: number;
  maxEvidenceGaps?: number;
  /** Claims whose importance surfaces in evidenceGaps. */
  gapImportance?: readonly Claim["importance"][];
}

export const DEFAULT_FACTS_LIMITS = {
  toolFailureWindowMs: 24 * 60 * 60 * 1000,
  maxDeliverables: MAX_COMPLETION_DELIVERABLES,
  maxOpenCriticalClaims: MAX_COMPLETION_OPEN_CLAIMS,
  maxUnresolvedDecisions: MAX_COMPLETION_DECISIONS,
  maxToolFailures: MAX_COMPLETION_TOOL_FAILURES,
  maxEvidenceGaps: MAX_COMPLETION_EVIDENCE_GAPS,
} as const;

/** Work stays bounded; reaching this fence with more rows fails closed. */
export const MAX_FACTS_SCAN_ROWS = MAX_COMPLETION_DELIVERABLES;
const FACTS_PAGE_SIZE = 100;

export interface CompletionFactsSources {
  tasks: TaskScopeSource;
  deliverables: DeliverableStore;
  claims: ClaimStore;
  evidence: EvidenceStore;
  decisions: DecisionFactsSource;
  reviews: ReviewFactsSource;
  toolFailures: ToolFailureSource;
}

/** Stable ordering key: the extracted time, ties left to V8's stable sort. */
function byTime<T>(timeOf: (item: T) => string | undefined): (a: T, b: T) => number {
  return (a, b) => {
    const ta = timeOf(a) ?? "";
    const tb = timeOf(b) ?? "";
    if (ta !== tb) {
      return ta < tb ? -1 : 1;
    }
    return 0;
  };
}

interface PagedTaskSource<T> {
  listByTask(projectId: string, taskId: string, input: CursorInput): Page<T>;
}

/**
 * Reads keyset pages until enough matching rows are found. If the hard scan
 * fence is reached while the source still has data, fail instead of silently
 * returning a false "nothing unresolved" result.
 */
function collectMatching<T>(
  source: PagedTaskSource<T>,
  projectId: string,
  taskId: string,
  maxResults: number,
  predicate: (row: T) => boolean,
  label: string,
): T[] {
  if (maxResults === 0) {
    return [];
  }
  const matches: T[] = [];
  let cursor: string | undefined;
  let scanned = 0;
  while (matches.length < maxResults) {
    const remainingScan = MAX_FACTS_SCAN_ROWS - scanned;
    if (remainingScan <= 0) {
      throw new SestinaError(
        SestinaErrorCode.limit_exceeded,
        `${label} exceeded the CompletionFacts scan bound`,
      );
    }
    const page = source.listByTask(projectId, taskId, {
      cursor,
      limit: Math.min(FACTS_PAGE_SIZE, remainingScan),
    });
    scanned += page.items.length;
    for (const row of page.items) {
      if (predicate(row)) {
        matches.push(row);
        if (matches.length === maxResults) {
          break;
        }
      }
    }
    if (matches.length === maxResults || page.nextCursor === undefined) {
      break;
    }
    if (page.nextCursor === cursor) {
      throw new SestinaError(
        SestinaErrorCode.internal_error,
        `${label} returned a non-advancing cursor`,
      );
    }
    cursor = page.nextCursor;
  }
  return matches;
}

/** Reads a complete authoritative projection or fails closed at the fence. */
function collectAll<T>(
  source: PagedTaskSource<T>,
  projectId: string,
  taskId: string,
  label: string,
): T[] {
  const rows: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const remaining = MAX_FACTS_SCAN_ROWS - rows.length;
    if (remaining <= 0) {
      throw new SestinaError(
        SestinaErrorCode.limit_exceeded,
        `${label} exceeded the CompletionFacts scan bound`,
      );
    }
    const page = source.listByTask(projectId, taskId, {
      cursor,
      limit: Math.min(FACTS_PAGE_SIZE, remaining),
    });
    rows.push(...page.items);
    if (page.nextCursor === undefined) {
      return rows;
    }
    if (rows.length >= MAX_FACTS_SCAN_ROWS) {
      throw new SestinaError(
        SestinaErrorCode.limit_exceeded,
        `${label} exceeded the CompletionFacts scan bound`,
      );
    }
    if (page.nextCursor === cursor) {
      throw new SestinaError(
        SestinaErrorCode.internal_error,
        `${label} returned a non-advancing cursor`,
      );
    }
    cursor = page.nextCursor;
  }
}

export function buildCompletionFacts(
  projectId: string,
  taskId: string,
  sources: CompletionFactsSources,
  nowMs: number,
  options: CompletionFactsOptions = {},
): CompletionFacts {
  // Backward-compatible payloads cannot influence authoritative policy facts.
  void options;
  const limits = DEFAULT_FACTS_LIMITS;
  const gapImportance: readonly Claim["importance"][] = ["critical", "material"];
  if (!sources.tasks.hasTask(projectId, taskId)) {
    throw new SestinaError(SestinaErrorCode.task_not_found, "Task not found in project");
  }

  // 1) requiredDeliverables: the complete current required contract
  // projection, plus a live revalidation of every satisfied evidence ref.
  const deliverableRows = collectAll(
    {
      listByTask: (rowProjectId, rowTaskId, input) =>
        sources.deliverables.listPageByTask(rowProjectId, rowTaskId, input),
    },
    projectId,
    taskId,
    "deliverables",
  );
  const requiredDeliverables = deliverableRows
    .filter((entry) => entry.active && entry.required)
    .map((entry) => {
      if (entry.status !== "satisfied") {
        return entry;
      }
      const uniqueRefs = [...new Set(entry.evidenceRefs)];
      const evidence = sources.evidence.listByIds(projectId, uniqueRefs);
      const byId = new Map(evidence.map((item) => [item.evidenceId, item]));
      const allLive =
        uniqueRefs.length > 0 &&
        uniqueRefs.length === entry.evidenceRefs.length &&
        uniqueRefs.every((ref) => {
          const item = byId.get(ref);
          return (
            item?.taskId === taskId &&
            item.status === "verified" &&
            (item.expiresAt === undefined || Date.parse(item.expiresAt) > nowMs)
          );
        });
      return allLive ? entry : { ...entry, status: "failed" as const, waiver: undefined };
    });

  // 2) openCriticalClaims: critical importance, not yet settled.
  const openCriticalClaims = sources.claims.listOpenCritical(
    projectId,
    taskId,
    limits.maxOpenCriticalClaims + 1,
  );
  if (openCriticalClaims.length > limits.maxOpenCriticalClaims) {
    throw new SestinaError(
      SestinaErrorCode.limit_exceeded,
      "open critical claims exceeded the CompletionFacts bound",
    );
  }

  // 3) unresolvedDecisions: decisions that need the user, plus open or
  //    in-review review items.
  const allReviewRows = collectAll(
    sources.reviews,
    projectId,
    taskId,
    "reviews",
  );
  const terminalDecisionRefs = new Set(
    allReviewRows
      .filter((row) =>
        row.decisionRef !== undefined &&
        (row.status === "resolved" || row.status === "dismissed" || row.status === "superseded"),
      )
      .flatMap((row) => row.decisionRef === undefined ? [] : [row.decisionRef]),
  );
  const decisionRows = collectMatching(
    sources.decisions,
    projectId,
    taskId,
    limits.maxUnresolvedDecisions,
    (row) => row.userDecisionNeeded && !terminalDecisionRefs.has(row.decisionId),
    "decisions",
  )
    .map((row) => ({
      decisionId: row.decisionId,
      reasonCode: row.reasonCode,
      summary: row.reason.slice(0, 1000) || row.reasonCode,
      neededSince: row.createdAt,
    }));
  const reviewRows = allReviewRows
    .filter((row) => row.status === "open" || row.status === "in_review")
    .slice(0, limits.maxUnresolvedDecisions)
    .map((row) => ({
      decisionId: row.reviewId,
      reasonCode: `review_${row.status}`,
      summary: row.title.slice(0, 1000),
      neededSince: row.openedAt,
    }));
  const unresolvedDecisions = [...decisionRows, ...reviewRows]
    .sort(byTime((row) => row.neededSince))
    .slice(0, limits.maxUnresolvedDecisions);

  // 4) recentToolFailures: bounded by window and count, newest first.
  const recentToolFailures = sources.toolFailures.listRecentToolFailures(
    projectId,
    taskId,
    nowMs - limits.toolFailureWindowMs,
    limits.maxToolFailures,
  ).slice(0, limits.maxToolFailures)
    .map((row) => ({
      eventId: row.eventId,
      toolName: row.toolName.slice(0, 200),
      error: row.error.slice(0, 2000),
      occurredAt: row.occurredAt,
    }))
    .sort((a, b) => (a.occurredAt === b.occurredAt ? 0 : a.occurredAt < b.occurredAt ? 1 : -1));

  // 5) evidenceGaps: critical/material claims without live verified support.
  const satisfiedEvidenceRefs = new Set(
    requiredDeliverables
      .filter((entry) => entry.status === "satisfied")
      .flatMap((entry) => entry.evidenceRefs),
  );
  const claimsWithGaps = collectMatching(
    sources.claims,
    projectId,
    taskId,
    limits.maxEvidenceGaps,
    (claim) => {
      if (!gapImportance.includes(claim.importance) || claim.status === "not_applicable") {
        return false;
      }
      const links = sources.evidence.listClaimLinks(projectId, claim.claimId);
      if (links.length === 0) {
        return true;
      }
      const evidence = sources.evidence.listByIds(projectId, links.map((link) => link.evidenceId));
      return !links.some((link) => {
        if (link.relation !== "supports") {
          return false;
        }
        if (claim.type === "causal" && link.strength !== "causal") {
          return false;
        }
        if (claim.type === "completion" && !satisfiedEvidenceRefs.has(link.evidenceId)) {
          return false;
        }
        const item = evidence.find((candidate) => candidate.evidenceId === link.evidenceId);
        return (
          item?.taskId === taskId &&
          item.status === "verified" &&
          (item.expiresAt === undefined || Date.parse(item.expiresAt) > nowMs)
        );
      });
    },
    "claims",
  );
  const evidenceGaps = claimsWithGaps
    .map((claim) => ({
      claimId: claim.claimId,
      claimImportance: claim.importance,
      missingEvidenceType: claim.type === "causal" ? "causal_evidence" : "verified_evidence",
    }));

  const parsed = CompletionFactsSchema.safeParse({
    requiredDeliverables,
    openCriticalClaims,
    unresolvedDecisions,
    recentToolFailures,
    evidenceGaps,
  });
  if (!parsed.success) {
    throw new Error(`CompletionFacts failed schema validation: ${parsed.error.message}`);
  }
  return parsed.data;
}
