import { z } from "zod";

// ULID: 26 characters of Crockford base32 (excludes I, L, O, U)
const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export const ID_SCHEMA = z
  .string()
  .length(26)
  .regex(ULID_REGEX, "Must be a valid ULID (26 chars, Crockford base32)");

// Crockford base32 alphabet (excludes I, L, O, U)
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function crockfordChar(index: number): string {
  const char = CROCKFORD_ALPHABET[index];
  if (char === undefined) {
    throw new Error(`Invalid Crockford index: ${index}`);
  }
  return char;
}

export function generateId(): string {
  // Use crypto.randomUUID() as the randomness source, then convert
  // the UUID's 16 bytes (128 bits) into 26 Crockford base32 characters.
  const uuid = crypto.randomUUID().replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(uuid.substring(i * 2, i * 2 + 2), 16);
  }

  let result = "";
  let value = 0;
  let bits = 0;

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      result += crockfordChar((value >> bits) & 0x1f);
    }
  }

  // Handle remaining bits
  if (bits > 0) {
    result += crockfordChar((value << (5 - bits)) & 0x1f);
  }

  // Ensure exactly 26 characters
  return result.slice(0, 26).padEnd(26, "0");
}

export function isValidId(id: unknown): boolean {
  return ID_SCHEMA.safeParse(id).success;
}

// Branded ID types
export const ProjectIdSchema = ID_SCHEMA.brand("ProjectId");
export type ProjectId = z.infer<typeof ProjectIdSchema>;

export const TaskIdSchema = ID_SCHEMA.brand("TaskId");
export type TaskId = z.infer<typeof TaskIdSchema>;

export const SessionIdSchema = ID_SCHEMA.brand("SessionId");
export type SessionId = z.infer<typeof SessionIdSchema>;

export const ContractIdSchema = ID_SCHEMA.brand("ContractId");
export type ContractId = z.infer<typeof ContractIdSchema>;

export const ContractVersionIdSchema = ID_SCHEMA.brand("ContractVersionId");
export type ContractVersionId = z.infer<typeof ContractVersionIdSchema>;

export const EventIdSchema = ID_SCHEMA.brand("EventId");
export type EventId = z.infer<typeof EventIdSchema>;

export const DecisionIdSchema = ID_SCHEMA.brand("DecisionId");
export type DecisionId = z.infer<typeof DecisionIdSchema>;

export const ConversationIdSchema = ID_SCHEMA.brand("ConversationId");
export type ConversationId = z.infer<typeof ConversationIdSchema>;

export const ReviewIdSchema = ID_SCHEMA.brand("ReviewId");
export type ReviewId = z.infer<typeof ReviewIdSchema>;

export const TraceIdSchema = ID_SCHEMA.brand("TraceId");
export type TraceId = z.infer<typeof TraceIdSchema>;

// Idempotency key: hash of stable event fields
export const IdempotencyKeySchema = z.string().min(8).max(128);
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;
