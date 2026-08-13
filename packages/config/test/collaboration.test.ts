import { describe, it, expect } from "vitest";
import { loadEffectiveConfig } from "../src/index.js";

const DOC42_COLLABORATION_DEFAULTS = {
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
};

describe("Collaboration config defaults", () => {
  it("matches doc 42 §11.2 defaults with builtin sources", () => {
    const result = loadEffectiveConfig({ user: {}, project: {}, env: {} });
    expect(result.value.collaboration).toEqual(DOC42_COLLABORATION_DEFAULTS);
    expect(result.sources["collaboration.enabled"]).toBe("builtin");
    expect(result.sources["collaboration.sameProjectOnly"]).toBe("builtin");
    expect(result.sources["collaboration.allowRemoteTransport"]).toBe("builtin");
    expect(result.sources["collaboration.handoffRequiresUserConfirmation"]).toBe("builtin");
    expect(result.sources["collaboration.maxMessageBytes"]).toBe("builtin");
  });
});

describe("Project layer may only tighten collaboration", () => {
  it("allows disabling collaboration at project level", () => {
    const result = loadEffectiveConfig({
      user: {},
      project: { collaboration: { enabled: false } },
      env: {},
    });
    expect(result.value.collaboration.enabled).toBe(false);
    expect(result.sources["collaboration.enabled"]).toBe("project");
    expect(result.value.missingFields).toHaveLength(0);
  });

  it("allows lowering numeric limits at project level", () => {
    const result = loadEffectiveConfig({
      user: {},
      project: {
        collaboration: {
          maxMessageBytes: 8192,
          maxHops: 2,
          maxContextRefs: 4,
          maxOutstandingConsultsPerTask: 3,
          maxMessagesPerMinutePerTask: 6,
          defaultTtlSeconds: 900,
          maxTtlSeconds: 3600,
          messageRetentionDays: 30,
        },
      },
      env: {},
    });
    expect(result.value.collaboration.maxMessageBytes).toBe(8192);
    expect(result.value.collaboration.maxHops).toBe(2);
    expect(result.value.collaboration.maxContextRefs).toBe(4);
    expect(result.value.collaboration.maxOutstandingConsultsPerTask).toBe(3);
    expect(result.value.collaboration.maxMessagesPerMinutePerTask).toBe(6);
    expect(result.value.collaboration.defaultTtlSeconds).toBe(900);
    expect(result.value.collaboration.maxTtlSeconds).toBe(3600);
    expect(result.value.collaboration.messageRetentionDays).toBe(30);
    expect(result.value.missingFields).toHaveLength(0);
  });

  it("allows inbound policy hold/refuse at project level", () => {
    const held = loadEffectiveConfig({ user: {}, project: { collaboration: { defaultInboundPolicy: "hold" } }, env: {} });
    expect(held.value.collaboration.defaultInboundPolicy).toBe("hold");
    const refused = loadEffectiveConfig({ user: {}, project: { collaboration: { defaultInboundPolicy: "refuse" } }, env: {} });
    expect(refused.value.collaboration.defaultInboundPolicy).toBe("refuse");
  });

  it("rejects enabling remote transport at project level", () => {
    const result = loadEffectiveConfig({
      user: {},
      project: { collaboration: { allowRemoteTransport: true } },
      env: {},
    });
    expect(result.value.collaboration.allowRemoteTransport).toBe(false);
    expect(result.sources["collaboration.allowRemoteTransport"]).toBe("builtin");
    expect(result.value.missingFields).toContainEqual(expect.stringContaining("collaboration.allowRemoteTransport"));
  });

  it("rejects cross-project collaboration at project level", () => {
    const result = loadEffectiveConfig({
      user: {},
      project: { collaboration: { sameProjectOnly: false } },
      env: {},
    });
    expect(result.value.collaboration.sameProjectOnly).toBe(true);
    expect(result.value.missingFields).toContainEqual(expect.stringContaining("collaboration.sameProjectOnly"));
  });

  it("rejects cancelling handoff user confirmation at project level", () => {
    const result = loadEffectiveConfig({
      user: {},
      project: { collaboration: { handoffRequiresUserConfirmation: false } },
      env: {},
    });
    expect(result.value.collaboration.handoffRequiresUserConfirmation).toBe(true);
    expect(result.value.missingFields).toContainEqual(expect.stringContaining("collaboration.handoffRequiresUserConfirmation"));
  });

  it.each([
    ["maxHops", 9],
    ["maxOutstandingConsultsPerTask", 20],
    ["maxMessagesPerMinutePerTask", 100],
    ["maxMessageBytes", 20000],
    ["maxContextRefs", 12],
    ["maxTtlSeconds", 100000],
    ["messageRetentionDays", 180],
  ])("rejects raising %s at project level", (key, value) => {
    const result = loadEffectiveConfig({
      user: {},
      project: { collaboration: { [key]: value } },
      env: {},
    });
    expect(result.value.collaboration[key as keyof typeof DOC42_COLLABORATION_DEFAULTS])
      .toBe(DOC42_COLLABORATION_DEFAULTS[key as keyof typeof DOC42_COLLABORATION_DEFAULTS]);
    expect(result.value.missingFields).toContainEqual(expect.stringContaining(`collaboration.${key}`));
  });

  it("rejects raising defaultTtlSeconds at project level", () => {
    const result = loadEffectiveConfig({
      user: {},
      project: { collaboration: { defaultTtlSeconds: 7200 } },
      env: {},
    });
    expect(result.value.collaboration.defaultTtlSeconds).toBe(1800);
    expect(result.value.missingFields).toContainEqual(expect.stringContaining("collaboration.defaultTtlSeconds"));
  });

  it("keeps tightening while rejecting relaxation in the same project config", () => {
    const result = loadEffectiveConfig({
      user: {},
      project: {
        collaboration: { enabled: false, allowRemoteTransport: true, maxMessageBytes: 8192 },
      },
      env: {},
    });
    expect(result.value.collaboration.enabled).toBe(false);
    expect(result.value.collaboration.allowRemoteTransport).toBe(false);
    expect(result.value.collaboration.maxMessageBytes).toBe(8192);
    expect(result.value.missingFields).toContainEqual(expect.stringContaining("collaboration.allowRemoteTransport"));
    expect(result.value.missingFields).not.toContainEqual(expect.stringContaining("collaboration.maxMessageBytes"));
  });

  it("rejects project values that exceed a tightened user-level value", () => {
    const result = loadEffectiveConfig({
      user: { collaboration: { maxMessageBytes: 8192 } },
      project: { collaboration: { maxMessageBytes: 16384 } },
      env: {},
    });
    expect(result.value.collaboration.maxMessageBytes).toBe(8192);
    expect(result.value.missingFields).toContainEqual(expect.stringContaining("collaboration.maxMessageBytes"));
  });

  it("rejects user-level values above the schema ceiling", () => {
    const result = loadEffectiveConfig({
      user: { collaboration: { maxHops: 10 } },
      project: {},
      env: {},
    });
    expect(result.value.collaboration.maxHops).toBe(4);
    expect(result.value.missingFields.length).toBeGreaterThan(0);
  });

  it("rejects re-enabling collaboration at project level after a user disabled it", () => {
    const result = loadEffectiveConfig({
      user: { collaboration: { enabled: false } },
      project: { collaboration: { enabled: true } },
      env: {},
    });
    expect(result.value.collaboration.enabled).toBe(false);
    expect(result.value.missingFields).toContainEqual(expect.stringContaining("collaboration.enabled"));
  });

  it("rejects relaxing the inbound policy at project level below the higher layer", () => {
    const result = loadEffectiveConfig({
      user: { collaboration: { defaultInboundPolicy: "refuse" } },
      project: { collaboration: { defaultInboundPolicy: "accept" } },
      env: {},
    });
    expect(result.value.collaboration.defaultInboundPolicy).toBe("refuse");
    expect(result.value.missingFields).toContainEqual(expect.stringContaining("collaboration.defaultInboundPolicy"));
  });

  it("allows tightening the inbound policy at project level below the higher layer", () => {
    const result = loadEffectiveConfig({
      user: { collaboration: { defaultInboundPolicy: "accept" } },
      project: { collaboration: { defaultInboundPolicy: "hold" } },
      env: {},
    });
    expect(result.value.collaboration.defaultInboundPolicy).toBe("hold");
    expect(result.value.missingFields).toHaveLength(0);
  });
});
