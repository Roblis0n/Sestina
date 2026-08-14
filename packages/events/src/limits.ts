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
 * Order (load-bearing, docs/22 Step 3):
 *   1. the payload must be a JSON object (validation_failed),
 *   2. the byte size must be within the cap (limit_exceeded) — this runs
 *      before any host-specific parsing so oversized payloads are never
 *      deeply parsed,
 *   3. the bypass flag is read from the top-level permission_mode field
 *      (a shallow read, no parsing of the payload body).
 *
 * Throws SestinaError on 1 and 2 — normalized to a Result by the caller.
 */
export function enforceRawEventLimits(
  raw: unknown,
  rawBytes: Uint8Array | undefined,
  options?: RawEventLimitOptions,
): LimitedRawEvent {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new SestinaError(
      SestinaErrorCode.validation_failed,
      "raw hook event must be a JSON object",
      undefined,
      { received: typeof raw },
    );
  }
  const record = raw as Record<string, unknown>;
  const bytes = rawBytes ?? new TextEncoder().encode(JSON.stringify(record));
  const maxBytes = options?.maxBytes ?? RAW_EVENT_LIMITS.maxRawEventBytes;
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
