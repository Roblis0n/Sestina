import {
  canonicalStringify,
  parseResearchIdFor,
  parseResearchPageRequest,
  researchError,
  type ResearchPageRequest,
  type ResearchResult,
} from "@sestina/research";

interface CursorPayload {
  readonly version: 1;
  readonly projectId: string;
  readonly sortKey: string;
  readonly id: string;
}

export function decodeCursor(
  input: ResearchPageRequest,
  expectedProjectId: string | undefined,
): ResearchResult<CursorPayload | undefined> {
  const page = parseResearchPageRequest(input);
  if (!page.ok) return page;
  if (page.value.cursor === undefined) return { ok: true, value: undefined };
  let parsed: unknown;
  try {
    const text = Buffer.from(page.value.cursor, "base64url").toString("utf8");
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: researchError("invalid_pagination") };
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as { version?: unknown }).version !== 1 ||
    typeof (parsed as { projectId?: unknown }).projectId !== "string" ||
    typeof (parsed as { sortKey?: unknown }).sortKey !== "string" ||
    typeof (parsed as { id?: unknown }).id !== "string"
  ) {
    return { ok: false, error: researchError("invalid_pagination") };
  }
  const cursor = parsed as CursorPayload;
  const projectId = parseResearchIdFor(cursor.projectId, "rprj_");
  if (
    !projectId.ok ||
    cursor.sortKey.length === 0 ||
    cursor.id.length === 0 ||
    (expectedProjectId !== undefined && cursor.projectId !== expectedProjectId)
  ) {
    return { ok: false, error: researchError("invalid_pagination") };
  }
  return { ok: true, value: cursor };
}

export function encodeCursor(projectId: string, sortKey: string, id: string): string {
  const payload: CursorPayload = { version: 1, projectId, sortKey, id };
  const encoded = canonicalStringify(payload);
  if (!encoded.ok) throw new Error("cursor canonicalization failed");
  return Buffer.from(encoded.value, "utf8").toString("base64url");
}
