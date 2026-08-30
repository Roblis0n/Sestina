#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function requireFile(path) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    errors.push(`missing required public file: ${path}`);
    return false;
  }
  return true;
}

function requireText(path, fragments) {
  if (!requireFile(path)) return;
  const content = read(path);
  for (const fragment of fragments) {
    if (!content.includes(fragment)) {
      errors.push(`${path} is missing required contract text: ${fragment}`);
    }
  }
}

function requirePatterns(path, patterns) {
  if (!requireFile(path)) return;
  const content = read(path);
  for (const pattern of patterns) {
    if (!pattern.test(content)) {
      errors.push(`${path} is missing required contract pattern: ${pattern}`);
    }
  }
}

for (const path of [
  ".gitattributes",
  "README.md",
  "AGENTS.md",
  "LICENSE",
  "NOTICE",
  "TRADEMARKS.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "PRIVACY.md",
  "SECURITY.md",
  "SUPPORT.md",
  "docs/README.md",
  "docs/ARCHITECTURE.md",
  "docs/product/CURRENT-PRODUCT-DEFINITION.md",
  "docs/product/OFFICIAL-LOGO.md",
  "docs/integrations/MCP-AND-HOST-INTEGRATION.md",
  "docs/release/THIRD-PARTY-NOTICES.md",
  "docs/i18n/README.zh-CN.md",
  "docs/i18n/README.ja.md",
  "docs/i18n/README.es.md",
  "docs/i18n/README.fr.md",
  "docs/i18n/README.de.md",
]) {
  requireFile(path);
}

for (const path of [
  "CLAUDE.md",
  "handoff.md",
  "HANDOFF-FOR-CLAUDE-CODE.md",
  "HANDOFF-FOR-NEXT-CONVERSATION.md",
  "docs/execution",
  "docs/history",
  "docs/pivot-inputs",
  "docs/product-exploration",
  "spikes",
]) {
  if (existsSync(resolve(root, path))) {
    errors.push(`internal-only path must not be public: ${path}`);
  }
}

requireText("README.md", [
  "local, interactive research application",
  "only the user",
  "Context Manifests",
  "pnpm verify:public",
  "docs/i18n/README.zh-CN.md",
  "docs/i18n/README.ja.md",
  "docs/i18n/README.es.md",
  "docs/i18n/README.fr.md",
  "docs/i18n/README.de.md",
]);
requireText("docs/product/CURRENT-PRODUCT-DEFINITION.md", [
  "Research Deliberation Kernel",
  "Research Room",
  "The user is the only research authority",
  "public MCP surface is intentionally read-only",
  "telemetry",
]);
requireText("PRIVACY.md", [
  "networkDefault: denied",
  "no automatic telemetry",
  "Raw Provider",
]);
requireText("SECURITY.md", [
  "private GitHub Security Advisory",
  "MCP exposes exactly",
  "Automatic telemetry",
]);
requireText("TRADEMARKS.md", [
  "does not grant trademark rights",
  "modified mark is not the official Sestina logo",
]);
requireText(".gitattributes", ["* text=auto eol=lf", "*.png binary"]);
requireText("docs/release/THIRD-PARTY-NOTICES.md", [
  "React",
  "Model Context Protocol",
  "Zod",
  "@primno/dpapi",
  "@napi-rs/keyring",
  "smol-toml",
]);

try {
  const packageJson = JSON.parse(read("package.json"));
  if (packageJson.name !== "sestina")
    errors.push("unexpected root package name");
  if (packageJson.version !== "0.2.0")
    errors.push("public preview version must be 0.2.0");
  if (packageJson.private !== true)
    errors.push("root package must remain private");
  if (packageJson.license !== "Apache-2.0")
    errors.push("root package must use Apache-2.0");
  if (packageJson.engines?.node !== ">=24 <25")
    errors.push("Node support must remain 24.x");
  for (const script of [
    "verify:repository",
    "verify:public-history",
    "verify:public",
    "verify:platform",
  ]) {
    if (typeof packageJson.scripts?.[script] !== "string") {
      errors.push(`package.json is missing ${script}`);
    }
  }
} catch (error) {
  errors.push(
    `package.json is invalid: ${error instanceof Error ? error.message : String(error)}`,
  );
}

try {
  const license = read("LICENSE");
  if (!license.includes("Apache License") || !license.includes("Version 2.0")) {
    errors.push("LICENSE is not Apache License 2.0");
  }
} catch {
  // Missing file is already reported.
}

try {
  const logo = readFileSync(
    resolve(root, "apps/research-room/client/public/sestina-logo.png"),
  );
  const actual = createHash("sha256").update(logo).digest("hex").toUpperCase();
  const expected =
    "593661E38F3EF0AE664A4CF6E2EEEDFBA3E43D51B31A19C20E93B62E82570137";
  if (actual !== expected) errors.push(`official logo hash changed: ${actual}`);
} catch {
  errors.push("official logo could not be read");
}

requirePatterns("scripts/build-release.mjs", [
  /repositoryEntry\(\s*"LICENSE"/u,
  /repositoryEntry\(\s*"NOTICE"/u,
  /repositoryEntry\(\s*"TRADEMARKS\.md"/u,
  /repositoryEntry\(\s*"docs\/release\/THIRD-PARTY-NOTICES\.md"/u,
]);

if (errors.length > 0) {
  for (const error of errors)
    process.stderr.write(`[public repository] ${error}\n`);
  process.stderr.write(`[public repository] ${errors.length} error(s)\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    "[public repository] all public product, authority, privacy, license, and branding contracts passed\n",
  );
}
