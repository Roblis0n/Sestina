export type CliDecisionScope =
  | { readonly kind: "project" }
  | { readonly kind: "artifact"; readonly artifactId: string }
  | { readonly kind: "brief"; readonly briefVersionId: string }
  | { readonly kind: "issue"; readonly issueId: string };

export function parseDecisionScope(value: string | undefined): CliDecisionScope | undefined {
  if (value === "project") return { kind: "project" };
  const separator = value?.indexOf(":") ?? -1;
  if (value === undefined || separator < 1) return undefined;
  const kind = value.slice(0, separator); const id = value.slice(separator + 1);
  if (kind === "artifact" && id.startsWith("rart_")) return { kind: "artifact", artifactId: id };
  if (kind === "brief" && id.startsWith("rbrf_")) return { kind: "brief", briefVersionId: id };
  if (kind === "issue" && id.startsWith("riss_")) return { kind: "issue", issueId: id };
  return undefined;
}
