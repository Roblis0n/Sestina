import { lstat, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  SESTINA_SKILL_BUNDLE_HASH,
  SESTINA_SKILL_GENERATED_FILES,
  SESTINA_SKILL_KNOWN_BUNDLE_HASHES,
} from "@sestina/skills";

export const CODEX_SKILL_RELATIVE_ROOT = ".agents/skills/sestina-research-integrity";
export const CODEX_SKILL_RELATIVE_FILES = Object.freeze([
  `${CODEX_SKILL_RELATIVE_ROOT}/SKILL.md`,
  `${CODEX_SKILL_RELATIVE_ROOT}/agents/openai.yaml`,
] as const);

export type CodexSkillStatus = "not_configured" | "configured" | "drifted" | "conflict";
export type CodexSkillOwnership = "none" | "current" | "known_previous" | "foreign";

function bundleHash(skill: string, metadata: string): string {
  return createHash("sha256").update(skill, "utf8").update("\0", "utf8").update(metadata, "utf8").digest("hex");
}

async function pathKind(path: string): Promise<"missing" | "file" | "directory" | "other"> {
  try {
    const value = await lstat(path);
    if (value.isFile() || value.isSymbolicLink()) return "file";
    if (value.isDirectory()) return "directory";
    return "other";
  } catch {
    return "missing";
  }
}

async function names(path: string): Promise<readonly string[] | undefined> {
  try { return (await readdir(path)).toSorted(); } catch { return undefined; }
}

export async function inspectCodexSkill(projectRoot: string): Promise<{ readonly status: CodexSkillStatus; readonly ownership: CodexSkillOwnership }> {
  const root = join(projectRoot, ...CODEX_SKILL_RELATIVE_ROOT.split("/"));
  const rootKind = await pathKind(root);
  if (rootKind === "missing") return { status: "not_configured", ownership: "none" };
  if (rootKind !== "directory") return { status: "conflict", ownership: "foreign" };
  const rootNames = await names(root);
  if (rootNames === undefined) return { status: "conflict", ownership: "foreign" };
  if (rootNames.some((name) => name !== "SKILL.md" && name !== "agents")) return { status: "conflict", ownership: "foreign" };

  const agentsPath = join(root, "agents");
  const agentsKind = await pathKind(agentsPath);
  if (agentsKind !== "missing" && agentsKind !== "directory") return { status: "conflict", ownership: "foreign" };
  if (agentsKind === "directory") {
    const agentNames = await names(agentsPath);
    if (agentNames === undefined || agentNames.some((name) => name !== "openai.yaml")) return { status: "conflict", ownership: "foreign" };
  }

  const expected = SESTINA_SKILL_GENERATED_FILES as Readonly<Record<string, string>>;
  const actual = new Map<string, string>();
  let missingOrDrifted = false;
  for (const [relativePath, content] of Object.entries(expected)) {
    const target = join(root, ...relativePath.split("/"));
    if (await pathKind(target) !== "file") { missingOrDrifted = true; continue; }
    try {
      const value = await readFile(target, "utf8");
      actual.set(relativePath, value);
      if (value !== content) missingOrDrifted = true;
    } catch {
      return { status: "conflict", ownership: "foreign" };
    }
  }
  if (!missingOrDrifted) return { status: "configured", ownership: "current" };
  const skill = actual.get("SKILL.md");
  const metadata = actual.get("agents/openai.yaml");
  if (skill !== undefined && metadata !== undefined) {
    const hash = bundleHash(skill, metadata);
    if (hash === SESTINA_SKILL_BUNDLE_HASH) return { status: "configured", ownership: "current" };
    if (SESTINA_SKILL_KNOWN_BUNDLE_HASHES.includes(hash)) return { status: "drifted", ownership: "known_previous" };
  }
  return { status: "drifted", ownership: "foreign" };
}

export function codexSkillFiles(projectRoot: string): readonly { readonly relativePath: string; readonly path: string; readonly content: string }[] {
  const root = join(projectRoot, ...CODEX_SKILL_RELATIVE_ROOT.split("/"));
  return Object.entries(SESTINA_SKILL_GENERATED_FILES).map(([relativePath, content]) => ({
    relativePath: `${CODEX_SKILL_RELATIVE_ROOT}/${relativePath}`,
    path: join(root, ...relativePath.split("/")),
    content,
  }));
}
