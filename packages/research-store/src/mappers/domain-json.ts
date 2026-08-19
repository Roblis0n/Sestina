import {
  canonicalStringify,
  researchError,
  type ResearchResult,
} from "@sestina/research";

type DomainParser<T> = (input: unknown) => ResearchResult<T>;

export function encodeDomainJson<T>(value: unknown, parser: DomainParser<T>): ResearchResult<string> {
  const parsed = parser(value);
  if (!parsed.ok) return parsed;
  return canonicalStringify(parsed.value);
}

export function decodeDomainJson<T>(value: string, parser: DomainParser<T>): ResearchResult<T> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value) as unknown;
  } catch {
    return { ok: false, error: researchError("research_storage_unavailable") };
  }
  return parser(decoded);
}
