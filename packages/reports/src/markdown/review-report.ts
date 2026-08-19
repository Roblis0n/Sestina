import { compareFindingSeverity } from "@sestina/review";
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

export function renderReviewMarkdown(raw: ReviewReportInput): string {
  const input = normalizeReportInput(raw); const findings = input.run.findings;
  const foreground = findings.filter((finding) => finding.presentation === "foreground").sort(compareFindingSeverity);
  const shown = foreground.slice(0, 3); const suppressed = findings.filter((finding) => finding.presentation === "suppressed");
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
    `- ${shown.length} of ${foreground.length} foreground findings shown. Deterministic placeholder ordering: severity, then Finding ID.`,
    ...shown.flatMap((finding) => [`- [${finding.severity}] ${escapeMarkdown(finding.rationale)} (${finding.id})`, `  - Recovery: ${escapeMarkdown(finding.minimumRecovery)}`]),
    "",
    "## Preserved content",
    ...bullets(input.preservedContent, "No preserved-content statement was supplied"),
    "",
    "## Minimum recovery path",
    ...bullets(shown.map((finding) => finding.minimumRecovery), "No foreground recovery action"),
    "",
    "## Suppressed repeats",
    `- ${suppressed.length} suppressed Finding(s) retained in the ReviewRun.`,
    ...suppressed.map((finding) => `- ${finding.id}: ${escapeMarkdown(finding.rationale)}`),
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
