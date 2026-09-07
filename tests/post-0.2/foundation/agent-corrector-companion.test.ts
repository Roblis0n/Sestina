import { expect,it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { checkGeneratedSkill } from "../../../integrations/skills/generate.js";
import { CODEX_AGENT_CORRECTOR_SKILL,AGENT_CORRECTOR_REFERENCE_FILES } from "../../../integrations/skills/src/index.js";

it("G7: the merged companion remains generated, ephemeral and explicitly draft-only",async()=>{
  const root=resolve("integrations/skills");
  await expect(checkGeneratedSkill(root)).resolves.toEqual({ok:true,drifted:[]});
  expect((await readFile(resolve(root,"canonical/agent-corrector/SKILL.md"),"utf8")).replaceAll("\r\n","\n")).toBe(CODEX_AGENT_CORRECTOR_SKILL);
  expect(CODEX_AGENT_CORRECTOR_SKILL).toContain("A user must explicitly request the");
  expect(CODEX_AGENT_CORRECTOR_SKILL).toContain("MCP surface is read-only");
  expect(CODEX_AGENT_CORRECTOR_SKILL).toContain("Do not retry submission");
  expect(CODEX_AGENT_CORRECTOR_SKILL).toContain("not a committed research change");
  expect(Object.keys(AGENT_CORRECTOR_REFERENCE_FILES).length).toBeGreaterThan(0);
});
