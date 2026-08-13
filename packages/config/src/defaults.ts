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
  collaboration: {
    enabled: true,
    sameProjectOnly: true,
    allowRemoteTransport: false,
    defaultInboundPolicy: "accept",
    handoffRequiresUserConfirmation: true,
    maxHops: 4,
    maxOutstandingConsultsPerTask: 8,
    maxMessagesPerMinutePerTask: 12,
    maxMessageBytes: 16384,
    maxContextRefs: 8,
    defaultTtlSeconds: 1800,
    maxTtlSeconds: 86400,
    messageRetentionDays: 90,
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
    "collaboration.enabled": "builtin",
    "collaboration.sameProjectOnly": "builtin",
    "collaboration.allowRemoteTransport": "builtin",
    "collaboration.defaultInboundPolicy": "builtin",
    "collaboration.handoffRequiresUserConfirmation": "builtin",
    "collaboration.maxHops": "builtin",
    "collaboration.maxOutstandingConsultsPerTask": "builtin",
    "collaboration.maxMessagesPerMinutePerTask": "builtin",
    "collaboration.maxMessageBytes": "builtin",
    "collaboration.maxContextRefs": "builtin",
    "collaboration.defaultTtlSeconds": "builtin",
    "collaboration.maxTtlSeconds": "builtin",
    "collaboration.messageRetentionDays": "builtin",
  };
}
