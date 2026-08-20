import { z } from "zod";

export const READ_ONLY_TOOL_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

export const STRICT_EMPTY_INPUT_SCHEMA = z.object({}).strict();

export const CAPABILITY_POLICY = Object.freeze({
  tools: Object.freeze(["health", "get_research_context"] as const),
  resources: Object.freeze(["sestina://research/current-brief"] as const),
  prompts: Object.freeze([] as const),
  resourceTemplates: Object.freeze([] as const),
  write: false as const,
  network: false as const,
  daemon: false as const,
});

export const HEALTH_TOOL_POLICY = Object.freeze({
  name: CAPABILITY_POLICY.tools[0],
  title: "Sestina read-only health",
  description: "Return stable, path-free diagnostics for the explicit local Sestina project.",
});

export const RESEARCH_CONTEXT_TOOL_POLICY = Object.freeze({
  name: CAPABILITY_POLICY.tools[1],
  title: "Get current Sestina Research Brief",
  description: "Read the same bounded active Research Brief projection as sestina://research/current-brief.",
});

export const CURRENT_BRIEF_RESOURCE_POLICY = Object.freeze({
  name: "current-research-brief",
  uri: CAPABILITY_POLICY.resources[0],
  title: "Current Sestina Research Brief",
  description: "The bounded active Research Brief from the shared read-only Sestina Core.",
  mimeType: "application/json" as const,
});
