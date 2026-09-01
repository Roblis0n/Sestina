import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  copyFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CHECKS,
  CONTRACT_DIR,
  REQUIRED_CONTRACTS,
  REQUIRED_RECORDS,
  validateContracts,
} from "../../scripts/verify-post-0.2-contracts.mjs";

interface ResultLike {
  ok: boolean;
  errors: readonly { readonly check: string; readonly message: string }[];
}

const TEST_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(TEST_FILE), "..", "..");
const CONTRACTS_SOURCE = join(REPO_ROOT, "docs", "product", "restructure");
const VERIFIER = join(REPO_ROOT, "scripts", "verify-post-0.2-contracts.mjs");

/**
 * Copies the real contract set into a fresh temporary directory. Tests mutate
 * the copy; the repository contracts are never touched.
 */
function loadRealContracts(
  targetRoot: string,
): Record<string, Record<string, unknown>> {
  const docs: Record<string, Record<string, unknown>> = {};
  for (const file of REQUIRED_RECORDS) {
    copyFileSync(join(CONTRACTS_SOURCE, file), join(targetRoot, file));
  }
  for (const file of REQUIRED_CONTRACTS) {
    const source = join(CONTRACTS_SOURCE, CONTRACT_DIR, file);
    const target = join(targetRoot, CONTRACT_DIR, file);
    mkdirSync(join(targetRoot, CONTRACT_DIR), { recursive: true });
    copyFileSync(source, target);
    docs[file] = JSON.parse(readFileSync(source, "utf8")) as Record<
      string,
      unknown
    >;
  }
  return docs;
}

function writeContracts(
  targetRoot: string,
  docs: Record<string, Record<string, unknown>>,
): void {
  for (const [file, doc] of Object.entries(docs)) {
    writeFileSync(
      join(targetRoot, CONTRACT_DIR, file),
      `${JSON.stringify(doc, null, 2)}\n`,
      "utf8",
    );
  }
}

function failChecks(result: ResultLike): string[] {
  return result.errors.map((error) => error.check);
}

describe("post-0.2 contract verification", () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "sestina-contracts-"));
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("1. a complete, consistent contract set passes", () => {
    const target = join(tmp, "pass");
    mkdirSync(target, { recursive: true });
    loadRealContracts(target);
    const result = validateContracts({
      repoRoot: REPO_ROOT,
      contractsRoot: target,
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("2. a canonical effect without an authority rule fails", () => {
    const target = join(tmp, "no-authority");
    mkdirSync(target, { recursive: true });
    const docs = loadRealContracts(target);
    const effects = docs["01-canonical-effects.json"] as {
      effects: Record<string, unknown>[];
    };
    delete effects.effects[0].authority;
    writeContracts(target, docs);
    const result = validateContracts({
      repoRoot: REPO_ROOT,
      contractsRoot: target,
    });
    expect(result.ok).toBe(false);
    expect(failChecks(result)).toContain(CHECKS.EFFECT_AUTHORITY);
  });

  it("3. a Review transition into an unknown state fails", () => {
    const target = join(tmp, "unknown-state");
    mkdirSync(target, { recursive: true });
    const docs = loadRealContracts(target);
    const lifecycle = docs["02-review-lifecycle.json"] as {
      transitions: Record<string, unknown>[];
    };
    lifecycle.transitions.push({
      from: "committed",
      to: "state_that_does_not_exist",
      command: "never_legal",
      initiator: "nobody",
      requiresUserAdjudication: false,
    });
    writeContracts(target, docs);
    const result = validateContracts({
      repoRoot: REPO_ROOT,
      contractsRoot: target,
    });
    expect(result.ok).toBe(false);
    expect(failChecks(result)).toContain(CHECKS.REVIEW_UNKNOWN_STATE);
  });

  it("4. a missing projectStateRevision increment rule fails", () => {
    const target = join(tmp, "missing-revision-rule");
    mkdirSync(target, { recursive: true });
    const docs = loadRealContracts(target);
    const revision = docs["03-project-state-revision.json"] as {
      increments: Record<string, unknown>;
    };
    delete revision.increments.create_decision;
    writeContracts(target, docs);
    const result = validateContracts({
      repoRoot: REPO_ROOT,
      contractsRoot: target,
    });
    expect(result.ok).toBe(false);
    expect(failChecks(result)).toContain(CHECKS.CROSS_EFFECT_REVISION);
  });

  it("5. a Manifest without canonicalization or hash rules fails", () => {
    const target = join(tmp, "manifest-incomplete");
    mkdirSync(target, { recursive: true });
    const docs = loadRealContracts(target);
    const manifest = docs["04-context-manifest-identity.json"];
    if (manifest === undefined) {
      throw new Error("Manifest contract fixture is missing.");
    }
    delete manifest.canonicalization;
    delete manifest.hashAlgorithm;
    writeContracts(target, docs);
    const result = validateContracts({
      repoRoot: REPO_ROOT,
      contractsRoot: target,
    });
    expect(result.ok).toBe(false);
    expect(failChecks(result)).toContain(CHECKS.MANIFEST_CANONICALIZATION);
    expect(failChecks(result)).toContain(CHECKS.MANIFEST_HASH);
  });

  it("6. an unresolved code-verification item fails", () => {
    const target = join(tmp, "cv-unresolved");
    mkdirSync(target, { recursive: true });
    const docs = loadRealContracts(target);
    const cv = docs["08-requires-code-verification.json"] as {
      items: Record<string, unknown>[];
    };
    cv.items[0].unresolved = true;
    writeContracts(target, docs);
    const result = validateContracts({
      repoRoot: REPO_ROOT,
      contractsRoot: target,
    });
    expect(result.ok).toBe(false);
    expect(failChecks(result)).toContain(CHECKS.CV_RESOLVED);
  });

  it("7. a code-verification evidence path that does not exist fails", () => {
    const target = join(tmp, "cv-missing-evidence");
    mkdirSync(target, { recursive: true });
    const docs = loadRealContracts(target);
    const cv = docs["08-requires-code-verification.json"] as {
      items: { evidence: Record<string, unknown>[] }[];
    };
    cv.items[0].evidence[0].path =
      "packages/core/src/does-not-exist-anywhere.ts";
    writeContracts(target, docs);
    const result = validateContracts({
      repoRoot: REPO_ROOT,
      contractsRoot: target,
    });
    expect(result.ok).toBe(false);
    expect(failChecks(result)).toContain(CHECKS.CV_EVIDENCE_EXISTS);
  });

  it("8. a personal absolute path in the contracts fails", () => {
    const target = join(tmp, "absolute-path");
    mkdirSync(target, { recursive: true });
    const docs = loadRealContracts(target);
    const terminology = docs["07-terminology.json"] as {
      terms: { definition: string }[];
    };
    const personalPath = ["C:", "Users", "someone", "notes.txt"].join("\\");
    terminology.terms[0].definition = `${terminology.terms[0].definition} ${personalPath}`;
    writeContracts(target, docs);
    const result = validateContracts({
      repoRoot: REPO_ROOT,
      contractsRoot: target,
    });
    expect(result.ok).toBe(false);
    expect(failChecks(result)).toContain(CHECKS.ABSOLUTE_PATH);
  });

  it("9. forbidden placeholder tokens in the contracts fail", () => {
    const target = join(tmp, "placeholder");
    mkdirSync(target, { recursive: true });
    const docs = loadRealContracts(target);
    const terminology = docs["07-terminology.json"] as {
      terms: { definition: string }[];
    };
    const forbiddenToken = ["TO", "DO"].join("");
    terminology.terms[0].definition = `${terminology.terms[0].definition} ${forbiddenToken}: refine later.`;
    writeContracts(target, docs);
    const result = validateContracts({
      repoRoot: REPO_ROOT,
      contractsRoot: target,
    });
    expect(result.ok).toBe(false);
    expect(failChecks(result)).toContain(CHECKS.FORBIDDEN_TOKEN);
  });

  it("10. the CLI exits non-zero when verification fails", () => {
    const target = join(tmp, "cli-failure");
    mkdirSync(target, { recursive: true });
    const docs = loadRealContracts(target);
    const cv = docs["08-requires-code-verification.json"] as {
      items: Record<string, unknown>[];
    };
    cv.items[3].unresolved = true;
    writeContracts(target, docs);
    const spawned = spawnSync(
      process.execPath,
      [VERIFIER, "--repo-root", REPO_ROOT, "--contracts-root", target],
      {
        encoding: "utf8",
      },
    );
    expect(spawned.error).toBeUndefined();
    expect(spawned.status).not.toBe(0);
    expect(spawned.stdout).toContain("FAILED");
  });

  it("11. every verified code-verification evidence path resolves inside the repository", () => {
    const target = join(tmp, "evidence-audit");
    mkdirSync(target, { recursive: true });
    const docs = loadRealContracts(target);
    const cv = docs["08-requires-code-verification.json"] as {
      items: {
        id: string;
        evidence: { path: string; symbol: string }[];
      }[];
    };
    expect(cv.items.length).toBe(7);
    for (const item of cv.items) {
      for (const evidence of item.evidence) {
        expect(
          existsSync(join(REPO_ROOT, evidence.path)),
          `${item.id}: evidence path must exist: ${evidence.path}`,
        ).toBe(true);
      }
    }
  });
});
