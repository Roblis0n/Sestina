import type { EffectiveConfig, ConfigSourceMap } from "@sestina/schema";

export const BUILTIN_DEFAULTS: EffectiveConfig = {
  capture: {
    hostContentLevel: "governance_only",
    retentionDays: 90,
    hostTextEnabled: false,
    excludePatterns: [],
  },
  privacy: {
    networkDefault: "deny_unless_provider_enabled",
    retentionDays: 90,
    autoCleanup: true,
  },
  notifications: {
    osEnabled: true,
    feedEnabled: true,
    urgentOnly: false,
  },
  runtime: {
    autoStart: true,
  },
  providers: [],
  defaultProvider: undefined,
  hostDefaults: {},
  projectOverrides: undefined,
  degradation: false,
  missingFields: [],
};

export function getDefaultSourceMap(): ConfigSourceMap {
  return {
    "capture.hostContentLevel": "builtin",
    "capture.retentionDays": "builtin",
    "capture.hostTextEnabled": "builtin",
    "privacy.networkDefault": "builtin",
    "privacy.retentionDays": "builtin",
    "privacy.autoCleanup": "builtin",
    "notifications.osEnabled": "builtin",
    "notifications.feedEnabled": "builtin",
    "notifications.urgentOnly": "builtin",
    "runtime.autoStart": "builtin",
  };
}
