import type { CoreResult } from "@sestina/core";
import { numberOption, stringOption, type ParsedCliArguments } from "../arguments.js";
import { EXIT_CODES, type CliExitCode } from "../exit-codes.js";
import { commandExitCode, openLocalProject } from "../local-project.js";
import { failure, success, type CliIo } from "../output.js";
import { parseDecisionScope } from "../research-options.js";

const USER = { kind: "user" as const, actorId: "cli-user" };
function coreFailure<T>(result: Exclude<CoreResult<T>, { readonly ok: true }>, io: CliIo, json: boolean): CliExitCode { return failure(io, json, commandExitCode(result.error.code), result.error.code, "The Issue command could not be completed."); }
interface IssueProjectionInput { readonly id: string; readonly kind: string; readonly status: string; readonly target: unknown; readonly summary: string; readonly version: number; readonly resolution?: unknown; readonly reopenHistory: readonly unknown[]; }
function view(value: IssueProjectionInput): Readonly<Record<string, unknown>> { return { id: value.id, kind: value.kind, status: value.status, target: value.target, summary: value.summary, version: value.version, resolution: value.resolution, reopenHistory: value.reopenHistory }; }

export async function runIssue(args: ParsedCliArguments, io: CliIo): Promise<CliExitCode> {
  const json = args.options.json === true; const subcommand = args.positionals[1];
  const opened = await openLocalProject(stringOption(args, "project"), io);
  if (!opened.ok) return failure(io, json, opened.exitCode, opened.errorCode, opened.message);
  const local = opened.value;
  try {
    if (subcommand === "list" && args.positionals.length === 2) {
      const listed = local.core.listIssues(local.project.id); if (!listed.ok) return coreFailure(listed, io, json);
      const issues = listed.value.map(view); success(io, json, { command: "issue list", issues }, issues.length === 0 ? "No Issues." : JSON.stringify(issues, null, 2)); return EXIT_CODES.success;
    }
    const issueId = args.positionals[2] ?? "";
    if (subcommand === "show" && args.positionals.length === 3) {
      const shown = local.core.getIssue(local.project.id, issueId); if (!shown.ok) return coreFailure(shown, io, json);
      if (!shown.value) return failure(io, json, EXIT_CODES.stateConflict, "not_found", "The Issue was not found.");
      success(io, json, { command: "issue show", issue: view(shown.value), ...view(shown.value) }, JSON.stringify(view(shown.value), null, 2)); return EXIT_CODES.success;
    }
    if (["resolve", "waive", "dispute", "reopen"].includes(String(subcommand)) && args.positionals.length === 3) {
      const reason = stringOption(args, "reason"); const expectedVersion = numberOption(args, "expected-version");
      if (!reason || expectedVersion === "invalid") return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", `issue ${subcommand} requires --reason.`);
      if (args.options.yes !== true) return failure(io, json, EXIT_CODES.userConfirmationRequired, "user_confirmation_required", "Explicit --yes confirmation is required.");
      const common = { projectId: local.project.id, issueId, actor: USER, reason, ...(expectedVersion === undefined ? {} : { expectedVersion }) };
      const changed = subcommand === "resolve"
        ? (() => { const resolutionEvidenceId = stringOption(args, "evidence-id"); return resolutionEvidenceId ? local.core.resolveIssue({ ...common, resolutionEvidenceId }) : undefined; })()
        : subcommand === "waive"
          ? (() => { const scopeText = stringOption(args, "scope"); const scope = parseDecisionScope(scopeText); const invalidationCondition = stringOption(args, "invalidation"); return scope ? local.core.waiveIssue({ ...common, scope, ...(invalidationCondition ? { invalidationCondition } : {}) }) : undefined; })()
          : subcommand === "dispute"
            ? local.core.disputeIssue(common)
            : local.core.reopenIssue({ ...common, context: { userRequested: true } });
      if (changed === undefined) return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", subcommand === "resolve" ? "issue resolve requires --evidence-id." : "issue waive requires an explicit --scope.");
      if (!changed.ok) return coreFailure(changed, io, json);
      success(io, json, { command: `issue ${subcommand}`, issueId, status: changed.value.status, version: changed.value.version, ...(subcommand === "waive" ? { scope: stringOption(args, "scope"), invalidationCondition: stringOption(args, "invalidation") } : {}), ...(subcommand === "reopen" ? { reopenAuthority: "user_requested" } : {}) }, `Issue ${issueId} is ${changed.value.status}.`); return EXIT_CODES.success;
    }
    return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "Use issue list, show, resolve, waive, dispute, or reopen.");
  } finally { local.core.close(); }
}
