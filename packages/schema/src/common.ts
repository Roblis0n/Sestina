import { z } from "zod";

// ── Host ──
export const HOST_SCHEMA = z.enum([
  "codex",
  "claude_code",
  "desktop",
  "service",
  "cli",
  "test",
]);
export type Host = z.infer<typeof HOST_SCHEMA>;

// ── Host Visibility ──
export const HOST_VISIBILITY_LEVEL_SCHEMA = z.enum([
  "full_stream",
  "message_stream",
  "tool_lifecycle",
  "governance_events",
  "disconnected",
]);
export type HostVisibilityLevel = z.infer<
  typeof HOST_VISIBILITY_LEVEL_SCHEMA
>;

// ── Privacy ──
export const PRIVACY_CLASS_SCHEMA = z.enum([
  "public",
  "internal",
  "sensitive",
  "restricted",
]);
export type PrivacyClass = z.infer<typeof PRIVACY_CLASS_SCHEMA>;

// ── Actor Provenance ──
export const ActorProvenanceSchema = z.object({
  actor: z.enum(["user", "agent", "system", "hook", "cli"]),
  channel: z.enum(["desktop", "host", "mcp", "cli", "runtime"]),
  directUser: z.boolean(),
  challengeId: z.string().max(128).optional(),
}).refine(
  (data) => !data.directUser || data.actor === "user",
  { message: "directUser must imply actor === 'user'" },
).refine(
  (data) => {
    // Reject directUser on peer channels (mcp, host).
    // Control token only proves local install identity — it does NOT
    // grant direct-user provenance to Hooks, MCP agents, or peers.
    if (data.directUser && (data.channel === "mcp" || data.channel === "host")) {
      return false;
    }
    return true;
  },
  { message: "directUser is forbidden on peer channels (mcp, host). Control token proves local install identity only." },
);
export type ActorProvenance = z.infer<typeof ActorProvenanceSchema>;

// ── Permission boundary helpers ──

/** Channels that can carry direct-user provenance. */
export const DIRECT_USER_CHANNELS = ["desktop", "cli"] as const;

/** Peer channels — tokens on these channels never grant user-level access. */
export const PEER_CHANNELS = ["host", "mcp"] as const;

/**
 * Returns true only when the provenance represents a real human user
 * interacting directly through a trusted channel (desktop or CLI).
 * Peer channels (mcp, host) are permanently excluded regardless of
 * token possession.
 */
export function canActAsDirectUser(provenance: ActorProvenance): boolean {
  return (
    provenance.directUser &&
    DIRECT_USER_CHANNELS.includes(provenance.channel as typeof DIRECT_USER_CHANNELS[number])
  );
}

/**
 * Returns true when the provenance originates from a peer (Hook, MCP).
 * Peer provenance is permanently distinct from user provenance.
 */
export function isPeerProvenance(provenance: ActorProvenance): boolean {
  return PEER_CHANNELS.includes(provenance.channel as typeof PEER_CHANNELS[number]);
}

// ── Preview Confirmation ──
export const PreviewConfirmationSchema = z.object({
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedVersion: z.number().int().nonnegative(),
  provenance: ActorProvenanceSchema,
});
export type PreviewConfirmation = z.infer<typeof PreviewConfirmationSchema>;

// ── Degradation State ──
export const DegradationStateSchema = z.object({
  level: z.enum(["full", "degraded", "emergency"]),
  missingCapabilities: z.array(z.string()),
  since: z.iso.datetime(),
});
export type DegradationState = z.infer<typeof DegradationStateSchema>;

// ── Timestamp ──
export const TimestampSchema = z.iso.datetime();
export type Timestamp = z.infer<typeof TimestampSchema>;

export function nowUTC(): string {
  return new Date().toISOString();
}
