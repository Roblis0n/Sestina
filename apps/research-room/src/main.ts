import { createResearchRoomServer } from "./server.js";
import { createNativeDirectoryPicker } from "./directory-picker.js";
import { createFileLanguagePreferenceStore, resolveDefaultLanguagePreferencePath } from "./language-preferences.js";
import { createSecretBackend, type SecretPlatform } from "@sestina/core";
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
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) throw new Error("--port must be an integer from 1 to 65535.");
  return value;
}

try {
  const directoryPicker = createNativeDirectoryPicker();
  const languagePreferenceStore = createFileLanguagePreferenceStore({ filePath: resolveDefaultLanguagePreferencePath() });
  if (!["win32", "darwin", "linux"].includes(process.platform)) throw new Error("This desktop platform is not supported.");
  const secretBackend = await createSecretBackend(process.platform as SecretPlatform);
  const providerConfigurationService = new ProviderConfigurationService(
    createFileProviderConfigStore({ filePath: resolveDefaultProviderConfigPath() }),
    secretBackend,
  );
  const secondOpinionProviderConfigurationService = new ProviderConfigurationService(
    createFileProviderConfigStore({ filePath: resolveDefaultSecondOpinionProviderConfigPath() }),
    secretBackend,
    { secretRef: SECOND_OPINION_OPENAI_COMPATIBLE_API_KEY_REF },
  );
  const instance = createResearchRoomServer({
    host: "127.0.0.1",
    port: requestedPort(process.argv.slice(2)),
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
