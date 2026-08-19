import type { CoreResult, EditBriefCommand, ProposeBriefChangeCommand } from "@sestina/core";
import { numberOption, stringOption, type ParsedCliArguments } from "../arguments.js";
import { EXIT_CODES, type CliExitCode } from "../exit-codes.js";
import { commandExitCode, openLocalProject, type LocalProjectResult, type OpenedLocalProject } from "../local-project.js";
import { failure, success, type CliIo } from "../output.js";
import { readProjectTextFile, writeBriefProjection } from "../project-file.js";
import { parseProjectionYaml, type YamlRecord } from "../yaml.js";

const FIELD_NAMES = ["projectQuestion", "currentStage", "currentTask", "targetArtifacts", "fixedDecisions", "allowedChanges", "forbiddenChanges", "expectedDeltas", "evidenceBoundaries", "explicitNonGoals"] as const;
const STAGES = new Set(["question_formulation", "literature_review", "data_collection", "analysis", "writing", "revision", "review_response"]);
type BriefChangeSet = ProposeBriefChangeCommand["changes"];

function openedOrFailure(result: LocalProjectResult, io: CliIo, json: boolean): OpenedLocalProject | CliExitCode {
  return result.ok ? result.value : failure(io, json, result.exitCode, result.errorCode, result.message);
}

function coreFailure<T>(result: Exclude<CoreResult<T>, { readonly ok: true }>, io: CliIo, json: boolean): CliExitCode {
  return failure(io, json, commandExitCode(result.error.code), result.error.code, "The Research Brief command could not be completed.");
}

function editable(record: YamlRecord, projectId: string, expectedVersion: number | undefined): EditBriefCommand | undefined {
  if (record.projectId !== undefined && record.projectId !== projectId) return undefined;
  if (typeof record.projectQuestion !== "string" || typeof record.currentStage !== "string" || !STAGES.has(record.currentStage) || typeof record.currentTask !== "string") return undefined;
  if (!Array.isArray(record.targetArtifacts) || !Array.isArray(record.fixedDecisions) || !Array.isArray(record.allowedChanges) || !Array.isArray(record.forbiddenChanges) || !Array.isArray(record.expectedDeltas) || !Array.isArray(record.evidenceBoundaries) || !Array.isArray(record.explicitNonGoals)) return undefined;
  return {
    projectId,
    actor: { kind: "user", actorId: "cli-user" },
    projectQuestion: record.projectQuestion,
    currentStage: record.currentStage as EditBriefCommand["currentStage"],
    currentTask: record.currentTask,
    targetArtifacts: record.targetArtifacts as readonly string[],
    fixedDecisions: record.fixedDecisions as EditBriefCommand["fixedDecisions"],
    allowedChanges: record.allowedChanges as EditBriefCommand["allowedChanges"],
    forbiddenChanges: record.forbiddenChanges as EditBriefCommand["forbiddenChanges"],
    expectedDeltas: record.expectedDeltas as EditBriefCommand["expectedDeltas"],
    evidenceBoundaries: record.evidenceBoundaries as EditBriefCommand["evidenceBoundaries"],
    explicitNonGoals: record.explicitNonGoals as readonly string[],
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
  };
}

function briefChanges(record: YamlRecord): { readonly changes: BriefChangeSet; readonly reason: string } | undefined {
  const changes: Record<string, unknown> = {};
  for (const field of FIELD_NAMES) if (record[field] !== undefined) changes[field] = record[field];
  if (Object.keys(changes).length === 0) return undefined;
  const reason = typeof record.reason === "string" && record.reason.trim().length > 0 ? record.reason.trim() : "Proposed Research Brief change";
  return { changes, reason };
}

function changedFields(current: unknown, input: EditBriefCommand): readonly string[] {
  if (typeof current !== "object" || current === null || !("version" in current)) return FIELD_NAMES;
  const version = (current as { readonly version: Readonly<Record<string, unknown>> }).version;
  return FIELD_NAMES.filter((field) => JSON.stringify(version[field]) !== JSON.stringify(input[field]));
}

async function syncProjection(local: OpenedLocalProject): Promise<boolean> {
  const projection = local.core.getActiveBriefProjection(local.project.id);
  return projection.ok && projection.value !== undefined && await writeBriefProjection(local.briefPath, projection.value.yaml);
}

export async function runBrief(args: ParsedCliArguments, io: CliIo): Promise<CliExitCode> {
  const json = args.options.json === true; const subcommand = args.positionals[1];
  const localResult = await openLocalProject(stringOption(args, "project"), io);
  const local = openedOrFailure(localResult, io, json);
  if (typeof local === "number") return local;
  try {
    if (subcommand === "show" && args.positionals.length === 2) {
      const state = local.core.getBriefState(local.project.id);
      if (!state.ok) return coreFailure(state, io, json);
      if (state.value === undefined) {
        const draft = await readProjectTextFile(local.root, ".sestina/research-brief.yaml");
        if (draft === undefined) return failure(io, json, EXIT_CODES.infrastructureFailure, "infrastructure_failure", "The Research Brief draft is unavailable.");
        success(io, json, { command: "brief show", status: "draft", yaml: draft.content }, draft.content.trimEnd());
      } else {
        success(io, json, { command: "brief show", status: "active", briefId: state.value.brief.id, versionId: state.value.version.id, version: state.value.version.versionNumber, recordVersion: state.value.brief.version, currentTask: state.value.version.currentTask, yaml: state.value.yaml }, state.value.yaml.trimEnd());
      }
      return EXIT_CODES.success;
    }
    if (subcommand === "edit" && args.positionals.length === 2) {
      const from = stringOption(args, "from"); const expectedVersion = numberOption(args, "expected-version");
      if (from === undefined || expectedVersion === "invalid") return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "brief edit requires a valid --from file and expected version.");
      const file = await readProjectTextFile(local.root, from); const document = file === undefined ? undefined : parseProjectionYaml(file.content);
      const input = document === undefined ? undefined : editable(document, local.project.id, expectedVersion);
      if (input === undefined) return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "The Research Brief YAML is invalid or belongs to another project.");
      const current = local.core.getBriefState(local.project.id); if (!current.ok) return coreFailure(current, io, json);
      const diff = changedFields(current.value, input);
      if (args.options.yes !== true) {
        success(io, json, { command: "brief edit preview", changedFields: diff }, `Brief fields to change: ${diff.join(", ") || "none"}`);
        return failure(io, json, EXIT_CODES.userConfirmationRequired, "user_confirmation_required", "Pass --yes to activate the edited Research Brief.");
      }
      const edited = local.core.editBrief(input); if (!edited.ok) return coreFailure(edited, io, json);
      if (!(await syncProjection(local))) return failure(io, json, EXIT_CODES.infrastructureFailure, "infrastructure_failure", "The authoritative Brief projection could not be written.");
      success(io, json, { command: "brief edit", status: "active", briefId: edited.value.brief.id, versionId: edited.value.version.id, version: edited.value.version.versionNumber, recordVersion: edited.value.brief.version, changedFields: diff }, `Activated Research Brief v${edited.value.version.versionNumber}.`);
      return EXIT_CODES.success;
    }
    if (subcommand === "propose-change" && args.positionals.length === 2) {
      const path = stringOption(args, "file"); const expectedVersion = numberOption(args, "expected-version");
      if (path === undefined || expectedVersion === "invalid") return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "brief propose-change requires --file.");
      const file = await readProjectTextFile(local.root, path); const document = file === undefined ? undefined : parseProjectionYaml(file.content);
      const parsed = document === undefined ? undefined : briefChanges(document);
      if (parsed === undefined) return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "The Brief change file is invalid.");
      const proposed = local.core.proposeBriefChange({ projectId: local.project.id, actor: { kind: "user", actorId: "cli-user" }, changes: parsed.changes, reason: parsed.reason, ...(expectedVersion === undefined ? {} : { expectedVersion }) });
      if (!proposed.ok) return coreFailure(proposed, io, json);
      success(io, json, { command: "brief propose-change", proposalId: proposed.value.proposal.id, status: proposed.value.proposal.status, changedFields: proposed.value.proposal.diffFields, recordVersion: proposed.value.brief.version }, `Recorded pending Brief change ${proposed.value.proposal.id}.`);
      return EXIT_CODES.success;
    }
    if (subcommand === "accept-change" && args.positionals.length === 3) {
      if (args.options.yes !== true) return failure(io, json, EXIT_CODES.userConfirmationRequired, "user_confirmation_required", "Pass --yes to accept this Brief scope change.");
      const expectedVersion = numberOption(args, "expected-version");
      if (expectedVersion === "invalid") return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "The expected version is invalid.");
      const accepted = local.core.acceptBriefChange({ projectId: local.project.id, proposalId: args.positionals[2] ?? "", actor: { kind: "user", actorId: "cli-user" }, ...(expectedVersion === undefined ? {} : { expectedVersion }) });
      if (!accepted.ok) return coreFailure(accepted, io, json);
      if (!(await syncProjection(local))) return failure(io, json, EXIT_CODES.infrastructureFailure, "infrastructure_failure", "The authoritative Brief projection could not be written.");
      success(io, json, { command: "brief accept-change", status: "confirmed", versionId: accepted.value.version.id, version: accepted.value.version.versionNumber, recordVersion: accepted.value.brief.version, changedFields: accepted.value.changedFields }, `Accepted Brief change as v${accepted.value.version.versionNumber}.`);
      return EXIT_CODES.success;
    }
    return failure(io, json, EXIT_CODES.invalidInput, "invalid_input", "Use brief show, edit, propose-change, or accept-change.");
  } finally {
    local.core.close();
  }
}
