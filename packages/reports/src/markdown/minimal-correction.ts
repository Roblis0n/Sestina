import {
  parseMinimalCorrectionProjection,
  type MinimalCorrection,
  type MinimalCorrectionProjection,
} from "@sestina/review";

import { redactAbsolutePaths } from "../redaction/redact.js";

function escapeMarkdown(value: string): string {
  return redactAbsolutePaths(value)
    .replaceAll("\r", " ")
    .replaceAll("\n", "<br>")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("`", "&#96;")
    .replace(/([\\[\]()_*#|{}!+.-])/gu, "\\$1");
}

function correctionBullet(
  correction: MinimalCorrection,
  values: readonly string[],
): string {
  return `- ${escapeMarkdown(correction.id)}: ${values
    .map(escapeMarkdown)
    .join("; ")}`;
}

function readyMarkdown(
  projection: Extract<MinimalCorrectionProjection, { status: "ready" }>,
): string {
  const lines = [
    "# Minimal correction",
    "",
    "- Status: ready",
    `- Corrections: ${projection.corrections.length}`,
    `- Brief version: ${escapeMarkdown(projection.briefVersionId)}`,
    "",
    "## Preserve",
    ...projection.corrections.map((correction) => correctionBullet(
      correction,
      correction.preserve,
    )),
    "",
    "## Stop",
    ...projection.corrections.map((correction) => correctionBullet(
      correction,
      correction.stop,
    )),
    "",
    "## Minimum missing relation or action",
    ...projection.corrections.map((correction) => correctionBullet(
      correction,
      [correction.minimumMissingRelationOrAction],
    )),
    "",
    "## Must not change",
    ...projection.corrections.flatMap((correction) => [
      `- ${escapeMarkdown(correction.id)}: Brief ${escapeMarkdown(correction.mustNotChange.briefVersionId)}`,
      `  - Current research task: ${escapeMarkdown(correction.mustNotChange.currentResearchTask)}`,
      `  - Protected decisions: ${correction.mustNotChange.protectedDecisionIds.length === 0
        ? "none"
        : correction.mustNotChange.protectedDecisionIds.map(escapeMarkdown).join(", ")}`,
    ]),
    "",
    "## Recovery verification",
    ...projection.corrections.map((correction) => correctionBullet(
      correction,
      correction.recoveryVerification,
    )),
    "",
    "## Provenance",
    ...projection.corrections.flatMap((correction) => [
      `- Correction: ${escapeMarkdown(correction.id)}`,
      `  - Suggestion ownership: ${escapeMarkdown(correction.suggestionOwnership)}`,
      `  - Source Findings: ${correction.sources.rawFindingIds.map(escapeMarkdown).join(", ")}`,
      `  - Checker: ${escapeMarkdown(correction.sources.checker.id)}@${escapeMarkdown(correction.sources.checker.version)} (${escapeMarkdown(correction.sources.checker.kind)})`,
      `  - Severity: ${escapeMarkdown(correction.sources.severity)}`,
    ]),
  ];
  if (projection.omittedForegroundFindingIds.length > 0) {
    lines.push(
      "",
      `- Budget-omitted foreground Findings: ${projection.omittedForegroundFindingIds.map(escapeMarkdown).join(", ")}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function renderMinimalCorrectionMarkdown(
  raw: MinimalCorrectionProjection,
): string {
  const parsed = parseMinimalCorrectionProjection(raw);
  if (!parsed.ok) throw new Error("Invalid minimal correction");
  const projection = parsed.value;
  if (projection.status === "ready") return readyMarkdown(projection);
  if (projection.status === "not_needed") {
    return [
      "# Minimal correction",
      "",
      "- Status: not\\_needed",
      "- No foreground Finding requires correction\\.",
      `- Brief version: ${escapeMarkdown(projection.briefVersionId)}`,
      "",
    ].join("\n");
  }
  return [
    "# Minimal correction",
    "",
    "- Status: uncorrectable",
    `- Reason: ${escapeMarkdown(projection.reason)}`,
    `- Affected Findings: ${projection.affectedFindingIds.map(escapeMarkdown).join(", ")}`,
    "- No correction was guessed\\.",
    "",
  ].join("\n");
}
