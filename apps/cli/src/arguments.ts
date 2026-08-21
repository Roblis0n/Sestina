const BOOLEAN_OPTIONS = new Set(["yes", "json", "help", "version", "deterministic", "verbose", "include-full-text", "all-findings", "verify-host"]);
const VALUE_OPTIONS = new Set([
  "project", "title", "from", "file", "kind", "path", "artifact", "baseline", "revision", "expected-version",
  "statement", "rationale", "scope", "reason", "reopen-condition", "evidence-id", "invalidation", "dimension",
  "build-version", "limitation", "host", "codex-executable",
]);

export interface ParsedCliArguments {
  readonly positionals: readonly string[];
  readonly options: Readonly<Record<string, string | boolean>>;
  readonly valid: boolean;
}

export function parseCliArguments(args: readonly string[]): ParsedCliArguments {
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === undefined) return { positionals, options, valid: false };
    if (!token.startsWith("--")) { positionals.push(token); continue; }
    const name = token.slice(2);
    if (BOOLEAN_OPTIONS.has(name)) {
      if (options[name] !== undefined) return { positionals, options, valid: false };
      options[name] = true;
      continue;
    }
    if (!VALUE_OPTIONS.has(name) || options[name] !== undefined) return { positionals, options, valid: false };
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) return { positionals, options, valid: false };
    options[name] = value;
    index += 1;
  }
  return { positionals, options, valid: true };
}

export function stringOption(args: ParsedCliArguments, name: string): string | undefined {
  const value = args.options[name];
  return typeof value === "string" ? value : undefined;
}

export function numberOption(args: ParsedCliArguments, name: string): number | undefined | "invalid" {
  const value = stringOption(args, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : "invalid";
}
