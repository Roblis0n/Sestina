// Task 9 public API — contract compilation, versioned patching, concurrent
// merge, correction memory, summarization, and collaboration authority
// evidence resolution. Production code depends only on @sestina/schema.

export {
  compileInitialContract,
  compileContractDetailed,
  type CompileContractInput,
  type CompilerPorts,
} from "./compiler.js";

export {
  runSemanticExtractor,
  DEFAULT_MAX_EXTRACTOR_INPUT_CHARS,
  DEFAULT_MAX_EXTRACTOR_OUTPUT_BYTES,
  type ContractSemanticExtractor,
} from "./extractor-port.js";

export {
  proposeContractPatch,
  applyContractPatch,
  type PatchProposalInput,
} from "./patch.js";

export { assertExpectedVersion, nextContractVersion } from "./versioning.js";

export {
  mergeConcurrentPatches,
  type MergeOutcome,
  type SupersededRelation,
} from "./merge.js";

export {
  assertNoConflicts,
  buildContractConflictId,
  type ContractConflict,
} from "./conflicts.js";

export {
  recordCorrection,
  fingerprintRecurrence,
  normalizeInstruction,
  type RecordCorrectionInput,
  type RecordCorrectionResult,
} from "./corrections.js";

export { summarizeContract, type ContractSummary } from "./summarize.js";

export { resolveCollaborationAuthority } from "./collaboration-authority.js";

export { RESEARCH_TEMPLATE } from "./templates/research.js";
export { STRATEGY_TEMPLATE } from "./templates/strategy.js";
export { SOFTWARE_TEMPLATE } from "./templates/software.js";
