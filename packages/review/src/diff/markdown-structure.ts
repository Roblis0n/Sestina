import { reviewFingerprint } from "../checkers/fingerprint.js";
import { cloneReviewValue, reviewOk, type ReviewResult } from "../review-result.js";

export interface MarkdownHeading { readonly level: number; readonly title: string; readonly line: number; }
export interface MarkdownBlock {
  readonly id: string; readonly type: "text" | "data" | "code"; readonly heading?: string;
  readonly headingPath: readonly string[]; readonly ordinal: number; readonly startLine: number; readonly endLine: number;
  readonly content: string; readonly contentHash: string;
}
export interface MarkdownStructure { readonly headings: readonly MarkdownHeading[]; readonly blocks: readonly MarkdownBlock[]; }

function blockType(lines: readonly string[], fenced: boolean): MarkdownBlock["type"] {
  if (fenced) return "code";
  if (lines.length > 1 && lines.every((line) => /^\s*\|.*\|\s*$/.test(line))) return "data";
  if (lines.every((line) => /^\s*(?:[-+]?\d+(?:\.\d+)?)(?:\s*[,;|\t]\s*[-+]?\d+(?:\.\d+)?)+\s*$/.test(line))) return "data";
  return "text";
}

export function parseMarkdownStructure(markdown: string): ReviewResult<MarkdownStructure> {
  const lines = markdown.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const headings: MarkdownHeading[] = []; const blocks: MarkdownBlock[] = []; const path: string[] = [];
  const ordinals = new Map<string, number>();
  let buffer: string[] = []; let startLine = 1; let inFence = false; let bufferFenced = false;
  const flush = (endLine: number) => {
    while (buffer.length > 0 && buffer.at(-1)?.trim() === "") buffer.pop();
    if (buffer.length === 0) return;
    const content = buffer.join("\n"); const type = blockType(buffer, bufferFenced);
    const key = `${path.join(" / ")}\u0000${type}`; const ordinal = ordinals.get(key) ?? 0; ordinals.set(key, ordinal + 1);
    blocks.push({ id: `blk_${reviewFingerprint({ headingPath: path, ordinal, type }).slice(0, 24)}`, type, ...(path.at(-1) ? { heading: path.at(-1) } : {}), headingPath: [...path], ordinal, startLine, endLine, content, contentHash: reviewFingerprint(content) });
    buffer = []; bufferFenced = false;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ""; const number = index + 1;
    if (/^\s*```/.test(line)) {
      if (buffer.length === 0) { startLine = number; bufferFenced = true; }
      buffer.push(line); inFence = !inFence;
      if (!inFence) flush(number);
      continue;
    }
    if (!inFence) {
      const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
      if (heading) {
        flush(number - 1);
        const level = heading[1]?.length ?? 1; const title = heading[2]?.trim() ?? "";
        path.splice(level - 1); path[level - 1] = title;
        headings.push({ level, title, line: number });
        continue;
      }
      if (line.trim() === "") { flush(number - 1); continue; }
    }
    if (buffer.length === 0) startLine = number;
    buffer.push(line);
  }
  flush(lines.length);
  return reviewOk(cloneReviewValue({ headings, blocks }));
}
