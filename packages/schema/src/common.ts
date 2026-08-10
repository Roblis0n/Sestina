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
  source: z.enum(["user", "agent", "hook", "import", "system"]),
  sessionId: z.string().optional(),
  verified: z.boolean(),
  challenge: z.string().optional(),
});
export type ActorProvenance = z.infer<typeof ActorProvenanceSchema>;

// ── Preview Confirmation ──
export const PreviewConfirmationSchema = z.object({
  previewHash: z.string(),
  confirmedBy: ActorProvenanceSchema,
  confirmedAt: z.string().datetime(),
});
export type PreviewConfirmation = z.infer<typeof PreviewConfirmationSchema>;

// ── Degradation State ──
export const DegradationStateSchema = z.object({
  level: z.enum(["full", "degraded", "emergency"]),
  missingCapabilities: z.array(z.string()),
  since: z.string().datetime(),
});
export type DegradationState = z.infer<typeof DegradationStateSchema>;

// ── Timestamp ──
export const TimestampSchema = z.string().datetime();
export type Timestamp = z.infer<typeof TimestampSchema>;

export function nowUTC(): string {
  return new Date().toISOString();
}
