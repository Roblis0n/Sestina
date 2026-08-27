export type ProjectWorkspace = "review" | "overview" | "brief" | "decision" | "issue" | "evidence" | "episode" | "receipt" | "appeal" | "deliberation_room" | "memory" | "attention" | "not_found";
export interface ProjectRoute { readonly workspace: ProjectWorkspace; readonly objectId?: string; readonly creating?: boolean; }

const COLLECTIONS = Object.freeze({ decisions: "decision", issues: "issue", evidence: "evidence", episodes: "episode", receipts: "receipt", appeals: "appeal", "deliberation-rooms": "deliberation_room" } as const);
const PREFIXES = Object.freeze({ decision: "rdec_", issue: "riss_", evidence: "revd_", episode: "repi_", receipt: "rrcp_", appeal: "rapl_", deliberation_room: "rdlr_" } as const);

export function parseProjectRoute(pathname: string): ProjectRoute {
  if (pathname === "/" || pathname === "/index.html" || pathname === "/project/review") return { workspace: "review" };
  if (pathname === "/project/overview") return { workspace: "overview" };
  if (pathname === "/project/brief") return { workspace: "brief" };
  if (pathname === "/project/memory") return { workspace: "memory" };
  if (pathname === "/project/attention") return { workspace: "attention" };
  const match = /^\/project\/(decisions|issues|evidence|episodes|receipts|appeals|deliberation-rooms)(?:\/([^/]+))?$/u.exec(pathname);
  if (!match?.[1]) return { workspace: "not_found" };
  const workspace = COLLECTIONS[match[1] as keyof typeof COLLECTIONS];
  const objectId = match[2];
  if (objectId === undefined) return { workspace };
  if ((workspace === "appeal" || workspace === "deliberation_room") && objectId === "new") return { workspace, creating: true };
  const prefix = PREFIXES[workspace];
  return new RegExp(`^${prefix}[0-9A-HJKMNP-TV-Z]{26}$`, "u").test(objectId) ? { workspace, objectId } : { workspace: "not_found" };
}

export function hrefForRoute(route: ProjectRoute): string {
  if (route.workspace === "review") return "/project/review";
  if (route.workspace === "overview") return "/project/overview";
  if (route.workspace === "brief") return "/project/brief";
  if (route.workspace === "memory") return "/project/memory";
  if (route.workspace === "attention") return "/project/attention";
  if (route.workspace === "not_found") return "/project/not-found";
  const collection = route.workspace === "decision" ? "decisions" : route.workspace === "issue" ? "issues" : route.workspace === "evidence" ? "evidence" : route.workspace === "episode" ? "episodes" : route.workspace === "receipt" ? "receipts" : route.workspace === "appeal" ? "appeals" : "deliberation-rooms";
  return `/project/${collection}${route.objectId ? `/${encodeURIComponent(route.objectId)}` : ""}`;
}
