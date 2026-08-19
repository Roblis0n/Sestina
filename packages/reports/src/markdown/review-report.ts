import { redactAbsolutePaths } from "../redaction/redact.js";
import { normalizeReportInput, type ReviewReportInput } from "../report-input.js";

function escapeMarkdown(value: string): string {
  return redactAbsolutePaths(value)
    .replaceAll("\r", " ").replaceAll("\n", "<br>")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll("`", "&#96;").replace(/([\\[\]()_*#|{}!+.-])/g, "\\$1");
}

function bullets(values: readonly string[], empty: string): string[] {
  return values.length === 0 ? [`- ${empty}`] : values.map((value) => `- ${escapeMarkdown(value)}`);
}

export interface ReviewMarkdownOptions { readonly allFindings?: boolean; }

export function renderReviewMarkdown(raw: ReviewReportInput, options: ReviewMarkdownOptions = {}): string {
  const input = normalizeReportInput(raw); const projection = input.findingProjection;
  if (projection === undefined) throw new Error("Invalid review report");
  const shown = options.allFindings === true ? projection.raw.map((item) => item.finding) : projection.foreground.map((item) => item.finding);
  const totalForeground = projection.foreground.length + projection.omissions.mergedOutsideForeground;
  const uncertain = input.coverage.filter((item) => ["unproven", "stale", "disputed", "checker_failed"].includes(item.status));
  const checkerLines = [...new Set(input.run.context.checkerSet.map((checker) => `${checker.id}@${checker.version} (${checker.kind})`))].sort();
  const lines = [
    `# ${escapeMarkdown(input.title)}`,
    "",
    "## Task and locked versions",
    `- Task: ${escapeMarkdown(input.taskSummary)}`,
    `- Project: ${input.run.projectId}`,
    `- Episode: ${input.run.episodeId}`,
    `- Brief version: ${input.run.context.briefVersion.id} v${input.run.context.briefVersion.versionNumber}`,
    `- Baseline / candidate: ${input.run.context.baselineRevision.id} / ${input.run.context.candidateRevision.id}`,
    "",
    "## Honest overall state",
    `- Review readiness: ${input.outcome.reviewReady ? "ready" : "not ready"}`,
    `- User disposition: ${input.outcome.userDisposition}`,
    `- Checker health: ${input.outcome.checkerHealth.status}`,
    "",
    "## Foreground findings",
    options.allFindings === true
      ? `- All ${shown.length} raw findings shown; the authoritative foreground projection remains ${projection.foreground.length}.`
      : `- ${shown.length} of ${totalForeground} merged foreground findings shown. Stable priority order; default intervention budget is three.`,
    ...shown.flatMap((finding) => [`- [${finding.severity}] ${escapeMarkdown(finding.rationale)} (${finding.id})`, `  - Recovery: ${escapeMarkdown(finding.minimumRecovery)}`]),
    "",
    "## Preserved content",
    ...bullets(projection.preserved.items, projection.preserved.explanation),
    "",
    "## Minimum recovery path",
    ...bullets(projection.metrics.returnToMainTaskActions, "No foreground recovery action"),
    "",
    "## Suppressed repeats",
    `- ${projection.suppressed.length} suppressed Finding(s) retained in the ReviewRun and excluded from the intervention budget.`,
    ...projection.suppressed.map((item) => `- ${item.findingId}: ${escapeMarkdown(item.finding.rationale)}`),
    "",
    "## Intervention metrics",
    `- Raw findings: ${projection.metrics.rawFindingCount}`,
    `- Merged findings: ${projection.metrics.mergedFindingCount}`,
    `- Foreground findings: ${projection.metrics.foregroundFindingCount}`,
    `- Suppressed findings: ${projection.metrics.suppressedFindingCount}`,
    `- Return-to-main-task actions: ${projection.metrics.returnToMainTaskActions.length}`,
    `- Unnecessary findings: ${projection.metrics.unnecessaryFindingCount}`,
    "",
    "## Unchecked or uncertain",
    ...bullets(uncertain.map((item) => `${item.obligationId}: ${item.status} — ${item.explanation}`), "No unproven, stale, disputed, or checker-failed obligation"),
    "",
    "## User actions",
    ...bullets(input.userActions, "No user action supplied"),
    "",
    "## Provenance",
    `- ReviewRun: ${input.run.id}`,
    `- Snapshot: ${input.run.snapshotId} / ${input.run.context.snapshot.hash}`,
    `- Input hash: ${input.run.inputHash}`,
    `- Build fingerprint: ${input.run.context.buildFingerprint}`,
    ...checkerLines.map((value) => `- Checker: ${escapeMarkdown(value)}`),
  ];
  return `${lines.join("\n")}\n`;
}

export type { ReviewReportInput } from "../report-input.js";
