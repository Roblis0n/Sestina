#!/usr/bin/env node
/**
 * Check all markdown links in docs/ are valid.
 * Reports broken links and exits 1 if any found.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, relative, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DOCS_DIR = resolve(ROOT, "docs");

// Find all .md files in docs/
function findMdFiles(dir) {
  const results = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(resolve(dir, entry.name));
    }
  }
  return results.sort();
}

// Extract markdown links [text](path) from content
function extractLinks(content) {
  const links = [];
  const regex = /\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    links.push({
      text: match[1],
      url: match[2],
      index: match.index,
    });
  }
  return links;
}

// Get line number for a character index
function getLineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}

// Main check
function main() {
  const mdFiles = findMdFiles(DOCS_DIR);
  let brokenCount = 0;

  for (const file of mdFiles) {
    const content = readFileSync(file, "utf-8");
    const links = extractLinks(content);

    for (const link of links) {
      const { url } = link;

      // Skip external URLs
      if (url.startsWith("http://") || url.startsWith("https://")) continue;
      // Skip fragment-only links (within same page)
      if (url.startsWith("#")) continue;
      // Skip mailto
      if (url.startsWith("mailto:")) continue;

      // Handle fragment part
      const [pathPart] = url.split("#");

      if (!pathPart) continue; // Pure fragment

      const lineNum = getLineNumber(content, link.index);

      // Resolve the path
      const targetPath = resolve(dirname(file), pathPart);

      if (!existsSync(targetPath)) {
        console.error(
          `${relative(ROOT, file)}:${lineNum}: broken link -> ${url}`,
        );
        brokenCount++;
      }
    }
  }

  if (brokenCount > 0) {
    console.error(`\n${brokenCount} broken link(s) found.`);
    process.exit(1);
  }

  console.log(`All doc links valid (${mdFiles.length} files checked).`);
  process.exit(0);
}

main();
