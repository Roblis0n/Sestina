// ── Event normalization, action classification, correlation, dedupe ───────
//
// packages/events is the cross-host event layer (docs/22 Task 7): it turns
// raw Codex / Claude Code hook stdin and host-stream lines into schema-valid
// StandardEvents, classifies tool actions, correlates the two delivery paths,
// dedupes stream deltas, and normalizes collaboration envelopes.
//
// Invariants: the normalizer NEVER reads contracts, NEVER decides
// allow/block, NEVER calls a Provider. Only the hook path may create
// governance decisions. Payloads are never stored — content is
// counts/hasFlags only.

// Key schema types the consumers of this package operate on.
export type {
  ActionCategory,
  ActionDescriptor,
  ContentDescriptor,
  EventType,
  Host,
  HostVisibilityLevel,
  PrivacyClass,
  StandardEvent,
} from "@sestina/schema";

export * from "./normalize.js";
export * from "./limits.js";
export * from "./idempotency.js";
export * from "./action-classifier.js";
export * from "./resource-normalizer.js";
export * from "./correlation.js";
export * from "./host-stream-dedupe.js";
export * from "./collaboration-envelope.js";
