import type { CoreResult } from "@sestina/core";
import { stringOption, type ParsedCliArguments } from "../arguments.js";
import { EXIT_CODES, type CliExitCode } from "../exit-codes.js";
import { commandExitCode, openLocalProject } from "../local-project.js";
import { failure, success, type CliIo } from "../output.js";

function coreFailure<T>(result: Exclude<CoreResult<T>, { readonly ok: true }>, io: CliIo, json: boolean): CliExitCode { return failure(io, json, commandExitCode(result.error.code), result.error.code, "The Report command could not be completed."); }
export async function runReport(args: ParsedCliArguments, io: CliIo): Promise<CliExitCode> {
  const json = args.options.json === true; const format = args.positionals[1]; const runId = args.positionals[2] ?? "";
  const opened = await openLocalProject(stringOption(args, "project"), io); if (!opened.ok) return failure(io, json, opened.exitCode, opened.errorCode, opened.message);
  const local = opened.value;
  try {
    if ((format !== "markdown" && format !== "json") || args.positionals.length !== 3) return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "Use report markdown <run> or report json <run>.");
    const report = local.core.renderReviewReportForRun(local.project.id, runId, format); if (!report.ok) return coreFailure(report, io, json);
    if (json) success(io, true, { command: `report ${format}`, reviewRunId: runId, format, report: report.value }, ""); else io.stdout(report.value.endsWith("\n") ? report.value : `${report.value}\n`);
    return EXIT_CODES.success;
  } finally { local.core.close(); }
}
