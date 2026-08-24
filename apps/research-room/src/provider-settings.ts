import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, posix, win32 } from "node:path";
import type { SecretBackend, SecretBackendStatus } from "@sestina/core";

export const OPENAI_COMPATIBLE_API_KEY_REF = "sestina/research-room/openai-compatible/api-key";

export type ProviderSettingsErrorCode =
  | "invalid_provider_config"
  | "provider_config_corrupt"
  | "provider_key_required"
  | "secure_storage_unavailable";

export class ProviderSettingsError extends Error {
  constructor(readonly code: ProviderSettingsErrorCode, message: string) {
    super(message);
    this.name = "ProviderSettingsError";
  }
}

export interface OpenAICompatibleProviderConfig {
  readonly schemaVersion: "1.0.0";
  readonly family: "openai_compatible";
  readonly providerId: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxOutputTokens?: number;
  readonly locality: "local" | "external";
  readonly generation: number;
}

export interface SaveOpenAICompatibleProviderInput {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxOutputTokens?: number;
  readonly apiKey?: string;
}

export interface ProviderConfigurationStatus {
  readonly mode: "offline_ledger" | "configured";
  readonly config?: OpenAICompatibleProviderConfig;
  readonly secretConfigured: boolean;
  readonly secureStorage: SecretBackendStatus;
}

export interface ProviderRuntimeSnapshot {
  readonly config: OpenAICompatibleProviderConfig;
  readonly apiKey?: string;
}

export interface ProviderConfigStore {
  read(): Promise<OpenAICompatibleProviderConfig | undefined>;
  write(config: OpenAICompatibleProviderConfig): Promise<void>;
  delete(): Promise<void>;
}

export interface DefaultProviderConfigPathOptions {
  readonly platform?: NodeJS.Platform;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly homeDirectory?: string;
}

export interface FileProviderConfigStoreOptions {
  readonly filePath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function cleanText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) return undefined;
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    if (code <= 31 || code === 127) return undefined;
  }
  return normalized;
}

function ipv4Parts(hostname: string): readonly number[] | undefined {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part))) return undefined;
  const numbers = parts.map(Number);
  return numbers.every((part) => part >= 0 && part <= 255) ? numbers : undefined;
}

function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (host === "localhost" || host === "::1") return true;
  const parts = ipv4Parts(host);
  return parts?.[0] === 127;
}

function configuredDirectory(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) return fallback;
  return normalized;
}

function isForbiddenNetworkLiteral(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (host === "*" || host === "0.0.0.0" || host === "::" || host === "::0") return true;
  if (["metadata", "metadata.google.internal", "instance-data", "instance-data.ec2.internal"].includes(host.replace(/\.+$/u, ""))) return true;
  const parts = ipv4Parts(host);
  if (parts !== undefined) {
    const [a = -1, b = -1] = parts;
    return a === 0
      || a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127)
      || a >= 224;
  }
  const compactIpv6 = host.replaceAll(":", "");
  if (/^(?:fc|fd|fe8|fe9|fea|feb|ff)/u.test(compactIpv6)) return true;
  const mappedIpv4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(host)?.[1];
  return mappedIpv4 === undefined ? false : isForbiddenNetworkLiteral(mappedIpv4);
}

export function validateOpenAICompatibleBaseUrl(input: unknown): {
  readonly baseUrl: string;
  readonly origin: string;
  readonly locality: "local" | "external";
} {
  const raw = cleanText(input, 2_048);
  if (raw === undefined) throw new ProviderSettingsError("invalid_provider_config", "Enter a valid Provider base URL.");
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new ProviderSettingsError("invalid_provider_config", "Enter a valid Provider base URL."); }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") throw new ProviderSettingsError("invalid_provider_config", "Provider URLs cannot contain credentials, query values, or fragments.");
  const local = isLoopback(url.hostname);
  if (url.protocol === "http:" && !local) throw new ProviderSettingsError("invalid_provider_config", "External Providers require HTTPS.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new ProviderSettingsError("invalid_provider_config", "Only external HTTPS or explicit loopback HTTP is allowed.");
  if (!local && isForbiddenNetworkLiteral(url.hostname)) throw new ProviderSettingsError("invalid_provider_config", "The Provider target is not allowed.");
  if (url.pathname.includes("//")) throw new ProviderSettingsError("invalid_provider_config", "The Provider base path is invalid.");
  const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/u, "");
  return Object.freeze({
    baseUrl: `${url.origin}${pathname}`,
    origin: url.origin,
    locality: local ? "local" as const : "external" as const,
  });
}

function parseConfig(value: unknown): OpenAICompatibleProviderConfig | undefined {
  if (!isRecord(value)) return undefined;
  const allowed = ["schemaVersion", "family", "providerId", "baseUrl", "model", "timeoutMs", "maxOutputTokens", "locality", "generation"];
  const required = allowed.filter((key) => key !== "maxOutputTokens");
  if (!required.every((key) => key in value) || Object.keys(value).some((key) => !allowed.includes(key))) return undefined;
  const providerId = cleanText(value.providerId, 128);
  const model = cleanText(value.model, 256);
  if (value.schemaVersion !== "1.0.0" || value.family !== "openai_compatible" || providerId === undefined || model === undefined) return undefined;
  if (!Number.isSafeInteger(value.timeoutMs) || Number(value.timeoutMs) < 100 || Number(value.timeoutMs) > 120_000) return undefined;
  if (!Number.isSafeInteger(value.generation) || Number(value.generation) < 1) return undefined;
  if (value.maxOutputTokens !== undefined && (!Number.isSafeInteger(value.maxOutputTokens) || Number(value.maxOutputTokens) < 1 || Number(value.maxOutputTokens) > 65_536)) return undefined;
  let validated: ReturnType<typeof validateOpenAICompatibleBaseUrl>;
  try { validated = validateOpenAICompatibleBaseUrl(value.baseUrl); }
  catch { return undefined; }
  if (validated.baseUrl !== value.baseUrl || validated.locality !== value.locality) return undefined;
  return Object.freeze({
    schemaVersion: "1.0.0",
    family: "openai_compatible",
    providerId,
    baseUrl: validated.baseUrl,
    model,
    timeoutMs: Number(value.timeoutMs),
    ...(value.maxOutputTokens === undefined ? {} : { maxOutputTokens: Number(value.maxOutputTokens) }),
    locality: validated.locality,
    generation: Number(value.generation),
  });
}

export function resolveDefaultProviderConfigPath(options: DefaultProviderConfigPathOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();
  if (platform === "win32") {
    const appData = configuredDirectory(environment.LOCALAPPDATA, win32.join(homeDirectory, "AppData", "Local"));
    return win32.join(appData, "Sestina", "provider.json");
  }
  if (platform === "darwin") return posix.join(homeDirectory.replaceAll("\\", "/"), "Library", "Application Support", "Sestina", "provider.json");
  const config = configuredDirectory(environment.XDG_CONFIG_HOME, posix.join(homeDirectory.replaceAll("\\", "/"), ".config"));
  return posix.join(config, "sestina", "provider.json");
}

export function createFileProviderConfigStore(options: FileProviderConfigStoreOptions): ProviderConfigStore {
  const filePath = options.filePath;
  let writes = Promise.resolve();
  return Object.freeze({
    async read(): Promise<OpenAICompatibleProviderConfig | undefined> {
      let raw: string;
      try { raw = await readFile(filePath, "utf8"); }
      catch (error) { if (isMissing(error)) return undefined; throw error; }
      let decoded: unknown;
      try { decoded = JSON.parse(raw); }
      catch { throw new ProviderSettingsError("provider_config_corrupt", "The Provider configuration is corrupt and was preserved."); }
      const parsed = parseConfig(decoded);
      if (parsed === undefined) throw new ProviderSettingsError("provider_config_corrupt", "The Provider configuration is corrupt and was preserved.");
      return parsed;
    },
    write(config: OpenAICompatibleProviderConfig): Promise<void> {
      const action = async () => {
        const parsed = parseConfig(config);
        if (parsed === undefined) throw new ProviderSettingsError("invalid_provider_config", "The Provider configuration is invalid.");
        const directory = dirname(filePath);
        await mkdir(directory, { recursive: true });
        const staged = join(directory, `.provider.${randomBytes(12).toString("hex")}.tmp`);
        try {
          await writeFile(staged, `${JSON.stringify(parsed)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
          await rename(staged, filePath);
        } catch (error) {
          await rm(staged, { force: true }).catch(() => undefined);
          throw error;
        }
      };
      const result = writes.then(action, action);
      writes = result.catch(() => undefined);
      return result;
    },
    async delete(): Promise<void> {
      await rm(filePath, { force: true });
    },
  });
}

function safeHealth(status: SecretBackendStatus): SecretBackendStatus {
  return Object.freeze({ available: status.available, backend: status.backend, ...(status.reason ? { reason: status.reason } : {}) });
}

export class ProviderConfigurationService {
  constructor(
    private readonly store: ProviderConfigStore,
    private readonly secrets: SecretBackend,
  ) {}

  async status(): Promise<ProviderConfigurationStatus> {
    const config = await this.store.read();
    let secureStorage: SecretBackendStatus;
    let secretConfigured = false;
    try {
      [secureStorage, { configured: secretConfigured }] = await Promise.all([
        this.secrets.health(),
        this.secrets.describe(OPENAI_COMPATIBLE_API_KEY_REF),
      ]);
    } catch {
      secureStorage = { available: false, backend: "none", reason: "Secure storage is unavailable." };
    }
    return Object.freeze({
      mode: config === undefined ? "offline_ledger" : "configured",
      ...(config === undefined ? {} : { config }),
      secretConfigured,
      secureStorage: safeHealth(secureStorage),
    });
  }

  async save(input: SaveOpenAICompatibleProviderInput): Promise<OpenAICompatibleProviderConfig> {
    if (!isRecord(input)) throw new ProviderSettingsError("invalid_provider_config", "The Provider configuration is invalid.");
    const allowedInputKeys = ["providerId", "baseUrl", "model", "timeoutMs", "maxOutputTokens", "apiKey"];
    if (Object.keys(input).some((key) => !allowedInputKeys.includes(key))) throw new ProviderSettingsError("invalid_provider_config", "The Provider configuration is invalid.");
    const previous = await this.store.read();
    const providerId = cleanText(input.providerId, 128);
    const model = cleanText(input.model, 256);
    const validated = validateOpenAICompatibleBaseUrl(input.baseUrl);
    if (providerId === undefined || model === undefined || !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 120_000 || (input.maxOutputTokens !== undefined && (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 || input.maxOutputTokens > 65_536))) throw new ProviderSettingsError("invalid_provider_config", "The Provider configuration is invalid.");
    const apiKey = input.apiKey === undefined ? undefined : cleanText(input.apiKey, 8_192);
    if (input.apiKey !== undefined && apiKey === undefined) throw new ProviderSettingsError("invalid_provider_config", "The API key is invalid.");
    let secretConfigured = false;
    try { secretConfigured = (await this.secrets.describe(OPENAI_COMPATIBLE_API_KEY_REF)).configured; }
    catch { /* handled below */ }
    if (validated.locality === "external" && apiKey === undefined && !secretConfigured) throw new ProviderSettingsError("provider_key_required", "External HTTPS Providers require a securely stored API key.");
    if (apiKey !== undefined) {
      let health: SecretBackendStatus;
      try { health = await this.secrets.health(); }
      catch { health = { available: false, backend: "none" }; }
      if (!health.available) throw new ProviderSettingsError("secure_storage_unavailable", "Secure storage is unavailable; the API key was not saved.");
      try { await this.secrets.set(OPENAI_COMPATIBLE_API_KEY_REF, apiKey); }
      catch { throw new ProviderSettingsError("secure_storage_unavailable", "Secure storage is unavailable; the API key was not saved."); }
    }
    const config: OpenAICompatibleProviderConfig = Object.freeze({
      schemaVersion: "1.0.0",
      family: "openai_compatible",
      providerId,
      baseUrl: validated.baseUrl,
      model,
      timeoutMs: input.timeoutMs,
      ...(input.maxOutputTokens === undefined ? {} : { maxOutputTokens: input.maxOutputTokens }),
      locality: validated.locality,
      generation: (previous?.generation ?? 0) + 1,
    });
    await this.store.write(config);
    return config;
  }

  async deleteConfig(): Promise<void> {
    await this.store.delete();
  }

  async deleteSecret(): Promise<void> {
    try { await this.secrets.delete(OPENAI_COMPATIBLE_API_KEY_REF); }
    catch { throw new ProviderSettingsError("secure_storage_unavailable", "Secure storage is unavailable; the API key was not deleted."); }
  }

  async loadRuntimeSnapshot(): Promise<ProviderRuntimeSnapshot | undefined> {
    const config = await this.store.read();
    if (config === undefined) return undefined;
    let apiKey: string | undefined;
    try { apiKey = await this.secrets.get(OPENAI_COMPATIBLE_API_KEY_REF); }
    catch { throw new ProviderSettingsError("secure_storage_unavailable", "Secure storage is unavailable; Provider use is blocked."); }
    if (config.locality === "external" && apiKey === undefined) throw new ProviderSettingsError("provider_key_required", "The external Provider key is missing; Provider use is blocked.");
    return Object.freeze({ config, ...(apiKey === undefined ? {} : { apiKey }) });
  }

  async currentGeneration(): Promise<number | undefined> {
    return (await this.store.read())?.generation;
  }
}
