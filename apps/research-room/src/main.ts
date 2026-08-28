import { createResearchRoomServer } from "./server.js";
import { createNativeDirectoryPicker } from "./directory-picker.js";
import { createFileLanguagePreferenceStore, resolveDefaultLanguagePreferencePath } from "./language-preferences.js";
import { createSecretBackend, type SecretPlatform } from "@sestina/core";
import { isAbsolute, join, resolve } from "node:path";
import {
  ProviderConfigurationService,
  SECOND_OPINION_OPENAI_COMPATIBLE_API_KEY_REF,
  createFileProviderConfigStore,
  resolveDefaultProviderConfigPath,
  resolveDefaultSecondOpinionProviderConfigPath,
} from "./provider-settings.js";

function requestedPort(argv: readonly string[]): number {
  const index = argv.indexOf("--port");
  if (index === -1) return 43_148;
  const value = Number(argv[index + 1]);
  if (!Number.isSafeInteger(value) || value < 0 || value > 65_535) throw new Error("--port must be an integer from 0 to 65535.");
  return value;
}

function requestedConfigRoot(argv: readonly string[]): string | undefined {
  const index = argv.indexOf("--config-root");
  if (index === -1) return undefined;
  const value = argv[index + 1]?.trim();
  if (!value || !isAbsolute(value)) throw new Error("--config-root must be an absolute local directory.");
  return resolve(value);
}

try {
  const argv = process.argv.slice(2);
  const configRoot = requestedConfigRoot(argv);
  const directoryPicker = createNativeDirectoryPicker();
  const languagePreferenceStore = createFileLanguagePreferenceStore({ filePath: configRoot ? join(configRoot, "preferences.json") : resolveDefaultLanguagePreferencePath() });
  if (!["win32", "darwin", "linux"].includes(process.platform)) throw new Error("This desktop platform is not supported.");
  const secretBackend = await createSecretBackend(process.platform as SecretPlatform);
  const providerConfigurationService = new ProviderConfigurationService(
    createFileProviderConfigStore({ filePath: configRoot ? join(configRoot, "provider.json") : resolveDefaultProviderConfigPath() }),
    secretBackend,
  );
  const secondOpinionProviderConfigurationService = new ProviderConfigurationService(
    createFileProviderConfigStore({ filePath: configRoot ? join(configRoot, "second-opinion-provider.json") : resolveDefaultSecondOpinionProviderConfigPath() }),
    secretBackend,
    { secretRef: SECOND_OPINION_OPENAI_COMPATIBLE_API_KEY_REF },
  );
  const instance = createResearchRoomServer({
    host: "127.0.0.1",
    port: requestedPort(argv),
    languagePreferenceStore,
    providerConfigurationService,
    secondOpinionProviderConfigurationService,
    ...(directoryPicker ? { directoryPicker } : {}),
  });
  const running = await instance.start();
  process.stdout.write(`Sestina Research Room: ${running.origin}\n`);
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await running.close(); process.exitCode = 0; };
  process.once("SIGINT", () => { void stop(); });
  process.once("SIGTERM", () => { void stop(); });
} catch (error) {
  process.stderr.write(`Research Room failed to start: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
}
