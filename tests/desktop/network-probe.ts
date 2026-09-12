import { app } from "electron";
import { createServer } from "node:https";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import {
  KernelApplicationApi,
  createKernelOpenAICompatibleProvider,
  createPinnedProviderFetch,
  resolveProviderEndpoint,
} from "@sestina/application";
const directory = process.argv
  .find((arg) => arg.startsWith("--fixture="))
  ?.slice(10);
if (!directory || process.type !== "browser" || !process.versions.electron)
  throw new Error("electron_network_runtime_required");
void app.whenReady().then(async () => {
  const bodies: string[] = [],
    addresses: string[] = [];
  let mode = "valid",
    sockets = 0;
  const server = createServer(
    {
      key: await readFile(join(directory, "key.pem")),
      cert: await readFile(join(directory, "cert.pem")),
    },
    async (req, res) => {
      const parts: Buffer[] = [];
      for await (const part of req) parts.push(Buffer.from(part));
      const body = Buffer.concat(parts).toString("utf8");
      bodies.push(body);
      addresses.push(req.socket.localAddress ?? "");
      if (mode === "redirect") {
        res.writeHead(302, { location: "/never-follow" });
        res.end();
        return;
      }
      const binding = JSON.parse(
        JSON.parse(body).messages[1].content,
      ).requestBinding;
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  schemaVersion: "2.0.0",
                  requestBinding: binding,
                  publicSummary: "Synthetic TLS opinion",
                  quotedSpans: [],
                }),
              },
            },
          ],
        }),
      );
    },
  );
  server.on("connection", () => sockets++);
  await new Promise<void>((done) => server.listen(0, "0.0.0.0", done));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("fixture_address");
  const endpoint = `https://127.0.0.1:${address.port}`;
  let api: KernelApplicationApi | undefined;
  try {
    for (const scenario of ["valid", "redirect"]) {
      mode = scenario;
      const provider = createKernelOpenAICompatibleProvider({
        config: {
          schemaVersion: "1.0.0",
          family: "openai_compatible",
          providerId: "synthetic-tls",
          model: "synthetic",
          baseUrl: endpoint,
          locality: "local",
          generation: 1,
          timeoutMs: 5000,
        },
        apiKey: "synthetic-not-a-credential",
      });
      api = new KernelApplicationApi({ provider: () => provider });
      const path = join(directory, scenario);
      await mkdir(path);
      let session = await api.create({
        projectPath: path,
        title: "Synthetic TLS",
        confirmed: true,
      });
      const call = (action: string, input: object = {}) =>
        api!.execute(
          {
            projectId: session.projectId,
            sessionGeneration: session.sessionGeneration,
            action,
            ...input,
          },
          true,
        ) as Promise<any>;
      const draft = await call("create", {
        suggestion: "中文 exact bytes / TLS",
      });
      const prepared = await call("prepare_manifest", {
        reviewId: draft.id,
        expectedVersion: draft.version,
        selection: {},
        useProvider: true,
      });
      let review = await call("confirm_manifest", {
        reviewId: draft.id,
        expectedVersion: prepared.review.version,
        manifestIdentityHash: prepared.manifest.identityHash,
        confirmed: true,
      });
      review = await call("prepare_attempt", {
        reviewId: draft.id,
        expectedVersion: review.version,
      });
      const before = sockets;
      await call("start_attempt", {
        reviewId: draft.id,
        expectedVersion: review.version,
        manifestIdentityHash: prepared.manifest.identityHash,
        confirmed: true,
      });
      assert.equal(bodies.at(-1), prepared.manifest.exactRequestBody);
      assert.equal(sockets, before + 1);
      const result = await call("read", { reviewId: draft.id });
      assert.equal(
        result.attempts[0].status,
        scenario === "valid" ? "completed" : "uncertain",
      );
      api.close();
      session = await api.open({ projectPath: path });
      assert.equal(
        (await call("read", { reviewId: draft.id })).attempts[0].status,
        result.attempts[0].status,
      );
      assert.equal(sockets, before + 1);
      api.dispose();
      api = undefined;
    }
    const beforeBodies = bodies.length;
    const denied = createPinnedProviderFetch("local", async () => {
      throw new Error("synthetic_configuration_change");
    });
    await assert.rejects(
      denied(endpoint, { method: "POST", body: "{}", redirect: "error" }),
      /configuration_changed/,
    );
    assert.equal(bodies.length, beforeBodies);
    // Same local server and CA, deliberately wrong IP identity: certificate checks stay enabled.
    await assert.rejects(
      createPinnedProviderFetch("local")(`https://127.0.0.2:${address.port}`, {
        method: "POST",
        body: "{}",
        redirect: "error",
      }),
      /network_failed/,
    );
    assert.equal(bodies.length, beforeBodies);
    const beforeDns = sockets;
    await assert.rejects(
      resolveProviderEndpoint(
        "https://synthetic.invalid/",
        "external",
        (async () => [
          { address: "8.8.8.8", family: 4 },
          { address: "169.254.169.254", family: 4 },
        ]) as any,
      ),
      /endpoint_rejected/,
    );
    assert.equal(sockets, beforeDns);
    assert.ok(addresses.every((value) => value === "127.0.0.1"));
    await writeFile(
      join(directory, "report.json"),
      JSON.stringify({
        passed: true,
        electron: process.versions.electron,
        platform: process.platform,
        arch: process.arch,
        exactTlsRequests: bodies.length,
        socketCount: sockets,
        kernelStatuses: ["completed", "uncertain"],
        restartDidNotSend: true,
        finalGuardPreventedBody: true,
        wrongCertificateRejected: true,
        mixedDnsRejected: true,
        implicitProxyIgnored: true,
      }),
    );
  } catch (error) {
    await writeFile(
      join(directory, "report.json"),
      JSON.stringify({
        passed: false,
        stage: "electron-network",
        error: error instanceof Error ? error.message : "failed",
      }),
    );
    process.exitCode = 1;
  } finally {
    api?.dispose();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    app.exit(process.exitCode ?? 0);
  }
});
