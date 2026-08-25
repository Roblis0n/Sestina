export type ProjectWorkspace = "review" | "overview" | "brief" | "decision" | "issue" | "evidence" | "episode" | "receipt" | "attention" | "not_found";
export interface ProjectRoute { readonly workspace: ProjectWorkspace; readonly objectId?: string; }

const COLLECTIONS = Object.freeze({ decisions: "decision", issues: "issue", evidence: "evidence", episodes: "episode", receipts: "receipt" } as const);
const PREFIXES = Object.freeze({ decision: "rdec_", issue: "riss_", evidence: "revd_", episode: "repi_", receipt: "rrcp_" } as const);

export function parseProjectRoute(pathname: string): ProjectRoute {
  if (pathname === "/" || pathname === "/index.html" || pathname === "/project/review") return { workspace: "review" };
  if (pathname === "/project/overview") return { workspace: "overview" };
  if (pathname === "/project/brief") return { workspace: "brief" };
  if (pathname === "/project/attention") return { workspace: "attention" };
  const match = /^\/project\/(decisions|issues|evidence|episodes|receipts)(?:\/([^/]+))?$/u.exec(pathname);
  if (!match?.[1]) return { workspace: "not_found" };
  const workspace = COLLECTIONS[match[1] as keyof typeof COLLECTIONS];
  const objectId = match[2];
  if (objectId === undefined) return { workspace };
  const prefix = PREFIXES[workspace];
  return new RegExp(`^${prefix}[0-9A-HJKMNP-TV-Z]{26}$`, "u").test(objectId) ? { workspace, objectId } : { workspace: "not_found" };
}

export function hrefForRoute(route: ProjectRoute): string {
  if (route.workspace === "review") return "/project/review";
  if (route.workspace === "overview") return "/project/overview";
  if (route.workspace === "brief") return "/project/brief";
  if (route.workspace === "attention") return "/project/attention";
  if (route.workspace === "not_found") return "/project/not-found";
  const collection = route.workspace === "decision" ? "decisions" : route.workspace === "issue" ? "issues" : route.workspace === "evidence" ? "evidence" : route.workspace === "episode" ? "episodes" : "receipts";
  return `/project/${collection}${route.objectId ? `/${encodeURIComponent(route.objectId)}` : ""}`;
}
