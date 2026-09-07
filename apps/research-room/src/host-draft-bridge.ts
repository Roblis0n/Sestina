import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server, type IncomingMessage } from "node:http";

/** A temporary draft-only capability, separate from the user's application session. */
export class HostDraftBridge {
  #server: Server | undefined;
  #token = "";
  #connectionId = "";
  #expiresAt = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #opening = false;
  #generation = 0;
  constructor(
    private readonly intake: (body: unknown, connectionId: string) => unknown,
    private readonly readStatus: (
      connectionId: string,
      invocationId: string,
    ) => unknown,
  ) {}

  close(): void {
    this.#generation += 1;
    this.#token = "";
    this.#expiresAt = 0;
    clearTimeout(this.#timer);
    this.#server?.closeAllConnections();
    this.#server?.close();
    this.#server = undefined;
  }

  async enable() {
    if (this.#opening) throw new Error("bridge_open_in_progress");
    this.#opening = true;
    this.close();
    const generation = this.#generation;
    try {
      const token = randomBytes(32).toString("base64url");
      const connectionId = randomBytes(24).toString("base64url");
      const server = createServer((request, response) => {
        const reply = (status: number, body: unknown) => {
          response.writeHead(status, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          });
          response.end(JSON.stringify(body));
        };
        void (async () => {
          const address = server.address();
          if (
            !address ||
            typeof address === "string" ||
            request.headers.host !== `127.0.0.1:${address.port}` ||
            request.headers.origin !== undefined
          ) {
            reply(403, { error: "local_host_required" });
            return;
          }
          const supplied = request.headers.authorization;
          const expected = `Bearer ${this.#token}`;
          if (
            !this.#token ||
            Date.now() >= this.#expiresAt ||
            typeof supplied !== "string" ||
            Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
            !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
          ) {
            reply(401, { error: "connection_expired_or_revoked" });
            return;
          }
          const url = new URL(request.url ?? "/", "http://127.0.0.1");
          if (
            request.method === "POST" &&
            url.pathname === "/drafts" &&
            !url.search
          ) {
            const body = await readEnvelope(request);
            // Revocation or expiry during upload must take effect before persistence.
            if (token !== this.#token || Date.now() >= this.#expiresAt) {
              reply(401, { error: "connection_expired_or_revoked" });
              return;
            }
            const result = this.intake(body, connectionId) as {
              id: string;
              status: string;
              version: number;
            };
            reply(201, {
              reviewId: result.id,
              status: result.status,
              version: result.version,
              authority: "draft_only",
            });
            return;
          }
          if (
            request.method === "GET" &&
            url.pathname === "/status" &&
            [...url.searchParams.keys()].every((k) => k === "invocationId") &&
            url.searchParams.getAll("invocationId").length === 1
          ) {
            const invocationId = url.searchParams.get("invocationId");
            if (!invocationId || invocationId.length > 128) {
              reply(400, { error: "invalid_input" });
              return;
            }
            reply(200, {
              value: this.readStatus(connectionId, invocationId) ?? null,
            });
            return;
          }
          reply(404, { error: "draft_or_status_only" });
        })().catch(() => {
          reply(400, { error: "draft_not_saved" });
        });
      });
      server.requestTimeout = 10_000;
      server.headersTimeout = 10_000;
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      if (generation !== this.#generation) {
        server.close();
        throw new Error("bridge_revoked");
      }
      this.#server = server;
      this.#token = token;
      this.#connectionId = connectionId;
      this.#expiresAt = Date.now() + 10 * 60_000;
      this.#timer = setTimeout(() => {
        this.close();
      }, 10 * 60_000);
      this.#timer.unref();
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("bridge_unavailable");
      return {
        origin: `http://127.0.0.1:${address.port}`,
        token,
        connectionId: this.#connectionId,
        expiresAt: new Date(this.#expiresAt).toISOString(),
        permissions: ["draft_submit", "own_draft_status"],
      };
    } finally {
      this.#opening = false;
    }
  }
}

async function readEnvelope(request: IncomingMessage): Promise<unknown> {
  if (
    request.headers["content-type"] !== "application/json" ||
    request.headers["content-encoding"] !== undefined
  )
    throw new Error("invalid_content_type");
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const b = Buffer.from(chunk as Uint8Array);
    bytes += b.length;
    if (bytes > 131_072) throw new Error("request_too_large");
    chunks.push(b);
  }
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
  );
}
