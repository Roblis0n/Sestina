import type { CoreResult } from "@sestina/core";
import { stringOption, type ParsedCliArguments } from "../arguments.js";
import { EXIT_CODES, type CliExitCode } from "../exit-codes.js";
import { commandExitCode, openLocalProject } from "../local-project.js";
import { failure, success, type CliIo } from "../output.js";
import { parseDecisionScope } from "../research-options.js";

function coreFailure<T>(result: Exclude<CoreResult<T>, { readonly ok: true }>, io: CliIo, json: boolean): CliExitCode {
  return failure(io, json, commandExitCode(result.error.code), result.error.code, "The Revision Episode command could not be completed.");
}

const WAIVABLE_DIMENSIONS = ["fulfillment", "evidence", "scope", "decisionIntegrity", "issueIntegrity"] as const;
function isWaivableDimension(value: string | undefined): value is typeof WAIVABLE_DIMENSIONS[number] { return value !== undefined && WAIVABLE_DIMENSIONS.some((item) => item === value); }

function view(episode: unknown): Readonly<Record<string, unknown>> {
  const value = episode as { readonly id: string; readonly status: string; readonly artifactId: string; readonly candidateRevisionId?: string; readonly reviewRunIds: readonly string[]; readonly findingIds: readonly string[]; readonly lockedStart: { readonly briefVersionId: string; readonly baselineRevisionId: string; readonly activeDecisions: readonly unknown[]; readonly relevantIssues: readonly unknown[]; readonly evidenceBoundaryIds: readonly string[]; readonly checkerVersion: string; readonly projectStateFingerprint: string; readonly repositoryStateFingerprint: string } };
  return { episodeId: value.id, status: value.status, artifactId: value.artifactId, baselineRevisionId: value.lockedStart.baselineRevisionId, candidateRevisionId: value.candidateRevisionId, lockedBriefVersionId: value.lockedStart.briefVersionId, decisions: value.lockedStart.activeDecisions, issues: value.lockedStart.relevantIssues, evidenceBoundaryIds: value.lockedStart.evidenceBoundaryIds, checkerVersion: value.lockedStart.checkerVersion, projectStateFingerprint: value.lockedStart.projectStateFingerprint, repositoryStateFingerprint: value.lockedStart.repositoryStateFingerprint, reviewRunIds: value.reviewRunIds, findingIds: value.findingIds };
}

export async function runEpisode(args: ParsedCliArguments, io: CliIo): Promise<CliExitCode> {
  const json = args.options.json === true; const subcommand = args.positionals[1];
  const opened = await openLocalProject(stringOption(args, "project"), io);
  if (!opened.ok) return failure(io, json, opened.exitCode, opened.errorCode, opened.message);
  const local = opened.value;
  try {
    if (subcommand === "start" && args.positionals.length === 2) {
      const artifactId = stringOption(args, "artifact"); const baselineRevisionId = stringOption(args, "baseline");
      if (artifactId === undefined || baselineRevisionId === undefined) return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "episode start requires --artifact and --baseline.");
      const brief = local.core.getBriefState(local.project.id); if (!brief.ok) return coreFailure(brief, io, json);
      if (brief.value === undefined) return failure(io, json, EXIT_CODES.stateConflict, "state_conflict", "Activate a Research Brief before starting an Episode.");
      const episode = local.core.startRevisionEpisode({ projectId: local.project.id, artifactId, briefVersionId: brief.value.version.id, baselineRevisionId, actor: { kind: "user", actorId: "cli-user" } });
      if (!episode.ok) return coreFailure(episode, io, json);
      const details = view(episode.value);
      success(io, json, { command: "episode start", ...details }, `Started Episode ${episode.value.id}; locked Brief ${episode.value.lockedStart.briefVersionId} and ${episode.value.lockedStart.activeDecisions.length} active Decision(s).`);
      return EXIT_CODES.success;
    }
    if (subcommand === "submit" && args.positionals.length === 3) {
      const episodeId = args.positionals[2] ?? ""; const candidateRevisionId = stringOption(args, "revision");
      if (candidateRevisionId === undefined) return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "episode submit requires --revision.");
      const submitted = local.core.submitCandidateRevision({ projectId: local.project.id, episodeId, candidateRevisionId, actor: { kind: "user", actorId: "cli-user" } });
      if (!submitted.ok) return coreFailure(submitted, io, json);
      success(io, json, { command: "episode submit", ...view(submitted.value) }, `Submitted Revision ${candidateRevisionId} to Episode ${episodeId}.`);
      return EXIT_CODES.success;
    }
    if (subcommand === "show" && args.positionals.length === 3) {
      const episodeId = args.positionals[2] ?? ""; const episode = local.core.getEpisode(local.project.id, episodeId);
      if (!episode.ok) return coreFailure(episode, io, json);
      if (episode.value === undefined) return failure(io, json, EXIT_CODES.stateConflict, "not_found", "The Revision Episode was not found in this project.");
      success(io, json, { command: "episode show", ...view(episode.value) }, JSON.stringify(view(episode.value), null, 2));
      return EXIT_CODES.success;
    }
    if (["accept", "reject"].includes(String(subcommand)) && args.positionals.length === 3) {
      const episodeId = args.positionals[2] ?? ""; const reason = stringOption(args, "reason");
      if (!reason) return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", `episode ${subcommand} requires --reason.`);
      if (args.options.yes !== true) return failure(io, json, EXIT_CODES.userConfirmationRequired, "user_confirmation_required", "Explicit --yes confirmation is required.");
      const integrity = local.core.getEpisodeIntegritySummary(local.project.id, episodeId); if (!integrity.ok) return coreFailure(integrity, io, json);
      const disposed = local.core.recordUserDisposition({ projectId: local.project.id, episodeId, disposition: subcommand === "accept" ? "accepted" : "rejected", reason, actor: { kind: "user", actorId: "cli-user" } });
      if (!disposed.ok) return coreFailure(disposed, io, json);
      const riskCount = integrity.value.unresolved.length + integrity.value.stale.length + integrity.value.disputed.length + integrity.value.unproven.length + integrity.value.checkerFailed.length;
      success(io, json, { command: `episode ${subcommand}`, episodeId, status: disposed.value.status, integrity: integrity.value, verified: false, semanticStatus: "unproven", riskAccepted: subcommand === "accept" && riskCount > 0 }, `Episode ${episodeId} is ${disposed.value.status}; integrity receipt remains unproven.`);
      return EXIT_CODES.success;
    }
    if (subcommand === "waive" && args.positionals.length === 3) {
      const episodeId = args.positionals[2] ?? ""; const reason = stringOption(args, "reason"); const scope = parseDecisionScope(stringOption(args, "scope")); const dimension = stringOption(args, "dimension"); const invalidationCondition = stringOption(args, "invalidation");
      if (!reason || !scope || !isWaivableDimension(dimension)) return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "episode waive requires --dimension, --scope, and --reason.");
      if (args.options.yes !== true) return failure(io, json, EXIT_CODES.userConfirmationRequired, "user_confirmation_required", "Explicit --yes confirmation is required.");
      const waived = local.core.applyEpisodeWaiver({ projectId: local.project.id, episodeId, actor: { kind: "user", actorId: "cli-user" }, dimension, scope, reason, ...(invalidationCondition ? { invalidationCondition } : {}) });
      if (!waived.ok) return coreFailure(waived, io, json);
      success(io, json, { command: "episode waive", episodeId, status: waived.value.status, userDisposition: waived.value.outcome?.userDisposition, dimension, scope, invalidationCondition, verified: false }, `Waived ${dimension} only for the explicit scope; Episode remains ${waived.value.status}.`);
      return EXIT_CODES.success;
    }
    return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "Use episode start, submit, show, accept, reject, or waive.");
  } finally {
    local.core.close();
  }
}
