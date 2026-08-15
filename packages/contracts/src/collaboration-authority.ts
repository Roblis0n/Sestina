import { canActAsDirectUser } from "@sestina/schema";
import type {
  ActorProvenance,
  CollaborationAuthorityResult,
  HandoffAuthorizationRequest,
  HandoffEndpointRef,
  HandoffPreauthorization,
  HandoffUserConfirmation,
} from "@sestina/schema";

// ── Handoff authority resolution (Task 9 §九, docs/42 §6.2/6.3) ──
//
// Resolves the authorization EVIDENCE for one handoff request and returns only
// the three-way discriminated union: authorized | needs_user_confirmation |
// no_authority. The final allow_queue|hold|refuse policy decision belongs to
// Task 11. Deterministic for the same request — request.now is the only clock
// and preauthorizations are examined in array order.
//
// Design choices (documented):
// - The request is NOT re-parsed with zod. Structurally invalid inputs are the
//   caller's bug, but the authority-critical provenance checks are re-derived
//   inside this function (canActAsDirectUser + actor === "user"), so forged
//   objects that bypass the schema refine can never authorize anything.
// - A grant without endpointId is a host-level grant covering every endpoint of
//   that host; a grant WITH endpointId pins the exact endpoint (a request that
//   does not carry the pinned endpointId cannot auto-authorize).
// - Path matching normalizes trailing slashes on both sides and accepts
//   requestedPath === grantedPath or requestedPath startsWith(grantedPath + "/");
//   grantedPath "." covers the whole project; a leading "./" is NOT normalized;
//   an empty or all-slash granted path covers nothing. A path containing a
//   ".." segment never matches as a request and covers nothing as a grant —
//   fail closed, with no normalization attempted.
// - Deadline comparison is lexical over ISO-8601 strings, exactly
//   request.now < grant.deadline; timestamps in this codebase are UTC "Z"
//   strings where lexical order equals chronological order.
// - userConfirmation is bound by schema to the held handoff it releases:
//   handoffRef/projectId/taskId/source/target must equal the request's and the
//   request's deliverables, paths and action categories must be covered by the
//   confirmed ones. A confirmation copied from a different handoff is ignored.
//   It still grants no permanence, no peer promotion, and no approval of the
//   target agent's later tool actions.
// - A preauthorization whose confirmedBy fails the direct-user recheck is
//   invisible evidence: it never matches and never classifies the outcome.
// - Budget presence never blocks a match — the request carries no usage
//   counters; the budget cap is enforced at policy time (Task 11).

function isDirectUserProvenance(provenance: ActorProvenance | undefined): boolean {
  // Defensive recheck on top of the schema refine: directUser on a peer channel
  // (host/mcp) must NEVER count as a user, and directUser requires actor "user".
  // Accepts undefined so malformed (cast) objects can never authorize either.
  if (provenance === undefined) return false;
  return canActAsDirectUser(provenance) && provenance.actor === "user";
}

function endpointMatches(requested: HandoffEndpointRef, granted: HandoffEndpointRef): boolean {
  if (requested.host !== granted.host) return false;
  if (granted.endpointId !== undefined && requested.endpointId !== granted.endpointId) {
    return false;
  }
  return true;
}

function stripTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && path.charCodeAt(end - 1) === 47 /* "/" */) {
    end -= 1;
  }
  return path.slice(0, end);
}

/**
 * A ".." path segment escapes the project root, so paths containing one are
 * never matched syntactically: a request containing ".." is never covered,
 * and a grant containing ".." covers nothing. Fail closed on both sides —
 * normalization that could differ from the host's own resolution is
 * deliberately not attempted.
 */
function hasParentTraversal(path: string): boolean {
  return path.split("/").some((segment) => segment === "..");
}

function pathCoveredByGrant(requestedPath: string, grantedPath: string): boolean {
  const requested = stripTrailingSlashes(requestedPath);
  const granted = stripTrailingSlashes(grantedPath);
  if (hasParentTraversal(requested) || hasParentTraversal(granted)) return false;
  if (granted === ".") return true; // whole project
  if (granted === "") return false; // empty or all-slash scope covers nothing
  if (requested === granted) return true;
  return requested.startsWith(granted + "/");
}

function sameIdentity(
  request: HandoffAuthorizationRequest,
  grant: HandoffPreauthorization,
): boolean {
  return (
    grant.projectId === request.projectId &&
    grant.taskId === request.taskId &&
    endpointMatches(request.source, grant.source) &&
    endpointMatches(request.target, grant.target)
  );
}

function confirmationMatchesRequest(
  request: HandoffAuthorizationRequest,
  confirmation: HandoffUserConfirmation,
): boolean {
  // Identity fields must equal the request's; scope fields must COVER it. The
  // confirmation acts as the pinned side, so a confirmation recorded with an
  // endpointId does not match a request that omits it.
  if (confirmation.handoffRef !== request.handoffRef) return false;
  if (confirmation.projectId !== request.projectId) return false;
  if (confirmation.taskId !== request.taskId) return false;
  if (!endpointMatches(request.source, confirmation.source)) return false;
  if (!endpointMatches(request.target, confirmation.target)) return false;
  for (const deliverableId of request.deliverableIds) {
    if (!confirmation.deliverableIds.includes(deliverableId)) return false;
  }
  for (const requestedPath of request.requestedPaths) {
    if (
      !confirmation.requestedPaths.some((confirmedPath) =>
        pathCoveredByGrant(requestedPath, confirmedPath),
      )
    ) {
      return false;
    }
  }
  for (const actionCategory of request.actionCategories) {
    if (!confirmation.actionCategories.includes(actionCategory)) return false;
  }
  return true;
}

function grantIsAlive(
  request: HandoffAuthorizationRequest,
  grant: HandoffPreauthorization,
): boolean {
  if (grant.status !== "active") return false;
  if (grant.supersededBy !== undefined) return false;
  if (grant.deadline !== undefined && !(request.now < grant.deadline)) return false;
  return true;
}

function grantIsPrecise(grant: HandoffPreauthorization): boolean {
  return (
    grant.deliverableIds.length > 0 &&
    grant.pathScope.length > 0 &&
    grant.actionCategories.length > 0
  );
}

function grantFullyMatches(
  request: HandoffAuthorizationRequest,
  grant: HandoffPreauthorization,
): boolean {
  if (!isDirectUserProvenance(grant.confirmedBy)) return false;
  if (!sameIdentity(request, grant)) return false;
  if (!grantIsAlive(request, grant)) return false;
  if (!grantIsPrecise(grant)) return false; // vague grants never auto-authorize
  if (grant.contractVersion !== request.currentContractVersion) return false;
  for (const deliverableId of request.deliverableIds) {
    if (!grant.deliverableIds.includes(deliverableId)) return false;
  }
  for (const requestedPath of request.requestedPaths) {
    if (!grant.pathScope.some((grantedPath) => pathCoveredByGrant(requestedPath, grantedPath))) {
      return false;
    }
  }
  for (const actionCategory of request.actionCategories) {
    if (!grant.actionCategories.includes(actionCategory)) return false;
  }
  return true;
}

const MAX_REASON_LENGTH = 500; // CollaborationAuthorityResultSchema reasons max

function capReason(reason: string): string {
  return reason.length <= MAX_REASON_LENGTH
    ? reason
    : reason.slice(0, MAX_REASON_LENGTH - 3) + "…";
}

function describeEndpoint(endpoint: HandoffEndpointRef): string {
  const endpointPart =
    endpoint.endpointId !== undefined ? ` endpoint "${endpoint.endpointId}"` : "";
  return `host "${endpoint.host}"${endpointPart}`;
}

/**
 * Reasons for a grant that matches the request identity and is alive but does
 * not fully authorize. Order: version drift, deliverable overreach, path
 * overreach, action overreach. A vague grant only produces the vague reason.
 */
function overreachReasons(
  request: HandoffAuthorizationRequest,
  grant: HandoffPreauthorization,
): string[] {
  const reasons: string[] = [];
  if (!grantIsPrecise(grant)) {
    const emptyFields: string[] = [];
    if (grant.deliverableIds.length === 0) emptyFields.push("deliverableIds");
    if (grant.pathScope.length === 0) emptyFields.push("pathScope");
    if (grant.actionCategories.length === 0) emptyFields.push("actionCategories");
    reasons.push(
      `preauthorization ${grant.preauthorizationId} is too vague to auto-authorize: ${emptyFields.join(", ")} must not be empty`,
    );
    return reasons;
  }
  if (grant.contractVersion !== request.currentContractVersion) {
    reasons.push(
      `preauthorization ${grant.preauthorizationId} contractVersion ${grant.contractVersion} does not match currentContractVersion ${request.currentContractVersion}`,
    );
  }
  const extraDeliverables = request.deliverableIds.filter(
    (deliverableId) => !grant.deliverableIds.includes(deliverableId),
  );
  if (extraDeliverables.length > 0) {
    reasons.push(
      `preauthorization ${grant.preauthorizationId} does not cover deliverable(s): ${extraDeliverables.join(", ")}`,
    );
  }
  const uncoveredPaths = request.requestedPaths.filter(
    (requestedPath) =>
      !grant.pathScope.some((grantedPath) => pathCoveredByGrant(requestedPath, grantedPath)),
  );
  if (uncoveredPaths.length > 0) {
    reasons.push(
      `preauthorization ${grant.preauthorizationId} does not cover path(s): ${uncoveredPaths.join(", ")}`,
    );
  }
  const extraActions = request.actionCategories.filter(
    (actionCategory) => !grant.actionCategories.includes(actionCategory),
  );
  if (extraActions.length > 0) {
    reasons.push(
      `preauthorization ${grant.preauthorizationId} does not cover action category/categories: ${extraActions.join(", ")}`,
    );
  }
  return reasons;
}

function deadReason(
  request: HandoffAuthorizationRequest,
  grant: HandoffPreauthorization,
): string {
  if (grant.status !== "active") {
    return `preauthorization ${grant.preauthorizationId} has status "${grant.status}" and cannot authorize`;
  }
  if (grant.supersededBy !== undefined) {
    return `preauthorization ${grant.preauthorizationId} was superseded by ${grant.supersededBy}`;
  }
  return `preauthorization ${grant.preauthorizationId} deadline ${grant.deadline} is not after the request time ${request.now}`;
}

export function resolveCollaborationAuthority(
  request: HandoffAuthorizationRequest,
): CollaborationAuthorityResult {
  // 1. The first preauthorization that matches ALL fields authorizes.
  for (const grant of request.preauthorizations) {
    if (grantFullyMatches(request, grant)) {
      return {
        decision: "authorized",
        by: "preauthorization",
        preauthorizationId: grant.preauthorizationId,
      };
    }
  }

  // 2. A direct-user confirmation bound to exactly this held handoff releases
  // it. A confirmation copied from a different handoff is ignored and falls
  // through to classification below — it authorizes nothing.
  const confirmation = request.userConfirmation;
  if (
    confirmation !== undefined &&
    isDirectUserProvenance(confirmation.confirmedBy) &&
    confirmationMatchesRequest(request, confirmation)
  ) {
    return { decision: "authorized", by: "user_confirmation" };
  }

  // 3. No authorization — classify the evidence.
  const overreachReasonsList: string[] = [];
  const deadReasons: string[] = [];

  for (const grant of request.preauthorizations) {
    if (!isDirectUserProvenance(grant.confirmedBy)) continue; // forged: never evidence
    if (!sameIdentity(request, grant)) continue; // other project/task/endpoint
    if (!grantIsAlive(request, grant)) {
      deadReasons.push(capReason(deadReason(request, grant)));
      continue;
    }
    for (const reason of overreachReasons(request, grant)) {
      overreachReasonsList.push(capReason(reason));
    }
  }

  // An alive grant for exactly this project/task/source/target that fails on
  // scope or version drift is the closest thing to authorization — surface it
  // for user confirmation. This takes precedence over dead grants.
  if (overreachReasonsList.length > 0) {
    return { decision: "needs_user_confirmation", reasons: overreachReasonsList };
  }
  if (deadReasons.length > 0) {
    return { decision: "no_authority", reasons: deadReasons };
  }
  return {
    decision: "no_authority",
    reasons: [
      `no preauthorization covers project ${request.projectId}, task ${request.taskId}, from ${describeEndpoint(request.source)} to ${describeEndpoint(request.target)}`,
    ],
  };
}
