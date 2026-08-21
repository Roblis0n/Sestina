import { canonicalStringify } from "@sestina/research";
import { SESTINA_RELEASE_CONTRACT } from "@sestina/schema";
import { normalizeReportInput, type ReviewReportInput } from "../report-input.js";
import { reportErr, reportOk, type ReportResult } from "../result.js";

export const REVIEW_REPORT_SCHEMA_VERSION = SESTINA_RELEASE_CONTRACT.reportSchemaVersion;
export interface ReviewJsonReport { readonly schemaVersion: typeof REVIEW_REPORT_SCHEMA_VERSION; readonly report: ReviewReportInput; }

export function renderReviewJson(raw: ReviewReportInput): string {
  const value: ReviewJsonReport = { schemaVersion: REVIEW_REPORT_SCHEMA_VERSION, report: normalizeReportInput(raw) };
  const serialized = canonicalStringify(value); if (!serialized.ok) throw new Error("Invalid review report"); return serialized.value;
}

export function parseReviewJson(json: string): ReportResult<ReviewJsonReport> {
  let raw: unknown; try { raw = JSON.parse(json); } catch { return reportErr("invalid_report"); }
  if (typeof raw !== "object" || raw === null) return reportErr("invalid_report");
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== REVIEW_REPORT_SCHEMA_VERSION) return reportErr("unsupported_report_version");
  try { return reportOk({ schemaVersion: REVIEW_REPORT_SCHEMA_VERSION, report: normalizeReportInput(value.report as ReviewReportInput) }); }
  catch { return reportErr("invalid_report"); }
}
