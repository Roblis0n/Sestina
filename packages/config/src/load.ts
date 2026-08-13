import type { ConfigLayers, EffectiveConfig, ConfigSourceMap } from "@sestina/schema";
import { EffectiveConfigSchema } from "@sestina/schema";
import { BUILTIN_DEFAULTS, getDefaultSourceMap } from "./defaults.js";
import { mergeConfigs } from "./merge.js";

export interface LoadedConfig {
  value: EffectiveConfig;
  sources: ConfigSourceMap;
}

export function loadEffectiveConfig(
  layers: ConfigLayers,
): LoadedConfig {
  const sources = getDefaultSourceMap();
  const missingFields: string[] = [];

  // Start with builtin defaults
  let effective: Record<string, unknown> = structuredClone(BUILTIN_DEFAULTS);

  // Merge layers in priority order (lowest first): env -> user -> project -> contract -> request
  const layerOrder = [
    { key: "env" as const, source: "env" as const },
    { key: "user" as const, source: "user" as const },
    { key: "project" as const, source: "project" as const },
    { key: "contract" as const, source: "contract" as const },
    { key: "request" as const, source: "request" as const },
  ];

  for (const { key, source } of layerOrder) {
    const layer = layers[key];
    if (layer && Object.keys(layer).length > 0) {
      // Filter out forbidden fields from project config
      const filtered = key === "project" ? filterProjectConfig(layer) : layer;
      if (Object.keys(filtered).length > 0) {
        try {
          const merged =
            key === "project"
              ? applyProjectTightening(filtered, effective, missingFields)
              : filtered;
          effective = mergeConfigs(effective, merged, source, sources);
        } catch {
          missingFields.push(`${key} layer merge failed`);
        }
      }
    }
  }

  // Validate final config
  const parseResult = EffectiveConfigSchema.safeParse(effective);
  const value: EffectiveConfig = parseResult.success
    ? parseResult.data
    : structuredClone({ ...BUILTIN_DEFAULTS, missingFields: [...missingFields, "schema validation failed"] });

  // Append any layer merge failures to missingFields
  if (missingFields.length > 0) {
    value.missingFields = [...value.missingFields, ...missingFields];
  }

  return { value, sources };
}

// Forbidden key patterns in project config (case-insensitive match)
const FORBIDDEN_KEY_PATTERNS = /^(api[_-]?key|api[_-]?keys|api[_-]?secret|credential|credentials?|secret|secrets?|token|tokens?|password|passwd|auth|authorization|jwt|private[_-]?key|access[_-]?key|secret[_-]?key|bearer|connection[_-]?string|cert|certificate|hook|hooks|command|script|exec|execute|shell|run|system[_-]?prompt|judge[_-]?prompt|judge[_-]?config|judge[_-]?rules)$/i;

function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_KEY_PATTERNS.test(key);
}

function filterProjectConfig(
  layer: Record<string, unknown>,
): Record<string, unknown> {
  return recursiveFilter(layer) as Record<string, unknown>;
}

function recursiveFilter(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map(recursiveFilter);
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const filtered: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (!isForbiddenKey(key)) {
        filtered[key] = recursiveFilter(val);
      }
    }
    return filtered;
  }
  return value;
}

// ── Project-layer tighten-only rules for collaboration (docs/42 §11.2, docs/16 §6) ──
// The project layer may close collaboration, shorten TTL/retention, set the
// inbound policy to hold/refuse, or lower numeric limits — but it can never
// enable remote transport, cross-project delivery, raise limits, or cancel
// the handoff user confirmation.

const COLLABORATION_DIRECTION_KEYS = [
  "sameProjectOnly",
  "allowRemoteTransport",
  "handoffRequiresUserConfirmation",
] as const;

const COLLABORATION_NUMERIC_CEILING_KEYS = [
  "maxHops",
  "maxOutstandingConsultsPerTask",
  "maxMessagesPerMinutePerTask",
  "maxMessageBytes",
  "maxContextRefs",
  "defaultTtlSeconds",
  "maxTtlSeconds",
  "messageRetentionDays",
] as const;

const COLLABORATION_KEYS = new Set<string>([
  "enabled",
  "defaultInboundPolicy",
  ...COLLABORATION_DIRECTION_KEYS,
  ...COLLABORATION_NUMERIC_CEILING_KEYS,
]);

function sanitizeProjectCollaboration(
  projectCollaboration: unknown,
  higher: Record<string, unknown>,
  missingFields: string[],
): Record<string, unknown> | undefined {
  if (
    projectCollaboration === null ||
    typeof projectCollaboration !== "object" ||
    Array.isArray(projectCollaboration)
  ) {
    missingFields.push("project collaboration block is not an object; ignored");
    return undefined;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(projectCollaboration as Record<string, unknown>)) {
    if (!COLLABORATION_KEYS.has(key)) continue; // unknown keys are dropped

    if (key === "enabled") {
      // The project may close collaboration (false), or keep it in the
      // higher layer's state. Re-enabling after a higher layer disabled it
      // is a relaxation and is rejected.
      if (typeof value !== "boolean") continue;
      if (value && higher[key] === false) {
        missingFields.push(`project collaboration.${key} rejected: only tightening is allowed`);
      } else {
        sanitized[key] = value;
      }
      continue;
    }

    if (key === "defaultInboundPolicy") {
      // Strictness order: accept < hold < refuse. The project may only
      // tighten, never relax the higher-layer policy.
      const order = ["accept", "hold", "refuse"];
      const higherIndex = order.indexOf(higher[key] as string);
      const valueIndex = typeof value === "string" ? order.indexOf(value) : -1;
      if (valueIndex < 0 || higherIndex < 0) continue;
      if (valueIndex >= higherIndex) {
        sanitized[key] = value;
      } else {
        missingFields.push(`project collaboration.${key} rejected: only tightening is allowed`);
      }
      continue;
    }

    if ((COLLABORATION_DIRECTION_KEYS as readonly string[]).includes(key)) {
      // Direction keys are locked: the project value must equal the
      // higher-layer value, so it can never flip the direction.
      if (value === higher[key]) {
        sanitized[key] = value;
      } else {
        missingFields.push(`project collaboration.${key} rejected: only tightening is allowed`);
      }
      continue;
    }

    if ((COLLABORATION_NUMERIC_CEILING_KEYS as readonly string[]).includes(key)) {
      if (
        typeof value === "number" &&
        typeof higher[key] === "number" &&
        value <= higher[key]
      ) {
        sanitized[key] = value;
      } else if (typeof value === "number") {
        missingFields.push(`project collaboration.${key} rejected: only lowering is allowed`);
      }
      continue;
    }
  }
  return sanitized;
}

function applyProjectTightening(
  projectLayer: Record<string, unknown>,
  effective: Record<string, unknown>,
  missingFields: string[],
): Record<string, unknown> {
  const result = structuredClone(projectLayer);
  if ("collaboration" in result) {
    const higher = (
      effective.collaboration !== null && typeof effective.collaboration === "object"
        ? (effective.collaboration as Record<string, unknown>)
        : {}
    );
    const sanitized = sanitizeProjectCollaboration(result.collaboration, higher, missingFields);
    if (sanitized === undefined) {
      delete result.collaboration;
    } else {
      result.collaboration = sanitized;
    }
  }
  return result;
}
