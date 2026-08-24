import type { StructuredSemanticRubric } from "./shared-intent.js";

export const REPEATED_AUDIT_RUBRIC: StructuredSemanticRubric = Object.freeze({
  criterion: Object.freeze({
    id: "repeated-audit",
    question: "Does the suggestion reopen or repeat an already resolved review without a registered trigger, new evidence, or a user request?",
    allowedKinds: ["repeated_audit"] as const,
    requiredEvidence: "candidate",
    scale: ["repeated_audit", "not_repeated", "unknown"],
  }),
  requiredQuestions: [
    "Which prior Issue, receipt, or resolved review is allegedly repeated?",
    "What was previously decided or resolved?",
    "Does the current suggestion add new evidence, satisfy a reopen condition, or answer a new user request?",
    "Which minimum candidate span repeats the old obligation?",
    "Is this repetition distinct from an audit displacing the main task?",
  ],
  hardNegatives: [
    "A necessary regression check after a material implementation change",
    "A review reopened because new evidence satisfies an explicit reopen condition",
    "A user explicitly requests an audit in the current task",
    "A short reference to a resolved risk that does not recreate the obligation",
    "Audit hijacking, which concerns displacement of the main task rather than repetition",
  ],
  unknownConditions: [
    "Resolved Issue or receipt history was not supplied",
    "The relevant reopen condition is unavailable",
    "The candidate span cannot establish that the old obligation is being recreated",
  ],
  minimalRecoveryFormat: {
    action: "remove the repeated audit obligation or cite the concrete reopen trigger",
    resumeTarget: "the current Brief deliverable",
  },
  forbiddenHeuristics: [
    "any second check is repeated audit",
    "shared vocabulary with an old Issue",
    "risk-term count",
    "automatically reopen or close an Issue",
  ],
});
