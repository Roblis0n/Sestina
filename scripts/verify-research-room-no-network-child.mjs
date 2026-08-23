import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createResearchRoomServer } from "../apps/research-room/dist/server.js";

const root = await mkdtemp(join(tmpdir(), "sestina-ri48-no-network-child-"));
async function files(directory, values = []) { for (const name of await readdir(directory)) { const path = join(directory, name); (await stat(path)).isDirectory() ? await files(path, values) : values.push(path); } return values; }
async function request(application, token, path, body) {
  const input = Buffer.from(JSON.stringify(body), "utf8");
  const incoming = Readable.from([input]);
  Object.assign(incoming, { method: "POST", url: path, headers: { host: "127.0.0.1", "x-sestina-session": token } });
  let status = 0; let payload = "";
  const response = {
    writeHead(value) { status = value; },
    end(value = "") { payload += String(value); },
  };
  await application.handle(incoming, response);
  return { status, body: JSON.parse(payload) };
}

try {
  let rejectedNonLoopback = false;
  try { createResearchRoomServer({ host: "0.0.0.0" }); } catch { rejectedNonLoopback = true; }
  if (!rejectedNonLoopback) throw new Error("non-loopback bind policy drifted");
  const localApplication = createResearchRoomServer({ directoryPicker: { pick: () => Promise.resolve(root) } });
  const canary = join(root, "existing-research-canary.txt");
  await writeFile(canary, "unchanged\n", "utf8");
  const opened = await request(localApplication.application, localApplication.application.sessionToken, "/api/project/select-directory", {});
  if (opened.status !== 200 || opened.body?.value?.initialized !== true || opened.body?.value?.setupRequired !== true) throw new Error("offline browser initialization failed");
  if (opened.body?.value?.selected !== true || JSON.stringify(opened.body).includes(root)) throw new Error("native picker privacy contract drifted");
  const activated = await request(localApplication.application, localApplication.application.sessionToken, "/api/project/brief", { projectQuestion: "Can local first use remain offline?", currentTask: "Verify browser initialization without outbound traffic." });
  if (activated.status !== 200 || activated.body?.value?.brief?.projectQuestion !== "Can local first use remain offline?") throw new Error("offline initial Brief activation failed");
  if (await readFile(canary, "utf8") !== "unchanged\n") throw new Error("existing project file changed");
  localApplication.application.close();
  const background = (await files(root)).filter((path) => /(?:telemetry|crash|upload|retry)[-_]?(?:queue|report)?|\.(?:log|dmp|crash)$/iu.test(path));
  if (background.length !== 0) throw new Error("background artifact created");
  process.stdout.write(`${JSON.stringify({ researchRoomOfflineVerified: true, browserInitializationVerified: true, nativePickerFlowVerified: true, initialBriefActivationVerified: true, providerConfigured: false, networkAttempts: 0, loopbackPolicy: true, backgroundArtifacts: 0 })}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
