function warningType(args: readonly unknown[]): string | undefined {
  const first = args[0];
  if (typeof first === "string") return first;
  if (typeof first === "object" && first !== null && "type" in first && typeof first.type === "string") {
    return first.type;
  }
  return undefined;
}

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...args: unknown[]): void => {
  const message = typeof warning === "string" ? warning : warning.message;
  if (
    warningType(args) === "ExperimentalWarning"
    && message === "SQLite is an experimental feature and might change at any time"
  ) return;
  Reflect.apply(emitWarning, process, [warning, ...args]);
});

await import("./runtime.js");
