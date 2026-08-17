import {
  SestinaError,
  SestinaErrorCode,
  canActAsDirectUser,
  isPeerProvenance,
  type ActorProvenance,
  type AssertionSourceRef,
} from "@sestina/schema";

// ── Peer provenance demotion (docs/22 Task 10, docs/09 §15) ──
// Content that arrives through peer channels (hooks, MCP) is REPORTED, not
// verified: it can be recorded, but its assessment ceiling is `unverified`
// and it can never confirm a fact or waive a deliverable. Peer provenance is
// permanently distinct from user provenance - there is no promotion path.

export const PEER_STATUS_CEILING = "unverified" as const;

/** The assessment ceiling for peer-recorded content: always unverified. */
export function peerCeilingStatus(): "unverified" {
  return PEER_STATUS_CEILING;
}

/** True when the provenance arrives through a peer channel (hook/MCP). */
export function isPeer(provenance: ActorProvenance): boolean {
  return isPeerProvenance(provenance);
}

/**
 * Source refs for a peer report (reply / accepted / completed): the refs stay
 * structural - endpoint, message and thread ids - so the claim records WHERE
 * the report came from without ever promoting it above the reported ceiling.
 */
export function peerReportSourceRefs(input: {
  endpointId: string;
  messageId: string;
  threadId: string;
}): AssertionSourceRef[] {
  return [
    { refType: "host_event", refId: `endpoint:${input.endpointId}` },
    { refType: "host_event", refId: `message:${input.messageId}` },
    { refType: "host_event", refId: `thread:${input.threadId}` },
  ];
}

/** Assert that a provenance may act as a direct user (waivers and friends). */
export function assertDirectUser(provenance: ActorProvenance, action: string): void {
  if (!canActAsDirectUser(provenance)) {
    throw new SestinaError(
      SestinaErrorCode.forbidden,
      `only a direct user can ${action}; peers, agents, hooks and MCP callers never can`,
    );
  }
}
