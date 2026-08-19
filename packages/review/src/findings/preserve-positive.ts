export interface PreservedPositiveProjection {
  readonly evidenceSupported: boolean;
  readonly items: readonly string[];
  readonly explanation: string;
}

export function preservePositive(parts: readonly string[]): PreservedPositiveProjection {
  const items = Object.freeze([...new Set(parts.map((item) => item.trim()).filter((item) => item.length > 0))].sort());
  return Object.freeze(items.length > 0
    ? { evidenceSupported: true, items, explanation: "Evidence-supported preserved parts supplied by the review were retained." }
    : { evidenceSupported: false, items, explanation: "No evidence-supported preserved part was identified." });
}
