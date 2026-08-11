/**
 * Parse environment variables into a config layer.
 * Only allows whitelisted variables.
 */
export function parseEnvConfig(
  env: Record<string, string | undefined>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  const mode = env.SESTINA_MODE;
  if (mode && ["balanced", "local_only", "observe", "paused"].includes(mode)) {
    result.mode = mode;
  }

  const logLevel = env.SESTINA_LOG_LEVEL;
  if (logLevel && ["debug", "info", "warn", "error"].includes(logLevel)) {
    result.logLevel = logLevel;
  }

  const provider = env.SESTINA_PROVIDER;
  if (provider) {
    result.defaultProvider = provider;
  }

  return result;
}
