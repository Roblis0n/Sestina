import { SestinaError, SestinaErrorCode } from "@sestina/schema";
import type { TaskContract } from "@sestina/schema";

// ── Contract summary (Task 9 §十) ──
//
// Renders a bounded, privacy-safe view of a TaskContract for host consumption.
// The rendered summary is the concatenation of the included strings with "\n"
// separators between them, in the fixed order 主目标 (objective.primary) ->
// 交付物 (deliverable descriptions, contract order) -> 边界 (boundary
// statements, contract order). Only whole items are ever included: nothing is
// split mid-character or mid-item, and the UTF-8 byte budget is counted with
// TextEncoder (never Buffer).
//
// Excluded by construction (the summary reads only the three sections above):
// the historical decision narrative (stop conditions, assumptions, correction
// bodies, revision history, titles, timestamps), sourceRefs excerpts (secrets
// and restricted excerpts are never copied), correctionRefs, and
// preauthorizations. Statements in ANY of the three included sections
// (objective, deliverables, boundaries) that contain absolute personal paths
// (Windows drive paths, POSIX /home|/Users|/root) are omitted entirely and
// counted in that section's omission counter - absolute personal paths never
// reach the host from any summarized field. Project-relative paths
// ("./outputs/", "data/") are kept.
//
// The contract is assumed schema-valid (it comes from the compiler); this
// function does not re-parse it and never mutates it. Deterministic for the
// same inputs.

export interface ContractSummary {
  /** 主目标 - "" when the objective was dropped (budget or personal path, see truncated). */
  objective: string;
  /** 交付物 descriptions, in contract order, whole items only. */
  deliverables: readonly string[];
  /** 边界 statements, in contract order, whole items only. */
  boundaries: readonly string[];
  omittedDeliverables: number;
  omittedBoundaries: number;
  /** true when anything was dropped for budget or excluded for privacy. */
  truncated: boolean;
  /** Exact UTF-8 byte length of the rendered summary; always <= maxUtf8Bytes. */
  utf8Bytes: number;
}

const encoder = new TextEncoder();

function utf8Length(text: string): number {
  return encoder.encode(text).length;
}

// Windows drive-letter absolute paths ("C:\...", "D:/...") and POSIX personal
// home directories ("/home", "/Users", "/root" - any casing). The directory
// name must end at a path separator or at a non-word boundary, so "/homebrew"
// or "home用户手册" do not trigger the check while "/home用户目录" (a
// non-ASCII character following the directory name) does. Statements
// containing such paths are dropped whole; the check deliberately errs toward
// omission (privacy-safe direction).
const ABSOLUTE_PERSONAL_PATH_PATTERN =
  /(?:^|[^\w])(?:[A-Za-z]:[\\/]|\/(?:home|users|root)(?=$|[^\w]|\/))/i;

function containsAbsolutePersonalPath(statement: string): boolean {
  return ABSOLUTE_PERSONAL_PATH_PATTERN.test(statement);
}

export function summarizeContract(contract: TaskContract, maxUtf8Bytes: number): ContractSummary {
  if (!Number.isFinite(maxUtf8Bytes) || maxUtf8Bytes < 0) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      `maxUtf8Bytes must be a finite non-negative number, got ${maxUtf8Bytes}`,
    );
  }

  const included: string[] = [];
  let usedBytes = 0;
  let truncated = false;

  // 1. 主目标 - the objective is one whole unit. A personal-path mention
  // inside it omits the objective entirely, exactly like the budget-exceeded
  // case below: ContractSummary has no objective-omission field, so this is
  // flagged via truncated: true with objective === "".
  let objective = "";
  if (
    !containsAbsolutePersonalPath(contract.objective.primary) &&
    utf8Length(contract.objective.primary) <= maxUtf8Bytes
  ) {
    objective = contract.objective.primary;
    included.push(objective);
    usedBytes = utf8Length(objective);
  } else {
    truncated = true;
  }

  // 2. 交付物 - descriptions in contract order, whole items only, with the
  // same personal-path exclusion as boundaries.
  let omittedDeliverables = 0;
  const deliverables: string[] = [];
  for (const deliverable of contract.deliverables) {
    if (containsAbsolutePersonalPath(deliverable.description)) {
      // Privacy exclusion: absolute personal paths never reach the summary.
      omittedDeliverables += 1;
      truncated = true;
      continue;
    }
    const itemBytes = utf8Length(deliverable.description);
    const separatorBytes = included.length > 0 ? 1 : 0;
    if (usedBytes + separatorBytes + itemBytes <= maxUtf8Bytes) {
      deliverables.push(deliverable.description);
      included.push(deliverable.description);
      usedBytes += separatorBytes + itemBytes;
    } else {
      omittedDeliverables += 1;
      truncated = true;
    }
  }

  // 3. 边界 - statements in contract order, whole items only.
  let omittedBoundaries = 0;
  const boundaries: string[] = [];
  for (const boundary of contract.boundaries) {
    if (containsAbsolutePersonalPath(boundary.statement)) {
      // Privacy exclusion: absolute personal paths never reach the summary.
      omittedBoundaries += 1;
      truncated = true;
      continue;
    }
    const itemBytes = utf8Length(boundary.statement);
    const separatorBytes = included.length > 0 ? 1 : 0;
    if (usedBytes + separatorBytes + itemBytes <= maxUtf8Bytes) {
      boundaries.push(boundary.statement);
      included.push(boundary.statement);
      usedBytes += separatorBytes + itemBytes;
    } else {
      omittedBoundaries += 1;
      truncated = true;
    }
  }

  const rendered = included.join("\n");
  const utf8Bytes = utf8Length(rendered);
  return {
    objective,
    deliverables,
    boundaries,
    omittedDeliverables,
    omittedBoundaries,
    truncated,
    utf8Bytes,
  };
}
