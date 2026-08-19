import type { CoreResult } from "@sestina/core";
import { numberOption, stringOption, type ParsedCliArguments } from "../arguments.js";
import { EXIT_CODES, type CliExitCode } from "../exit-codes.js";
import { commandExitCode, openLocalProject } from "../local-project.js";
import { failure, success, type CliIo } from "../output.js";
import { parseDecisionScope } from "../research-options.js";

const USER = { kind: "user" as const, actorId: "cli-user" };
function coreFailure<T>(result: Exclude<CoreResult<T>, { readonly ok: true }>, io: CliIo, json: boolean): CliExitCode { return failure(io, json, commandExitCode(result.error.code), result.error.code, "The Decision command could not be completed."); }
interface DecisionProjectionInput { readonly id: string; readonly status: string; readonly statement: string; readonly scope: unknown; readonly rationale: string; readonly reopenConditions: readonly string[]; readonly version: number; readonly supersedesDecisionId?: string; readonly supersededByDecisionId?: string; }
function view(value: DecisionProjectionInput): Readonly<Record<string, unknown>> { return { id: value.id, status: value.status, statement: value.statement, scope: value.scope, rationale: value.rationale, reopenConditions: value.reopenConditions, version: value.version, supersedesDecisionId: value.supersedesDecisionId, supersededByDecisionId: value.supersededByDecisionId }; }

export async function runDecision(args: ParsedCliArguments, io: CliIo): Promise<CliExitCode> {
  const json = args.options.json === true; const subcommand = args.positionals[1];
  const opened = await openLocalProject(stringOption(args, "project"), io);
  if (!opened.ok) return failure(io, json, opened.exitCode, opened.errorCode, opened.message);
  const local = opened.value;
  try {
    if (subcommand === "list" && args.positionals.length === 2) {
      const listed = local.core.listDecisions(local.project.id); if (!listed.ok) return coreFailure(listed, io, json);
      const decisions = listed.value.map(view); success(io, json, { command: "decision list", decisions }, decisions.length === 0 ? "No Decisions." : JSON.stringify(decisions, null, 2)); return EXIT_CODES.success;
    }
    if (subcommand === "add" && args.positionals.length === 2) {
      const statement = stringOption(args, "statement"); const rationale = stringOption(args, "rationale"); const scope = parseDecisionScope(stringOption(args, "scope")); const reopenCondition = stringOption(args, "reopen-condition");
      const brief = local.core.getBriefState(local.project.id);
      if (!brief.ok) return coreFailure(brief, io, json);
      if (!statement || !rationale || !scope || !brief.value) return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "decision add requires --statement, --rationale, --scope, and an active Brief.");
      const created = local.core.recordDecision({ projectId: local.project.id, actor: USER, statement, rationale, scope, effectiveBriefVersionId: brief.value.version.id, reopenConditions: reopenCondition ? [reopenCondition] : [] });
      if (!created.ok) return coreFailure(created, io, json);
      success(io, json, { command: "decision add", decisionId: created.value.id, status: created.value.status, authority: created.value.source.authority, decision: view(created.value) }, `Created proposed Decision ${created.value.id}.`); return EXIT_CODES.success;
    }
    const decisionId = args.positionals[2] ?? "";
    if (["accept", "reject", "freeze"].includes(String(subcommand)) && args.positionals.length === 3) {
      const reason = stringOption(args, "reason"); const expectedVersion = numberOption(args, "expected-version");
      if (!reason || expectedVersion === "invalid") return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", `decision ${subcommand} requires --reason.`);
      if (args.options.yes !== true) return failure(io, json, EXIT_CODES.userConfirmationRequired, "user_confirmation_required", "Explicit --yes confirmation is required.");
      const transitioned = local.core.transitionDecision({ projectId: local.project.id, decisionId, actor: USER, target: subcommand === "accept" ? "accepted" : subcommand === "reject" ? "rejected" : "frozen", reason, ...(expectedVersion === undefined ? {} : { expectedVersion }) });
      if (!transitioned.ok) return coreFailure(transitioned, io, json);
      success(io, json, { command: `decision ${subcommand}`, decisionId, status: transitioned.value.status, version: transitioned.value.version }, `Decision ${decisionId} is ${transitioned.value.status}.`); return EXIT_CODES.success;
    }
    if (subcommand === "supersede" && args.positionals.length === 3) {
      const statement = stringOption(args, "statement"); const rationale = stringOption(args, "rationale"); const reason = stringOption(args, "reason"); const scope = parseDecisionScope(stringOption(args, "scope")); const expectedVersion = numberOption(args, "expected-version"); const reopenCondition = stringOption(args, "reopen-condition");
      const brief = local.core.getBriefState(local.project.id); if (!brief.ok) return coreFailure(brief, io, json);
      if (!statement || !rationale || !reason || !scope || !brief.value || expectedVersion === "invalid") return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "decision supersede requires replacement fields, --scope, and --reason.");
      if (args.options.yes !== true) return failure(io, json, EXIT_CODES.userConfirmationRequired, "user_confirmation_required", "Explicit --yes confirmation is required.");
      const changed = local.core.supersedeDecision({ projectId: local.project.id, decisionId, actor: USER, statement, rationale, reason, scope, effectiveBriefVersionId: brief.value.version.id, reopenConditions: reopenCondition ? [reopenCondition] : [], ...(expectedVersion === undefined ? {} : { expectedVersion }) });
      if (!changed.ok) return coreFailure(changed, io, json);
      success(io, json, { command: "decision supersede", oldDecisionId: changed.value.superseded.id, oldStatus: changed.value.superseded.status, newDecisionId: changed.value.replacement.id, newStatus: changed.value.replacement.status }, `Superseded ${changed.value.superseded.id} with ${changed.value.replacement.id}.`); return EXIT_CODES.success;
    }
    return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "Use decision add, list, accept, reject, freeze, or supersede.");
  } finally { local.core.close(); }
}
