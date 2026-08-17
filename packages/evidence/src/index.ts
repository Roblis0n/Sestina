// ── @sestina/evidence (docs/22 Task 10) ──
// Host-neutral facts, evidence, claims and completion ledger: pure domain
// services over injected ports. Depends only on @sestina/schema.

export type {
  CursorInput,
  Page,
  HistoryWrite,
  HistoryRead,
  SituationStore,
  EvidenceStore,
  ClaimStore,
  DeliverableStore,
  DecisionFactsRow,
  DecisionFactsSource,
  ReviewFactsRow,
  ReviewFactsSource,
  ToolFailureRow,
  ToolFailureSource,
  EvidencePorts,
} from "./ports.js";

export { SituationService, type RecordSituationInput } from "./situation-service.js";
export {
  EvidenceService,
  type RecordEvidenceInput,
  EXCERPT_MAX_BYTES,
  EXCERPT_MAX_CHARS,
  truncateUtf8Bytes,
  minimizeLocatorPath,
} from "./evidence-service.js";
export { ClaimService, type RecordClaimInput } from "./claim-service.js";
export {
  DeliverableLedgerService,
  type ContractDeliverableInput,
} from "./deliverables.js";
export {
  buildCompletionFacts,
  DEFAULT_FACTS_LIMITS,
  type CompletionFactsOptions,
  type CompletionFactsSources,
} from "./completion-facts.js";
export {
  PEER_STATUS_CEILING,
  peerCeilingStatus,
  isPeer,
  peerReportSourceRefs,
  assertDirectUser,
} from "./provenance.js";
