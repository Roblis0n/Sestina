import type { StructuredSemanticRubric } from "./shared-intent.js";

export const ARGUMENT_LEAP_RUBRIC: StructuredSemanticRubric = Object.freeze({
  criterion: Object.freeze({
    id: "argument-leap",
    question: "Does the suggestion move from a supplied premise to a stronger conclusion without the required warrant, mechanism, evidence, or boundary?",
    allowedKinds: ["argument_leap"] as const,
    requiredEvidence: "candidate",
    scale: ["argument_leap", "warranted", "unknown"],
  }),
  requiredQuestions: [
    "What exact premise is supplied?",
    "What exact conclusion is asserted?",
    "Which warrant, mechanism, evidence link, or boundary is required between the premise and conclusion?",
    "Is that warrant present in a supplied span or explicitly missing?",
    "What is the minimum honest downgrade or missing relation?",
  ],
  hardNegatives: [
    "An explicitly labelled hypothesis or possible explanation",
    "A bounded association claim that does not assert causality",
    "A causal conclusion with a supplied mechanism and causal evidence link",
    "A user preference recorded as a decision rather than an external fact",
  ],
  unknownConditions: [
    "The premise or conclusion cannot be identified",
    "The applicable evidence or mechanism context was not supplied",
    "The wording is compatible with both a hypothesis and an asserted conclusion",
  ],
  minimalRecoveryFormat: {
    action: "add the missing warrant or downgrade the conclusion to the supported level",
    resumeTarget: "the current claim-evidence-mechanism relation",
  },
  forbiddenHeuristics: [
    "correlation automatically means causation",
    "strong verbs alone prove an argument leap",
    "absence of a citation automatically means false",
    "invent evidence, mechanisms, or user authority",
  ],
});
