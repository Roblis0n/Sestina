import { it, expect } from "vitest";
import { createKernelOpenAICompatibleProvider } from "../../../packages/application/src/openai-compatible-provider.js";
import { createPinnedProviderFetch, providerAddressAllowed, resolveProviderEndpoint } from "../../../packages/application/src/provider-transport.js";
import { createServer } from "node:http";
import { createResearchRoomServer } from "../../../apps/research-room/src/server.js";
import { ProviderConfigurationService, createFileProviderConfigStore } from "../../../packages/application/src/provider-settings.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
it("deleting configuration and restarting cannot reuse an old Manifest generation", async () => {
  const root = await mkdtemp(join(tmpdir(), "sestina-provider-generation-"));
  const store = () => createFileProviderConfigStore({ filePath: join(root, "provider.json") });
  const secrets = { health: async () => ({ available: false, backend: "none" as const }), describe: async () => ({ configured: false }), get: async () => undefined, set: async () => {}, delete: async () => {} };
  const input = { providerId: "synthetic", model: "synthetic", baseUrl: "http://127.0.0.1:22222", timeoutMs: 1000 };
  try { const first = new ProviderConfigurationService(store(), secrets); const original = await first.save(input); await first.deleteConfig(); const reopened = new ProviderConfigurationService(store(), secrets); expect((await reopened.save(input)).generation).toBeGreaterThan(original.generation); }
  finally { await rm(root, { recursive: true, force: true }); }
});
it("rejects Fetch-blocked port 6679 instead of advertising an unusable UI origin", async () => {
  const app = createResearchRoomServer({ port: 6679 });
  let opened: Awaited<ReturnType<typeof app.start>> | undefined;
  try { await expect(app.start().then(value => { opened = value; return value; })).rejects.toThrow("browser-blocked port"); }
  finally { await opened?.close(); app.application.close(); }
});
it("rejects metadata addresses before opening an actual Provider socket", async () => {
  let sockets = 0;
  const fakeFetch = (async () => { sockets++; return new Response(JSON.stringify({ choices: [{ message: { content: "synthetic" } }] })); }) as typeof fetch;
  const provider = createKernelOpenAICompatibleProvider({ config: { schemaVersion: "1.0.0", family: "openai_compatible", providerId: "synthetic", model: "synthetic", baseUrl: "https://169.254.169.254/v1", locality: "external", generation: 1, timeoutMs: 1000 } }, fakeFetch);
  await expect(provider.send("{}", new AbortController().signal)).rejects.toThrow();
  expect(sockets).toBe(0);
});
it("pins a local socket, sends exact UTF-8 once, rejects redirect without following it", async () => {
  const bodies: string[] = []; let connections = 0;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    bodies.push(Buffer.concat(chunks).toString("utf8"));
    res.writeHead(req.url === "/redirect" ? 302 : 200, { location: "/forbidden" }); res.end("synthetic");
  });
  server.on("connection", () => connections++);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("fixture");
  try {
    let checks = 0;
    const fetch = createPinnedProviderFetch("local", async () => { checks++; });
    const exact = '{"text":"中文 English\\n<untrusted>"}';
    await fetch(`http://127.0.0.1:${address.port}/`, { method: "POST", body: exact, redirect: "error" });
    expect(bodies).toEqual([exact]); expect(checks).toBe(1); expect(connections).toBe(1);
    await expect(fetch(`http://127.0.0.1:${address.port}/redirect`, { method: "POST", body: "{}", redirect: "error" })).rejects.toThrow("provider_result_uncertain");
    expect(connections).toBe(2); expect(bodies).toHaveLength(2);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
it("rejects every mixed DNS result and IPv4/IPv6 private or ambiguous form", async () => {
  for (const address of ["169.254.169.254", "10.0.0.1", "::1", "::ffff:127.0.0.1", "::ffff:a9fe:a9fe", "fc00::1", "fe80::1", "100.64.1.1"]) expect(providerAddressAllowed(address, "external")).toBe(false);
  expect(providerAddressAllowed("2606:4700:4700::1111", "external")).toBe(true);
  const dns = async () => [{ address: "8.8.8.8", family: 4 }, { address: "169.254.169.254", family: 4 }];
  await expect(resolveProviderEndpoint("https://synthetic.invalid/v1", "external", dns as any)).rejects.toThrow("provider_endpoint_rejected");
});
