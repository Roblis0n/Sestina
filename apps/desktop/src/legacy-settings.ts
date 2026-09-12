import {
  createFileProviderConfigStore,
  migrateProviderConfiguration,
  resolveDefaultProviderConfigPath,
  OPENAI_COMPATIBLE_API_KEY_REF,
  SECOND_OPINION_OPENAI_COMPATIBLE_API_KEY_REF,
  type ProviderMigrationRecord,
} from "@sestina/application";
import {
  createSecretBackend,
  type SecretBackend,
  type SecretPlatform,
} from "@sestina/secrets";
import { lstat, readFile, open, rename, realpath, rm } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { DesktopPreferenceStore } from "./preferences.js";

async function knownFile(path: string) {
  const info = await lstat(path).catch(() => undefined);
  if (!info) return false;
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > 65536 ||
    (await realpath(dirname(path))) !== resolve(dirname(path))
  )
    throw Error("legacy_config_invalid");
  return true;
}
async function saveRecord(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(value));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
const hashPreference = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class LegacySettingsMigration {
  #busy = false;
  constructor(
    private readonly directory: string,
    private readonly secrets: SecretBackend,
    private readonly preferences: DesktopPreferenceStore,
    private readonly sourceRoot = dirname(resolveDefaultProviderConfigPath()),
    private readonly readSecrets = () =>
      createSecretBackend(process.platform as SecretPlatform, {
        envReader: { read: () => undefined, keys: () => [] },
      }),
  ) {}
  async inspect() {
    return {
      source: this.sourceRoot,
      providers: await Promise.all(
        ["provider", "second-opinion-provider"].map(async (name) => ({
          name,
          available: await knownFile(join(this.sourceRoot, `${name}.json`)),
        })),
      ),
      languageAvailable: await knownFile(
        join(this.sourceRoot, "preferences.json"),
      ),
      browserPreferences: "import_or_reset",
      sourcePreserved: true,
    };
  }
  async run() {
    if (this.#busy) throw Error("migration_in_progress");
    this.#busy = true;
    try {
      await this.preferences.root();
      const outcomes = [];
      let sourceSecrets: SecretBackend | undefined;
      for (const [index, name] of [
        "provider",
        "second-opinion-provider",
      ].entries()) {
        const source = join(this.sourceRoot, `${name}.json`);
        if (!(await knownFile(source))) {
          outcomes.push({ name, status: "missing" });
          continue;
        }
        const recordPath = join(this.directory, `${name}.migration.json`);
        const outcome = await migrateProviderConfiguration({
          source: createFileProviderConfigStore({ filePath: source }),
          target: createFileProviderConfigStore({
            filePath: join(this.directory, `${name}.json`),
          }),
          sourceSecrets: {
            get: async (ref) => {
              sourceSecrets ??= this.readSecrets();
              return sourceSecrets.get(ref);
            },
          },
          targetSecrets: this.secrets,
          sourceRef: index
            ? SECOND_OPINION_OPENAI_COMPATIBLE_API_KEY_REF
            : OPENAI_COMPATIBLE_API_KEY_REF,
          targetRef: index
            ? "sestina.second-opinion.api-key"
            : "sestina.provider.api-key",
          readRecord: async () =>
            (await knownFile(recordPath))
              ? (JSON.parse(
                  await readFile(recordPath, "utf8"),
                ) as ProviderMigrationRecord)
              : undefined,
          writeRecord: async (record) => {
            await saveRecord(recordPath, record);
          },
        });
        outcomes.push({ name, ...outcome });
      }
      let language = "kept";
      const legacyPreference = join(this.sourceRoot, "preferences.json");
      const marker = join(this.directory, "language.migration.json");
      if (await knownFile(legacyPreference)) {
        const value: unknown = JSON.parse(
          await readFile(legacyPreference, "utf8"),
        );
        if (
          !value ||
          typeof value !== "object" ||
          Object.keys(value).sort().join(",") !== "language,schemaVersion"
        )
          throw Error("legacy_config_invalid");
        const saved = value as { schemaVersion: unknown; language: unknown };
        if (
          saved.schemaVersion !== "1.0.0" ||
          !["en", "zh-CN"].includes(String(saved.language))
        )
          throw Error("legacy_config_invalid");
        const current = await this.preferences.read();
        const planned = { ...current, language: saved.language };
        const existing: unknown = (await knownFile(marker))
          ? JSON.parse(await readFile(marker, "utf8"))
          : undefined;
        const intent =
          existing === undefined
            ? {
                format: "1.0.0",
                stage: "prepared",
                sourceHash: hashPreference(value),
                priorHash: hashPreference(current),
                nextHash: hashPreference(planned),
              }
            : existing;
        if (!intent || typeof intent !== "object" || Array.isArray(intent))
          throw Error("legacy_config_invalid");
        const record = intent as Record<string, unknown>;
        if (
          Object.keys(record).sort().join(",") !==
            "format,nextHash,priorHash,sourceHash,stage" ||
          record.format !== "1.0.0" ||
          !["prepared", "complete"].includes(String(record.stage)) ||
          [record.sourceHash, record.priorHash, record.nextHash].some(
            (v) => typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v),
          )
        )
          throw Error("legacy_config_invalid");
        if (existing === undefined) await saveRecord(marker, record);
        if (
          record.stage === "prepared" &&
          record.sourceHash === hashPreference(value)
        ) {
          if (hashPreference(current) === record.priorHash) {
            await this.preferences.update({
              language: saved.language as "en" | "zh-CN",
            });
            language = "migrated";
          } else if (hashPreference(current) === record.nextHash)
            language = "migrated";
          // A later user preference wins. Completing the record never replays it.
          await saveRecord(marker, { ...record, stage: "complete" });
        }
      }
      return {
        providers: outcomes,
        language,
        sourcePreserved: true,
        browserPreferences: "import_or_reset",
        preferences: await this.preferences.read(),
      };
    } finally {
      this.#busy = false;
    }
  }
}
