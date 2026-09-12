import { it, expect } from "vitest";
import ts from "typescript";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { confirmationCopy } from "../../apps/desktop/src/native-copy.js";

// Deliberately limited to new transport and desktop code. Historical readers,
// immutable samples and canonical DecisionStatus.accepted are not renamed.
function oldPermissionLiterals(source: string) {
  const tree = ts.createSourceFile("candidate.ts", source, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isStringLiteralLike(node) && ["semantic_ready", "ledger_only", "modified_accepted", "accepted"].includes(node.text)) violations.push(node.text);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return violations;
}

it("distinguishes executable old permission labels from comments and historical explanations", () => {
  expect(oldPermissionLiterals('if (reply.status === "semantic_ready") commit();')).toEqual(["semantic_ready"]);
  expect(oldPermissionLiterals('const disposition = "accepted"; save(disposition);')).toEqual(["accepted"]);
  expect(oldPermissionLiterals('// historical semantic_ready is not authority\nconst help = "History preserves the original ledger_only label.";')).toEqual([]);
  expect(oldPermissionLiterals('const kind = "record_only"; const available = false;')).toEqual([]);
});

it("keeps the new desktop and shared application paths free of old permission drivers", async () => {
  const checked: string[] = [];
  async function scan(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await scan(path);
      else if (entry.name.endsWith(".ts")) {
        expect(oldPermissionLiterals(await readFile(path, "utf8")), path).toEqual([]);
        checked.push(path);
      }
    }
  }
  for (const directory of ["apps/desktop/src", "packages/application/src", "packages/application-ports/src"]) await scan(directory);
  expect(checked.length).toBeGreaterThan(10);
});

it("keeps bilingual native confirmation claims within the frozen terminology contract", async () => {
  const contract = JSON.parse(await readFile("docs/product/restructure/contracts/07-terminology.json", "utf8")) as { forbiddenOverclaims: string[] };
  for (const language of ["en", "zh-CN"]) for (const action of ["commit", "start_attempt", "govern_memory", "privacy_cleanup", "enable_host_bridge"]) {
    const copy = confirmationCopy({ action, projectId: "synthetic", bindingHash: "a".repeat(64), snapshot: {} }, language);
    for (const forbidden of contract.forbiddenOverclaims) expect(copy.message + "\n" + copy.detail).not.toContain(forbidden);
    expect(copy.message).not.toMatch(/赋能|智能驱动|高质量闭环|深度洞察/);
    expect(copy.buttons.every(button => Boolean(button?.trim()))).toBe(true);
  }
});
