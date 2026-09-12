import { it, expect } from "vitest";
import {
  ProviderConfigurationService,
  migrateProviderConfiguration,
  type ProviderMigrationRecord,
  type ProviderConfigStore,
  type OpenAICompatibleProviderConfig,
} from "../../packages/application/src/index.js";
import { withSessionSecrets } from "../../apps/desktop/src/session-secrets.js";
import type { SecretBackend } from "@sestina/core";
function store() {
  let value: OpenAICompatibleProviderConfig | undefined;
  let generation = 0;
  return {
    read: async () => value,
    lastGeneration: async () => generation,
    write: async (config: OpenAICompatibleProviderConfig) => {
      value = config;
      generation = Math.max(config.generation, generation);
    },
    delete: async () => {
      value = undefined;
    },
  } satisfies ProviderConfigStore;
}
const failingReadback: SecretBackend = {
  health: async () => ({ available: true, backend: "dpapi" }),
  describe: async () => ({ configured: false }),
  get: async () => undefined,
  set: async () => {},
  delete: async () => {},
};
it("a key that cannot be read back must not publish a usable Provider configuration", async () => {
  const target = store();
  const service = new ProviderConfigurationService(target, failingReadback);
  await expect(
    service.save({
      providerId: "synthetic",
      baseUrl: "https://provider.invalid",
      model: "synthetic",
      timeoutMs: 1000,
      apiKey: "synthetic-key",
    }),
  ).rejects.toThrow();
  expect(await target.read()).toBeUndefined();
});
it("migration preserves its source, renews generation, retries key failure and does not resurrect deleted settings", async () => {
  const source = store(),
    target = store();
  const original: OpenAICompatibleProviderConfig = {
    schemaVersion: "1.0.0",
    family: "openai_compatible",
    providerId: "synthetic",
    baseUrl: "https://provider.invalid",
    model: "synthetic",
    timeoutMs: 1000,
    locality: "external",
    generation: 12,
  };
  await source.write(original);
  let record: ProviderMigrationRecord | undefined;
  let saved: string | undefined;
  let failed = true;
  const targetSecrets: SecretBackend = {
    ...failingReadback,
    set: async (_ref, value) => {
      saved = value;
    },
    get: async () => (failed ? undefined : saved),
  };
  const options = {
    source,
    target,
    sourceSecrets: { get: async () => "synthetic-private-value" },
    targetSecrets,
    sourceRef: "old",
    targetRef: "new",
    readRecord: async () => record,
    writeRecord: async (value: ProviderMigrationRecord) => {
      record = value;
    },
  };
  expect((await migrateProviderConfiguration(options)).status).toBe(
    "credentials_need_input",
  );
  expect((await target.read())?.generation).toBe(13);
  expect(await source.read()).toEqual(original);
  failed = false;
  expect((await migrateProviderConfiguration(options)).status).toBe("complete");
  expect((await migrateProviderConfiguration(options)).generation).toBe(13);
  expect(JSON.stringify(record)).not.toContain("synthetic-private-value");
  await target.delete();
  expect((await migrateProviderConfiguration(options)).status).toBe(
    "current_config_kept",
  );
  expect(await target.read()).toBeUndefined();
});
it("session-only credentials require a choice and disappear without a persistent write", async () => {
  let writes = 0;
  const wrapper = withSessionSecrets({
    ...failingReadback,
    health: async () => ({ available: false, backend: "none" }),
    set: async () => {
      writes++;
      throw Error("unavailable");
    },
  });
  expect((await wrapper.backend.health()).available).toBe(false);
  wrapper.enable();
  await wrapper.backend.set("synthetic", "temporary synthetic credential");
  expect(await wrapper.backend.get("synthetic")).toBe(
    "temporary synthetic credential",
  );
  expect(writes).toBe(0);
  wrapper.clear();
  expect(await wrapper.backend.get("synthetic")).toBeUndefined();
});
