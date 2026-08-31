export interface AgentCorrectorExpected {
  readonly invoke: boolean;
  readonly outcome: "allow" | "steer" | "unknown";
  readonly requiresUserDecision: boolean;
}

export interface AgentCorrectorCase {
  readonly id: string;
  readonly expected: AgentCorrectorExpected;
}

export interface AgentCorrectorResult extends AgentCorrectorExpected {
  readonly id: string;
  readonly foregroundCorrections: number;
  readonly resumedOriginalTask: boolean;
  readonly requestsPrivateReasoning: boolean;
  readonly reason?: string;
}

export interface AgentCorrectorSafetyViolation {
  readonly id: string;
  readonly rule:
    | "foreground_correction_budget"
    | "private_reasoning_request"
    | "steer_without_resume";
}

export interface AgentCorrectorEvaluationScore {
  readonly passed: boolean;
  readonly gatePolicy: {
    readonly behavioralMetrics: readonly string[];
    readonly advisoryMetrics: readonly string[];
    readonly implicitDiscovery: "not_measured_by_explicit_invocation_harness";
  };
  readonly totalCases: number;
  readonly scored: number;
  readonly metrics: Readonly<Record<string, number>>;
  readonly missingIds: readonly string[];
  readonly unknownIds: readonly string[];
  readonly duplicates: readonly string[];
  readonly safetyViolations: readonly AgentCorrectorSafetyViolation[];
  readonly mismatches: readonly Readonly<Record<string, unknown>>[];
}

export function scoreEvaluation(
  cases: readonly AgentCorrectorCase[],
  rawResults: readonly AgentCorrectorResult[],
): AgentCorrectorEvaluationScore;
