import { SestinaError, SestinaErrorCode } from "@sestina/schema";

/**
 * Fixed caps enforced by the normalizer BEFORE deep parsing.
 * The raw byte cap is the first gate (honest `limit_exceeded` failure, never
 * a crash); summary fields are capped so no payload content is ever retained.
 */
export const RAW_EVENT_LIMITS = {
  /** 2 MiB — hook events and stream lines are bounded; anything larger is a malformed feed. */
  maxRawEventBytes: 2 * 1024 * 1024,
  /** securitySummary is derived text (counts/status only), still hard-capped. */
  maxSecuritySummaryChars: 200,
  /** One event contributes at most this many resource refs. */
  maxResourceRefs: 32,
} as const;

/** A size-checked raw event, ready for host-specific normalization. */
export interface LimitedRawEvent {
  raw: Record<string, unknown>;
  /** The exact bytes the hash is computed over (caller-supplied or re-serialized). */
  bytes: Uint8Array;
  byteLength: number;
  /**
   * Decided BEFORE deep parsing: the host ran in bypassPermissions mode.
   * The normalizer records it; it never decides allow/block from it.
   */
  bypass: boolean;
}

export interface RawEventLimitOptions {
  /** Override the byte cap (tests, tight callers). */
  maxBytes?: number;
}

/**
 * Enforce the raw-size gate and extract the bypass flag.
 *
 * Single source of truth (docs/22 Step 3): the parsed content, the size gate
 * and the payload hash are all derived from the SAME bytes. `raw` and
 * `rawBytes` are therefore mutually exclusive inputs:
 *   - `rawBytes` alone: the wire bytes are canonical — they are size-gated
 *     BEFORE parsing, then decoded and parsed into the record.
 *   - `raw` alone: the record is re-serialized to obtain the bytes.
 * Passing both (they can disagree) or neither is validation_failed.
 *
 * Order (load-bearing, docs/22 Step 3):
 *   1. exactly one input source must be present (validation_failed),
 *   2. for rawBytes: the byte size must be within the cap (limit_exceeded)
 *      before any JSON parsing; the decoded content must be a single JSON
 *      object (validation_failed); for raw: the payload must be a JSON
 *      object, then the size gate runs,
 *   3. the bypass flag is read from the top-level permission_mode field
 *      (a shallow read, no parsing of the payload body).
 *
 * Throws SestinaError on failures — normalized to a Result by the caller.
 */
export function enforceRawEventLimits(
  raw: unknown,
  rawBytes: Uint8Array | undefined,
  options?: RawEventLimitOptions,
): LimitedRawEvent {
  if (raw === undefined && rawBytes === undefined) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "raw or rawBytes is required",
      undefined,
      { reason: "raw_event_input_required" },
    );
  }
  if (raw !== undefined && rawBytes !== undefined) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "raw and rawBytes are mutually exclusive: parsed content, size gate and hash must share one source of bytes",
      undefined,
      { reason: "raw_and_rawBytes_are_mutually_exclusive" },
    );
  }
  const maxBytes = options?.maxBytes ?? RAW_EVENT_LIMITS.maxRawEventBytes;
  if (rawBytes !== undefined) {
    if (rawBytes.byteLength > maxBytes) {
      throw new SestinaError(
        SestinaErrorCode.limit_exceeded,
        `raw event exceeds the ${maxBytes}-byte limit`,
        undefined,
        { actualBytes: rawBytes.byteLength, maxBytes },
      );
    }
    const record = parseRecordObject(rawBytes);
    const bypass = record.permission_mode === "bypassPermissions";
    return {
      raw: record,
      bytes: rawBytes,
      byteLength: rawBytes.byteLength,
      bypass,
    };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "raw hook event must be a JSON object",
      undefined,
      { received: typeof raw },
    );
  }
  const record = raw as Record<string, unknown>;
  const bytes = new TextEncoder().encode(JSON.stringify(record));
  if (bytes.byteLength > maxBytes) {
    throw new SestinaError(
      SestinaErrorCode.limit_exceeded,
      `raw event exceeds the ${maxBytes}-byte limit`,
      undefined,
      { actualBytes: bytes.byteLength, maxBytes },
    );
  }
  const bypass = record.permission_mode === "bypassPermissions";
  return { raw: record, bytes, byteLength: bytes.byteLength, bypass };
}

/** Decode wire bytes into a single JSON object — no content ever escapes into errors. */
function parseRecordObject(bytes: Uint8Array): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "rawBytes must contain valid JSON",
      undefined,
      { reason: "rawBytes_invalid_json" },
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "rawBytes must contain a single JSON object",
      undefined,
      { received: typeof parsed },
    );
  }
  return parsed as Record<string, unknown>;
}
