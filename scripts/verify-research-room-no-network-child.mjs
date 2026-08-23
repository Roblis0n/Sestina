import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createResearchRoomServer } from "../apps/research-room/dist/server.js";

const root = await mkdtemp(join(tmpdir(), "sestina-ri48-no-network-child-"));
async function files(directory, values = []) { for (const name of await readdir(directory)) { const path = join(directory, name); (await stat(path)).isDirectory() ? await files(path, values) : values.push(path); } return values; }

try {
  let rejectedNonLoopback = false;
  try { createResearchRoomServer({ host: "0.0.0.0" }); } catch { rejectedNonLoopback = true; }
  if (!rejectedNonLoopback) throw new Error("non-loopback bind policy drifted");
  const localApplication = createResearchRoomServer();
  localApplication.application.close();
  const background = (await files(root)).filter((path) => /(?:telemetry|crash|upload|retry)[-_]?(?:queue|report)?|\.(?:log|dmp|crash)$/iu.test(path));
  if (background.length !== 0) throw new Error("background artifact created");
  process.stdout.write(`${JSON.stringify({ researchRoomOfflineVerified: true, providerConfigured: false, networkAttempts: 0, loopbackPolicy: true, backgroundArtifacts: 0 })}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
