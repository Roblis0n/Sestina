// ── Provenance surface (docs/22 Task 10) ──
// The plan names this module as the public provenance entry of the evidence
// package. The peer-demotion rules live in peer-provenance.ts; this module
// re-exposes them (plus the schema-level actor predicates they build on) so
// callers have one import site for every provenance concern: who recorded a
// fact, through which channel, and what that channel is allowed to do.

export {
  PEER_STATUS_CEILING,
  peerCeilingStatus,
  isPeer,
  peerReportSourceRefs,
  assertDirectUser,
} from "./peer-provenance.js";
