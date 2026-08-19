import type { Finding } from "./finding.js";
import type { CheckerKind, ReviewContext } from "./review-context.js";

export interface CheckerResult { readonly findings: readonly Finding[]; }

export interface ResearchChecker {
  readonly id: string;
  readonly version: string;
  readonly kind: CheckerKind;
  supports(context: ReviewContext): boolean;
  run(context: ReviewContext): Promise<CheckerResult>;
}
