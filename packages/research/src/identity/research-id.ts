/**
 * Research ids: a known 5 character prefix plus a 26 character Crockford
 * base32 suffix (excludes I, L, O, U). Validation never truncates or
 * repairs input - malformed ids are rejected outright.
 */
import { researchError } from "../errors.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";

export type ResearchIdPrefix =
  | "rprj_"
  | "rart_"
  | "rrev_"
  | "repi_"
  | "rbrf_"
  | "rdec_"
  | "riss_"
  | "rclm_"
  | "revd_"
  | "rmec_"
  | "rdlt_"
  | "rrun_"
  | "rfnd_"
  | "rsnp_"
  | "rrvw_"
  | "rrcp_"
  | "rapl_"
  | "rsop_"
  | "rapr_"
  | "rapc_"
  | "rdlr_"
  | "rpar_"
  | "rrnd_"
  | "rdat_"
  | "rdch_"
  | "rman_"
  | "rdrr_"
  | "rdrc_"
  | "rmem_"
  | "rmcp_";

export const RESEARCH_ID_PREFIXES: readonly ResearchIdPrefix[] = [
  "rprj_",
  "rart_",
  "rrev_",
  "repi_",
  "rbrf_",
  "rdec_",
  "riss_",
  "rclm_",
  "revd_",
  "rmec_",
  "rdlt_",
  "rrun_",
  "rfnd_",
  "rsnp_",
  "rrvw_",
  "rrcp_",
  "rapl_",
  "rsop_",
  "rapr_",
  "rapc_",
  "rdlr_",
  "rpar_",
  "rrnd_",
  "rdat_",
  "rdch_",
  "rman_",
  "rdrr_",
  "rdrc_",
  "rmem_",
  "rmcp_",
];

const PREFIX_SET: ReadonlySet<string> = new Set(RESEARCH_ID_PREFIXES);
const PREFIX_LENGTH = 5;
const SUFFIX_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

declare const researchIdBrand: unique symbol;
/** Branded research id; only obtainable through successful parsing. */
export type ResearchId = string & { readonly [researchIdBrand]: true };

export interface ParsedResearchId {
  readonly prefix: ResearchIdPrefix;
  readonly suffix: string;
  readonly id: ResearchId;
}

function parse(
  value: unknown,
  expectedPrefix?: ResearchIdPrefix,
): ResearchResult<ParsedResearchId> {
  if (typeof value !== "string") {
    return err(researchError("invalid_research_id", { reason: "not_a_string" }));
  }
  if (value.length <= PREFIX_LENGTH) {
    return err(researchError("invalid_research_id", { reason: "too_short" }));
  }
  const prefix = value.slice(0, PREFIX_LENGTH);
  if (!PREFIX_SET.has(prefix)) {
    return err(researchError("invalid_research_id", { reason: "unknown_prefix" }));
  }
  if (expectedPrefix !== undefined && prefix !== expectedPrefix) {
    return err(
      researchError("invalid_research_id", {
        reason: "prefix_mismatch",
        expectedPrefix,
      }),
    );
  }
  const suffix = value.slice(PREFIX_LENGTH);
  if (!SUFFIX_RE.test(suffix)) {
    return err(researchError("invalid_research_id", { reason: "bad_suffix" }));
  }
  const typedPrefix = prefix as ResearchIdPrefix;
  return ok({ prefix: typedPrefix, suffix, id: value as ResearchId });
}

export function parseResearchId(value: unknown): ResearchResult<ParsedResearchId> {
  return parse(value);
}

export function parseResearchIdFor(
  value: unknown,
  prefix: ResearchIdPrefix,
): ResearchResult<ParsedResearchId> {
  return parse(value, prefix);
}

export function isResearchId(value: unknown): boolean {
  return parse(value).ok;
}

export function isResearchIdFor(
  value: unknown,
  prefix: ResearchIdPrefix,
): boolean {
  return parse(value, prefix).ok;
}
