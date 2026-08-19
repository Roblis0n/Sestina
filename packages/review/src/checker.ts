import type { Finding } from "./finding.js";
import type { CheckerKind, ReviewContext } from "./review-context.js";

export interface CheckerObservation { readonly code: string; readonly message: string; }
export interface CheckerResult { readonly findings: readonly Finding[]; readonly observations?: readonly CheckerObservation[]; }

export interface ResearchChecker {
  readonly id: string;
  readonly version: string;
  readonly kind: CheckerKind;
  supports(context: ReviewContext): boolean;
  run(context: ReviewContext): Promise<CheckerResult>;
}
