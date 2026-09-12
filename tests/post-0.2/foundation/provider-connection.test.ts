import { it, expect } from "vitest";
import { createKernelOpenAICompatibleProvider } from "../../../packages/application/src/openai-compatible-provider.js";
import { createPinnedProviderFetch, providerAddressAllowed, resolveProviderEndpoint } from "../../../packages/application/src/provider-transport.js";
import { createServer } from "node:http";
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
    await expect(fetch(`http://127.0.0.1:${address.port}/redirect`, { method: "POST", body: "{}", redirect: "error" })).rejects.toThrow("provider_http_error");
    expect(connections).toBe(2); expect(bodies).toHaveLength(2);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
it("rejects every mixed DNS result and IPv4/IPv6 private or ambiguous form", async () => {
  for (const address of ["169.254.169.254", "10.0.0.1", "::1", "::ffff:127.0.0.1", "::ffff:a9fe:a9fe", "fc00::1", "fe80::1", "100.64.1.1"]) expect(providerAddressAllowed(address, "external")).toBe(false);
  expect(providerAddressAllowed("2606:4700:4700::1111", "external")).toBe(true);
  const dns = async () => [{ address: "8.8.8.8", family: 4 }, { address: "169.254.169.254", family: 4 }];
  await expect(resolveProviderEndpoint("https://synthetic.invalid/v1", "external", dns as any)).rejects.toThrow("provider_endpoint_rejected");
});
