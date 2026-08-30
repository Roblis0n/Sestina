#!/usr/bin/env node

import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
let repositoryRoot = resolve(scriptDirectory, "..");
let ref = "HEAD";

for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] === "--root" && argv[index + 1]) {
    repositoryRoot = resolve(argv[index + 1]);
    index += 1;
  } else if (argv[index] === "--ref" && argv[index + 1]) {
    ref = argv[index + 1];
    index += 1;
  } else {
    throw new Error(
      "Usage: node scripts/audit-public-history.mjs [--root <repository>] [--ref <git-ref>]",
    );
  }
}

const failures = [];
const checked = {
  commits: 0,
  roots: 0,
  trees: 0,
  paths: 0,
  blobs: 0,
  bytes: 0,
};

function fail(message) {
  failures.push(message);
}

function git(args, options = {}) {
  const result = spawnSync("git", ["-C", repositoryRoot, ...args], {
    encoding: options.binary ? null : "utf8",
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : result.stderr;
    throw new Error(
      `git ${args.join(" ")} failed: ${stderr?.trim() ?? "unknown error"}`,
    );
  }
  return result.stdout;
}

function lines(value) {
  return String(value)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function contentAt(path) {
  return String(git(["show", `${ref}:${path}`]));
}

function requirePath(path) {
  try {
    git(["cat-file", "-e", `${ref}:${path}`]);
  } catch {
    fail(`required public file is missing: ${path}`);
  }
}

const topLevel = String(git(["rev-parse", "--show-toplevel"])).trim();
if (resolve(topLevel) !== repositoryRoot) {
  fail(`audit root mismatch: expected ${repositoryRoot}, got ${topLevel}`);
}

try {
  git(["rev-parse", "--verify", ref]);
} catch {
  fail(`public ref does not exist: ${ref}`);
}

const roots = lines(git(["rev-list", "--max-parents=0", ref]));
checked.roots = roots.length;
if (roots.length !== 1) {
  fail(
    `public history must have exactly one root commit; found ${roots.length}`,
  );
}

const privateEmail =
  ["Roblison", "7216"].join("") + "@" + ["gmail", "com"].join(".");
const commitStream = String(
  git(["log", "--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e", ref]),
);
for (const record of commitStream.split("\x1e").filter((item) => item.trim())) {
  const [
    hash,
    authorName,
    authorEmail,
    committerName,
    committerEmail,
    message,
  ] = record.replace(/^\s+/u, "").split("\x1f");
  checked.commits += 1;
  for (const [role, email] of [
    ["author", authorEmail],
    ["committer", committerEmail],
  ]) {
    if (email?.toLowerCase() === privateEmail.toLowerCase()) {
      fail(`${hash}: ${role} email is private`);
    }
  }
  const metadataText = [authorName, committerName, message].join("\n");
  if (metadataText.includes(privateEmail)) {
    fail(`${hash}: commit metadata contains a private email`);
  }
}

if (roots.length === 1) {
  const rootEmail = String(
    git(["show", "-s", "--format=%ae", roots[0]]),
  ).trim();
  if (!rootEmail.toLowerCase().endsWith("@users.noreply.github.com")) {
    fail("public root commit must use a GitHub noreply author address");
  }
  const rootCommitter = String(
    git(["show", "-s", "--format=%ce", roots[0]]),
  ).trim();
  if (!rootCommitter.toLowerCase().endsWith("@users.noreply.github.com")) {
    fail("public root commit must use a GitHub noreply committer address");
  }
}

const forbiddenPathFragments = [
  ["docs", "execution"].join("/"),
  ["docs", "history"].join("/"),
  ["docs", "pivot-inputs"].join("/"),
  ["docs", "product-exploration"].join("/"),
  ["Open", "Mythos-main"].join(""),
  ["sp", "ikes"].join(""),
  [".frozen", "-local"].join(""),
];
const forbiddenExactPaths = new Set([
  ["CLA", "UDE.md"].join(""),
  ["hand", "off.md"].join(""),
  ["HANDOFF", "-FOR-CLAUDE-CODE.md"].join(""),
  ["HANDOFF", "-FOR-NEXT-CONVERSATION.md"].join(""),
  ["SESTINA-AGENT-MODES-MEMORY", "-AND-DELIBERATION-DESIGN.md"].join(""),
]);
const forbiddenFilePattern =
  /(^|\/)(?:\.env(?:\..+)?|\.sestina(?:\/|$)|[^/]+\.(?:db|sqlite|sqlite3|log|pem|key|p12|pfx))$/iu;

function checkPath(path) {
  const normalized = path.replaceAll("\\", "/");
  if (forbiddenExactPaths.has(normalized)) {
    fail(`internal-only path is present: ${normalized}`);
  }
  for (const fragment of forbiddenPathFragments) {
    if (normalized === fragment || normalized.startsWith(`${fragment}/`)) {
      fail(`internal-only path is present: ${normalized}`);
    }
  }
  if (forbiddenFilePattern.test(normalized)) {
    fail(`private or generated data path is present: ${normalized}`);
  }
  return normalized;
}

const treeOids = new Set(lines(git(["log", "--format=%T", ref])));
checked.trees = treeOids.size;
const seenEntries = new Set();
const pathByObject = new Map();
for (const treeOid of treeOids) {
  const tree = Buffer.from(
    git(["ls-tree", "-r", "-z", "--full-tree", treeOid], { binary: true }),
  );
  const entries = tree
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const separator = record.indexOf("\t");
      const header = record.slice(0, separator).split(" ");
      return {
        mode: header[0],
        type: header[1],
        oid: header[2],
        path: record.slice(separator + 1),
      };
    });

  for (const entry of entries) {
    const entryKey = `${entry.mode}\0${entry.oid}\0${entry.path}`;
    if (seenEntries.has(entryKey)) continue;
    seenEntries.add(entryKey);
    checked.paths += 1;
    const normalized = checkPath(entry.path);
    if (entry.mode === "120000") {
      fail(
        `symbolic links are not allowed in public history: ${normalized}`,
      );
    }
    if (entry.type === "blob" && !pathByObject.has(entry.oid)) {
      pathByObject.set(entry.oid, normalized);
    }
  }
}

const knownWindowsWorkspace = new RegExp(
  ["D:", "[\\\\/]", "Codex", "[ ]", "work", "[\\\\/]", "Sestina"].join(""),
  "iu",
);
const knownMirrorWorkspace = new RegExp(
  ["F:", "[\\\\/]", "Vibe", "[\\\\/]", "Sestina"].join(""),
  "iu",
);
const knownUserHome = new RegExp(
  ["C:", "[\\\\/]", "Users", "[\\\\/]", "Dr", "\\.", "J"].join(""),
  "iu",
);
const privateAttachment = new RegExp(
  ["\\.codex", "[\\\\/]", "attachments"].join(""),
  "iu",
);
const secretPatterns = [
  [
    "private_key",
    new RegExp(
      [
        "-----BEGIN ",
        "((?:RSA |EC |OPENSSH )?)",
        "PRIVATE KEY-----",
        "[\\s\\S]{40,}",
        "-----END ",
        "\\1",
        "PRIVATE KEY-----",
      ].join(""),
      "u",
    ),
  ],
  ["github_token", new RegExp(["gh", "[ps]_[A-Za-z0-9]{30,}"].join(""), "u")],
  [
    "github_fine_grained_token",
    new RegExp(["github", "_pat_[A-Za-z0-9_]{40,}"].join(""), "u"),
  ],
  [
    "openai_style_secret",
    new RegExp(
      ["(?<![A-Za-z0-9])", "s", "k-(?!test-)[A-Za-z0-9_-]{32,}"].join(""),
      "u",
    ),
  ],
  ["aws_access_key", new RegExp(["AK", "IA[0-9A-Z]{16}"].join(""), "u")],
  [
    "slack_token",
    new RegExp(["xo", "x[baprs]-[A-Za-z0-9-]{20,}"].join(""), "u"),
  ],
];
const documentedSyntheticSecrets = [
  "ghp_0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJ",
  "AKIAIOSFODNN7EXAMPLE",
];

function checkSensitiveText(label, rawText) {
  const text = documentedSyntheticSecrets.reduce(
    (content, syntheticSecret) =>
      content.replaceAll(syntheticSecret, "[documented-synthetic-secret]"),
    rawText,
  );
  if (text.toLowerCase().includes(privateEmail.toLowerCase()))
    fail(`${label}: contains a private email`);
  if (knownWindowsWorkspace.test(text))
    fail(`${label}: contains a private workspace path`);
  if (knownMirrorWorkspace.test(text))
    fail(`${label}: contains a private mirror path`);
  if (knownUserHome.test(text))
    fail(`${label}: contains a private user-home path`);
  if (privateAttachment.test(text))
    fail(`${label}: contains a private attachment path`);
  for (const [secretLabel, pattern] of secretPatterns) {
    if (pattern.test(text)) fail(`${label}: contains a ${secretLabel} pattern`);
    pattern.lastIndex = 0;
  }
}

for (const record of commitStream.split("\x1e").filter((item) => item.trim())) {
  const [hash, authorName, authorEmail, committerName, committerEmail, message] =
    record.replace(/^\s+/u, "").split("\x1f");
  checkSensitiveText(
    `${hash}: commit metadata`,
    [authorName, authorEmail, committerName, committerEmail, message].join("\n"),
  );
}

for (const [oid, path] of pathByObject) {
  const bytes = Buffer.from(git(["cat-file", "blob", oid], { binary: true }));
  checked.blobs += 1;
  checked.bytes += bytes.length;
  const views = [
    bytes.toString("utf8"),
    bytes.toString("latin1"),
    bytes.length % 2 === 0 ? bytes.toString("utf16le") : "",
  ];
  for (const rawText of new Set(views)) {
    if (!rawText) continue;
    checkSensitiveText(path, rawText);
  }
}

const requiredPublicFiles = [
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
  "docs/i18n/README.zh-CN.md",
  "docs/i18n/README.ja.md",
  "docs/i18n/README.es.md",
  "docs/i18n/README.fr.md",
  "docs/i18n/README.de.md",
  "docs/release/THIRD-PARTY-NOTICES.md",
  "apps/research-room/client/public/sestina-logo.png",
];
for (const path of requiredPublicFiles) requirePath(path);

try {
  const packageJson = JSON.parse(contentAt("package.json"));
  if (packageJson.private !== true)
    fail(
      "root package must remain private to prevent accidental npm publication",
    );
  if (packageJson.license !== "Apache-2.0")
    fail("root package license must be Apache-2.0");
} catch (error) {
  fail(
    `package.json could not be validated: ${error instanceof Error ? error.message : String(error)}`,
  );
}

try {
  const license = contentAt("LICENSE");
  if (!license.includes("Apache License") || !license.includes("Version 2.0")) {
    fail("LICENSE is not the Apache License 2.0 text");
  }
} catch {
  // Missing-file failure is reported above.
}

try {
  const logo = Buffer.from(
    git(["show", `${ref}:apps/research-room/client/public/sestina-logo.png`], {
      binary: true,
    }),
  );
  const hash = createHash("sha256").update(logo).digest("hex").toUpperCase();
  const expected =
    "593661E38F3EF0AE664A4CF6E2EEEDFBA3E43D51B31A19C20E93B62E82570137";
  if (hash !== expected) fail(`official logo hash changed: ${hash}`);
} catch {
  // Missing-file failure is reported above.
}

const report = {
  ok: failures.length === 0,
  ref,
  ...checked,
  failures,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
