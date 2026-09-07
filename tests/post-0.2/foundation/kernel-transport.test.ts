import { createServer } from "node:http";
import type { Socket } from "node:net";
import { expect, it } from "vitest";
import { createKernelOpenAICompatibleProvider } from "../../../apps/research-room/src/openai-compatible-provider.js";
import {
  applicationFixture,
  session,
  ready,
  commit,
} from "../application-fixtures.js";
async function transport(mode: string) {
  const bodies: string[] = [],
    sockets = new Set<Socket>();
  let connections = 0;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString("utf8");
    bodies.push(body);
    if (mode === "reset") {
      req.socket.destroy();
      return;
    }
    if (mode === "timeout") return;
    if (mode === "redirect") {
      res.writeHead(302, { location: "/forbidden" });
      res.end();
      return;
    }
    if (mode === "oversize") {
      res.end("x".repeat(524289));
      return;
    }
    if (mode === "invalid") {
      res.end("{invalid");
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
                publicSummary: "Optional synthetic opinion",
                quotedSpans: [],
              }),
            },
          },
        ],
      }),
    );
  });
  server.on("connection", (socket) => {
    connections++;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("No synthetic address");
  const config = {
    schemaVersion: "1.0.0" as const,
    family: "openai_compatible" as const,
    providerId: "synthetic",
    model: "fixture",
    baseUrl: `http://127.0.0.1:${address.port}`,
    timeoutMs: 150,
    locality: "local" as const,
    generation: 1,
  };
  return {
    config,
    provider: createKernelOpenAICompatibleProvider({ config }),
    bodies,
    get connections() {
      return connections;
    },
    async close() {
      sockets.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
it.each(["valid", "reset", "timeout", "redirect", "oversize", "invalid"])(
  "G5 actual transport %s sends only the confirmed bytes once and leaves an explainable result",
  async (mode) => {
    const tcp = await transport(mode),
      f = await applicationFixture(tcp.provider);
    try {
      const a = f.kernel.createReview("Synthetic transport text", session),
        p = await f.kernel.prepareManifest(a.id, a.version, {}, true, session);
      let r = await f.kernel.confirmManifest(
        a.id,
        p.review.version,
        p.manifest.identityHash,
        session,
      );
      r = f.kernel.prepareAttempt(a.id, r.version, session);
      await f.kernel.startAttempt(
        a.id,
        r.version,
        p.manifest.identityHash,
        session,
      );
      expect(tcp.bodies).toEqual([p.manifest.exactRequestBody]);
      const result = f.kernel.readReview(a.id, session);
      expect(result.attempts[0]!.status).toBe(
        mode === "valid"
          ? "completed"
          : ["reset", "redirect"].includes(mode)
            ? "uncertain"
            : "failed",
      );
      await f.restart();
      expect(tcp.bodies).toHaveLength(1);
      expect(
        commit(f, f.kernel.readReview(a.id, session).review, {
          kind: "record_only",
          outcome: "deferred",
          reason: "User continues despite transport outcome",
        }).resultingObjects,
      ).toEqual([]);
    } finally {
      await f.cleanup();
      await tcp.close();
    }
  },
);
it.each(["revision", "configuration"])(
  "G5 %s drift prevents even the first TCP connection",
  async (change) => {
    const tcp = await transport("valid"),
      f = await applicationFixture(tcp.provider);
    try {
      const a = f.kernel.createReview("Synthetic transport text", session),
        p = await f.kernel.prepareManifest(a.id, a.version, {}, true, session);
      let r = await f.kernel.confirmManifest(
        a.id,
        p.review.version,
        p.manifest.identityHash,
        session,
      );
      r = f.kernel.prepareAttempt(a.id, r.version, session);
      if (change === "revision")
        commit(f, await ready(f), {
          kind: "record_only",
          outcome: "deferred",
          reason: "Revision only, no object change",
        });
      else
        f.setProvider(
          createKernelOpenAICompatibleProvider({
            config: { ...tcp.config, generation: 2 },
          }),
        );
      await expect(
        f.kernel.startAttempt(
          a.id,
          r.version,
          p.manifest.identityHash,
          session,
        ),
      ).rejects.toThrow("stale_revision");
      expect(tcp.connections).toBe(0);
      expect(tcp.bodies).toEqual([]);
    } finally {
      await f.cleanup();
      await tcp.close();
    }
  },
);
