import type { CoreResult, CoreReviewSummary, DeterministicReviewResult } from "@sestina/core";
import { stringOption, type ParsedCliArguments } from "../arguments.js";
import { EXIT_CODES, type CliExitCode } from "../exit-codes.js";
import { commandExitCode, openLocalProject } from "../local-project.js";
import { failure, success, type CliIo } from "../output.js";

function coreFailure<T>(result: Exclude<CoreResult<T>, { readonly ok: true }>, io: CliIo, json: boolean): CliExitCode { return failure(io, json, commandExitCode(result.error.code), result.error.code, "The Review command could not be completed."); }
type ReviewFinding = CoreReviewSummary["run"]["findings"][number];
function findingView(value: ReviewFinding, verbose: boolean): Readonly<Record<string, unknown>> { return { id: value.id, kind: value.kind, severity: value.severity, target: value.target, rationale: value.rationale, minimumRecovery: value.minimumRecovery, presentation: value.presentation, issueIds: value.issueIds, ...(verbose ? { baselineEvidence: value.baselineEvidence, candidateEvidence: value.candidateEvidence, checker: value.checker, confidence: value.confidence, provenance: value.provenance } : {}) }; }
function reviewView(summary: CoreReviewSummary | DeterministicReviewResult, verbose: boolean): Readonly<Record<string, unknown>> {
  const findings = summary.run.findings.slice(0, verbose ? undefined : 3).map((item) => findingView(item, verbose));
  return { reviewRunId: summary.run.id, episodeId: summary.episode.id, reviewMode: "deterministic_only", semanticStatus: "semantic_pending", reviewReady: summary.outcome.reviewReady, checkerHealth: summary.outcome.checkerHealth, findings, findingCount: summary.run.findings.length, ...(verbose ? { coverage: summary.coverage, obligations: summary.obligations, provenance: { inputHash: summary.run.inputHash, snapshotId: summary.run.snapshotId, context: summary.run.context } } : {}) };
}

export async function runReviewCommand(args: ParsedCliArguments, io: CliIo): Promise<CliExitCode> {
  const json = args.options.json === true; const verbose = args.options.verbose === true; const subcommand = args.positionals[1];
  const opened = await openLocalProject(stringOption(args, "project"), io);
  if (!opened.ok) return failure(io, json, opened.exitCode, opened.errorCode, opened.message);
  const local = opened.value;
  try {
    if (subcommand === "run" && args.positionals.length === 3) {
      if (args.options.deterministic !== true) return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "review run currently requires --deterministic.");
      const reviewed = await local.core.runDeterministicReview({ projectId: local.project.id, episodeId: args.positionals[2] ?? "" });
      if (!reviewed.ok) return coreFailure(reviewed, io, json);
      const result = reviewView(reviewed.value, verbose); const blocking = reviewed.value.run.checkerErrors.length > 0 || reviewed.value.run.findings.some((item) => ["error", "critical"].includes(item.severity) && item.presentation === "foreground");
      success(io, json, { command: "review run", ...result }, JSON.stringify(result, null, 2)); return blocking ? EXIT_CODES.reviewBlockingIssue : EXIT_CODES.success;
    }
    if (subcommand === "show" && args.positionals.length === 3) {
      const summary = local.core.getReviewSummary(local.project.id, args.positionals[2] ?? ""); if (!summary.ok) return coreFailure(summary, io, json);
      const result = reviewView(summary.value, verbose); success(io, json, { command: "review show", ...result }, JSON.stringify(result, null, 2)); return EXIT_CODES.success;
    }
    return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "Use review run <episode> --deterministic or review show <run>.");
  } finally { local.core.close(); }
}
