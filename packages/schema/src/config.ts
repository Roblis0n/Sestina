import { z } from "zod";
import { ProjectIdSchema } from "./ids.js";

// ── Provider Config ──
export const ProviderTypeSchema = z.enum([
  "openai",
  "anthropic",
  "openai_compatible",
  "local",
  "cli",
  "disabled",
]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

export const ProviderConfigSchema = z.object({
  providerId: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/),
  type: ProviderTypeSchema,
  model: z.string(),
  baseUrl: z.url().optional(),
  apiKeyEnvVar: z.string(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  timeoutMs: z.number().int().positive().optional(),
  budgetLimit: z
    .object({
      maxCallsPerTask: z.number().int().positive().optional(),
      maxCostPerTask: z.number().positive().optional(),
    })
    .optional(),
  interventionCap: z
    .enum(["annotate", "steer", "require_evidence", "block"])
    .optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

// ── Capture Config ──
export const CaptureConfigSchema = z.object({
  hostContentLevel: z.enum(["governance_only", "summary", "full_text"]),
  retentionDays: z.number().int().positive(),
  hostTextEnabled: z.boolean(),
  excludePatterns: z.array(z.string()),
});
export type CaptureConfig = z.infer<typeof CaptureConfigSchema>;

// ── Project Config ──
export const ProjectConfigSchema = z.object({
  projectId: ProjectIdSchema,
  workRoots: z.array(z.string()),
  defaultProvider: z.string().optional(),
  capture: CaptureConfigSchema,
  rules: z.object({
    hard: z.array(z.record(z.string(), z.unknown())),
    soft: z.array(z.record(z.string(), z.unknown())),
    open: z.array(z.record(z.string(), z.unknown())),
  }),
  autoAttach: z.boolean(),
});
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

// ── Host Defaults ──
export const HostDefaultsSchema = z.object({
  codex: z.record(z.string(), z.unknown()).optional(),
  claude: z.record(z.string(), z.unknown()).optional(),
});
export type HostDefaults = z.infer<typeof HostDefaultsSchema>;

// ── User Config ──
export const UserConfigSchema = z.object({
  defaultProvider: z.string().optional(),
  providers: z.array(ProviderConfigSchema),
  capture: CaptureConfigSchema,
  privacy: z.object({
    networkDefault: z.enum(["deny_unless_provider_enabled", "allow_all"]),
    retentionDays: z.number().int().positive(),
    autoCleanup: z.boolean(),
  }),
  notifications: z.object({
    osEnabled: z.boolean(),
    feedEnabled: z.boolean(),
    urgentOnly: z.boolean(),
  }),
  runtime: z.object({
    autoStart: z.boolean(),
  }),
  hostDefaults: HostDefaultsSchema,
});
export type UserConfig = z.infer<typeof UserConfigSchema>;

// ── Effective Config ──
export const EffectiveConfigSchema = z.object({
  providers: z.array(ProviderConfigSchema),
  defaultProvider: z.string().optional(),
  capture: CaptureConfigSchema,
  privacy: z.object({
    networkDefault: z.enum(["deny_unless_provider_enabled", "allow_all"]),
    retentionDays: z.number().int().positive(),
    autoCleanup: z.boolean(),
  }),
  notifications: z.object({
    osEnabled: z.boolean(),
    feedEnabled: z.boolean(),
    urgentOnly: z.boolean(),
  }),
  runtime: z.object({
    autoStart: z.boolean(),
  }),
  hostDefaults: HostDefaultsSchema,
  projectOverrides: z.record(z.string(), z.unknown()).optional(),
  degradation: z.boolean(),
  missingFields: z.array(z.string()),
});
export type EffectiveConfig = z.infer<typeof EffectiveConfigSchema>;

// ── Config Layers (input to loadEffectiveConfig) ──
export const ConfigLayerSourceSchema = z.enum([
  "request", "contract", "project", "user", "env", "builtin",
]);
export type ConfigLayerSource = z.infer<typeof ConfigLayerSourceSchema>;

export const ConfigLayersSchema = z.object({
  request: z.record(z.string(), z.unknown()).optional(),
  contract: z.record(z.string(), z.unknown()).optional(),
  project: z.record(z.string(), z.unknown()).optional(),
  user: z.record(z.string(), z.unknown()).optional(),
  env: z.record(z.string(), z.unknown()).optional(),
});
export type ConfigLayers = z.infer<typeof ConfigLayersSchema>;

// ── Effective config with source tracking ──
export interface EffectiveValue<T> {
  value: T;
  source: ConfigLayerSource;
  sensitive: boolean;
  overridable: boolean;
}

export const EffectiveValueSchema = <T extends z.ZodType>(valueSchema: T) =>
  z.object({
    value: valueSchema,
    source: ConfigLayerSourceSchema,
    sensitive: z.boolean(),
    overridable: z.boolean(),
  });

export const ConfigSourceMapSchema = z.record(z.string(), ConfigLayerSourceSchema);
export type ConfigSourceMap = z.infer<typeof ConfigSourceMapSchema>;
