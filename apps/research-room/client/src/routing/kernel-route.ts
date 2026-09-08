export interface KernelRoute {
  page:
    | "today"
    | "new"
    | "review"
    | "project"
    | "brief"
    | "history"
    | "search"
    | "settings"
    | "not_found"
    | "read_only";
  id?: string;
  kind?: string;
  section?: string;
  redirect?: string;
}
const id = /^[a-z]+_[0-9A-HJKMNP-TV-Z]{26}$/;
const objectId = (value: string) =>
  id.test(value) ||
  /^(?:rclm|rmec)_[0-9A-HJKMNP-TV-Z]{26}:revd_[0-9A-HJKMNP-TV-Z]{26}$/.test(
    value,
  );
export function parseKernelRoute(path: string, search = ""): KernelRoute {
  const q = new URLSearchParams(search),
    parts = path.split("/").filter(Boolean);
  if (
    [
      "/appeals/new",
      "/deliberation-rooms/new",
      "/external-app-pilots/new",
    ].includes(path)
  )
    return { page: "read_only" };
  if (path === "/project/kernel") {
    const review = q.get("review");
    if (review && !/^rrvw_[0-9A-HJKMNP-TV-Z]{26}$/.test(review))
      return { page: "not_found" };
    return {
      page: review && id.test(review) ? "review" : "today",
      ...(review && id.test(review) ? { id: review } : {}),
      redirect:
        review && id.test(review)
          ? `/project/reviews/${review}`
          : "/project/today",
    };
  }
  if (path === "/project/today") return { page: "today" };
  if (path === "/project/reviews/new") return { page: "new" };
  if (
    parts[1] === "reviews" &&
    parts.length === 3 &&
    parts[2]?.startsWith("rrvw_") &&
    id.test(parts[2])
  )
    return { page: "review", id: parts[2] };
  if (
    path === "/project/state" &&
    q.get("object") &&
    !objectId(q.get("object") ?? "")
  )
    return { page: "not_found" };
  if (path === "/project/state")
    return {
      page: "project",
      ...(q.get("object") ? { id: q.get("object") ?? "" } : {}),
      ...(q.get("kind") ? { kind: q.get("kind") ?? "" } : {}),
    };
  if (path === "/project/state/brief" || path === "/project/state/brief/edit")
    return { page: "brief", section: parts[3] ?? "detail" };
  if (
    parts[1] === "state" &&
    parts[2] === "brief" &&
    parts[3] === "history" &&
    parts[4] &&
    id.test(parts[4]) &&
    parts.length === 5
  )
    return { page: "brief", section: "history", id: parts[4] };
  if (path === "/project/history")
    return {
      page: "history",
      ...(q.get("kind") ? { section: q.get("kind") ?? "" } : {}),
    };
  if (
    parts[1] === "history" &&
    [
      "receipt",
      "research_room_receipts",
      "correction_appeals",
      "deliberation_rooms",
      "closed_external_app_pilots",
    ].includes(parts[2] ?? "") &&
    parts.length === 4 &&
    parts[3] &&
    id.test(parts[3])
  )
    return { page: "history", kind: parts[2], id: parts[3] };
  if (path === "/project/search") return { page: "search" };
  if (
    parts[1] === "settings" &&
    parts.length <= 3 &&
    (!parts[2] ||
      [
        "provider",
        "privacy",
        "appearance",
        "recovery",
        "integrations",
        "about",
        "advanced",
      ].includes(parts[2]))
  )
    return { page: "settings", section: parts[2] ?? "provider" };
  const old: Record<string, string> = {
    decisions: "decision",
    issues: "issue",
    evidence: "evidence",
    episodes: "episode",
    receipts: "research_room_receipts",
    appeals: "correction_appeals",
    "deliberation-rooms": "deliberation_rooms",
    "external-app-pilot": "closed_external_app_pilots",
    "external-app-pilots": "closed_external_app_pilots",
  };
  const kind = old[parts[1] ?? ""];
  if (kind) {
    if (parts[2] === "new") return { page: "read_only" };
    if (parts[2] && !id.test(parts[2])) return { page: "not_found" };
    const history = [
      "research_room_receipts",
      "correction_appeals",
      "deliberation_rooms",
      "closed_external_app_pilots",
    ].includes(kind);
    return {
      page: history ? "history" : "project",
      kind,
      ...(parts[2] ? { id: parts[2] } : {}),
      redirect: history
        ? `/project/history${parts[2] ? `/${kind}/${parts[2]}` : ""}`
        : `/project/state?${parts[2] ? `object=${parts[2]}` : `kind=${kind}`}`,
    };
  }
  const redirects: Record<string, string> = {
    "/project/review": "/project/today",
    "/project/overview": "/project/state",
    "/project/brief": "/project/state/brief",
    "/project/memory": "/project/state?context=1",
    "/project/attention": "/project/today",
  };
  if (redirects[path])
    return {
      ...parseKernelRoute(
        redirects[path].split("?")[0] ?? "",
        redirects[path].split("?")[1],
      ),
      redirect: redirects[path],
    };
  return { page: "not_found" };
}
