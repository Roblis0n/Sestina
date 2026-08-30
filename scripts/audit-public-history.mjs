#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const MAX_SCANNED_BLOB_BYTES = 2 * 1024 * 1024;
const MAX_GIT_OUTPUT_BYTES = 256 * 1024 * 1024;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function git(args, input, encoding = "utf8") {
  const result = spawnSync("git", args, {
    cwd: root,
    input,
    encoding,
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`public_history_git_failed:${args[0]}`);
  }
  return result.stdout;
}

function parseObjectListing(content) {
  const pathsByObject = new Map();
  for (const line of content.split(/\r?\n/u)) {
    if (!line) continue;
    const separator = line.indexOf(" ");
    const object = separator === -1 ? line : line.slice(0, separator);
    if (!/^[a-f0-9]{40}$/u.test(object)) continue;
    if (!pathsByObject.has(object)) pathsByObject.set(object, new Set());
    if (separator !== -1) pathsByObject.get(object).add(line.slice(separator + 1));
  }
  return pathsByObject;
}

function parseBatch(buffer, onBlob) {
  let offset = 0;
  while (offset < buffer.length) {
    const newline = buffer.indexOf(0x0a, offset);
    invariant(newline !== -1, "public_history_batch_header_invalid");
    const header = buffer.subarray(offset, newline).toString("ascii");
    const match = /^([a-f0-9]{40}) blob ([0-9]+)$/u.exec(header);
    invariant(match !== null, "public_history_batch_header_invalid");
    const size = Number.parseInt(match[2], 10);
    const start = newline + 1;
    const end = start + size;
    invariant(end < buffer.length && buffer[end] === 0x0a, "public_history_batch_truncated");
    onBlob(match[1], buffer.subarray(start, end));
    offset = end + 1;
  }
}

const syntheticUsers = new Set([
  "alice",
  "bob",
  "example",
  "researcher",
  "runner",
  "someone",
  "test",
  "ubuntu",
  "user",
  "username",
]);

const syntheticSecretFixturePaths = new Set([
  "apps/cli/test/privacy-data.test.ts",
  "packages/core/test/research-object-workspaces.test.ts",
  "packages/secrets/test/secret-scanner-edge.test.ts",
]);
const syntheticPersonalPathFixturePaths = new Set([
  "integrations/mcp/test/security-content-boundary.test.ts",
  "packages/contracts/src/summarize.ts",
  "packages/reports/test/reports.test.ts",
  "packages/storage/src/exports.ts",
  "tests/integration/research-core-lifecycle.test.ts",
]);

const secretPatterns = Object.freeze([
  ["private_key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ["github_token", /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/u],
  ["provider_api_key", /(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,})/u],
  ["aws_access_key", /AKIA[0-9A-Z]{16}/u],
  ["slack_token", /xox[baprs]-[A-Za-z0-9-]{20,}/u],
]);

const forbiddenPath = /(?:^|\/)(?:\.sestina|\.frozen-local)(?:\/|$)|(?:^|\/)\.codex\/attachments(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|p12|pfx|sqlite|sqlite3|db|log)$/iu;
const binaryExtensions = new Set([
  ".avif",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".node",
  ".pdf",
  ".png",
  ".ttf",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
]);

const findings = new Map();
function report(code, object, paths) {
  const path = [...paths].sort((left, right) => left.localeCompare(right, "en"))[0] ?? "<unpathed>";
  findings.set(`${code}:${path}`, { code, object, path });
}

function allPathsAllowed(paths, allowlist) {
  return paths.size > 0 && [...paths].every((path) => allowlist.has(path));
}

function scanPersonalPaths(text, object, paths) {
  if (allPathsAllowed(paths, syntheticPersonalPathFixturePaths)) return;
  const normalized = text.replaceAll("\\\\", "\\");
  const patterns = [
    /[A-Za-z]:[\\/]Users[\\/]([A-Za-z0-9._-]+)/giu,
    /\/Users\/([A-Za-z0-9._-]+)/gu,
    /\/home\/([A-Za-z0-9._-]+)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      if (!syntheticUsers.has(match[1].toLowerCase())) {
        report("personal_profile_path", object, paths);
      }
    }
  }
}

const remote = git(["remote", "get-url", "origin"]).trim();
invariant(
  remote === "https://github.com/Roblis0n/Sestina.git",
  "public_history_remote_invalid",
);

const listing = git(["rev-list", "--objects", "--all"]);
const pathsByObject = parseObjectListing(listing);
for (const [object, paths] of pathsByObject) {
  for (const path of paths) {
    if (forbiddenPath.test(path.replaceAll("\\", "/"))) {
      report("private_or_sensitive_file_path", object, paths);
    }
  }
}

const objects = [...pathsByObject.keys()];
const metadata = git(
  ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
  `${objects.join("\n")}\n`,
);
const scanObjects = [];
let largeBinaryBlobCount = 0;
for (const line of metadata.split(/\r?\n/u)) {
  if (!line) continue;
  const match = /^([a-f0-9]{40}) ([a-z]+) ([0-9]+)$/u.exec(line);
  invariant(match !== null, "public_history_metadata_invalid");
  if (match[2] !== "blob") continue;
  const size = Number.parseInt(match[3], 10);
  if (size <= MAX_SCANNED_BLOB_BYTES) {
    scanObjects.push(match[1]);
  } else {
    const paths = pathsByObject.get(match[1]) ?? new Set();
    const allKnownBinary =
      paths.size > 0 &&
      [...paths].every((path) => binaryExtensions.has(extname(path).toLowerCase()));
    if (!allKnownBinary) report("oversized_unscanned_blob", match[1], paths);
    else largeBinaryBlobCount += 1;
  }
}

const batch = git(
  ["cat-file", "--batch"],
  Buffer.from(`${scanObjects.join("\n")}\n`),
  null,
);
parseBatch(batch, (object, bytes) => {
  if (bytes.includes(0)) return;
  const text = bytes.toString("utf8");
  const paths = pathsByObject.get(object) ?? new Set();
  for (const [code, pattern] of secretPatterns) {
    if (
      pattern.test(text) &&
      !allPathsAllowed(paths, syntheticSecretFixturePaths)
    ) {
      report(code, object, paths);
    }
  }
  scanPersonalPaths(text, object, paths);
});

const rootLicense = await readFile(resolve(root, "LICENSE"), "utf8");
invariant(
  rootLicense.includes("Apache License") &&
    rootLicense.includes("Version 2.0, January 2004"),
  "public_history_root_license_invalid",
);
const notices = await readFile(
  resolve(root, "docs/release/THIRD-PARTY-NOTICES.md"),
  "utf8",
);
invariant(
  notices.includes("@primno/dpapi") &&
    notices.includes("@napi-rs/keyring") &&
    notices.includes("OpenMythos"),
  "public_history_third_party_notices_incomplete",
);

const vendoredLicensePath = resolve(
  root,
  "OpenMythos-main (1)",
  "OpenMythos-main",
  "LICENSE",
);
if ((await stat(vendoredLicensePath)).isFile()) {
  const vendoredLicense = await readFile(vendoredLicensePath, "utf8");
  invariant(
    vendoredLicense.startsWith("MIT License") &&
      vendoredLicense.includes("Copyright (c) 2026 Kye Gomez"),
    "public_history_vendored_license_invalid",
  );
}

if (findings.size > 0) {
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      error: "public_history_safety_failed",
      findings: [...findings.values()].sort((left, right) =>
        `${left.code}:${left.path}`.localeCompare(`${right.code}:${right.path}`, "en"),
      ),
    })}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      reachableObjects: objects.length,
      scannedBlobs: scanObjects.length,
      acceptedLargeBinaryBlobs: largeBinaryBlobCount,
      remote,
      license: "Apache-2.0",
      vendoredLicense: "MIT",
    })}\n`,
  );
}
