export { scanLegacyDatabase } from "./scan-legacy.js";
export { createLegacyImportPlan } from "./import-plan.js";
export { executeLegacyImport } from "./execute-import.js";
export { mapLegacyProject } from "./map-project.js";
export { mapLegacyContract } from "./map-contract.js";
export { mapLegacyCorrection } from "./map-correction.js";
export { mapLegacyEvidenceCandidate, mapLegacyCompletionCandidate } from "./map-evidence.js";
export type {
  DeferredLegacyCandidate,
  LegacyCandidateKind,
  LegacyImportError,
  LegacyImportExecutionResult,
  LegacyImportPlan,
  LegacyImportSelection,
  LegacyImportVerificationReport,
  LegacyScanItem,
  LegacyScanResult,
  UnrecognizedLegacyData,
} from "./types.js";
