/**
 * Client capability and permission boundary tests.
 *
 * These tests verify the hard security boundary using the PRODUCTION
 * ActorProvenance schema and permission helpers from @sestina/schema.
 * No inline type definitions or function reimplementations.
 *
 * Rules enforced:
 * - Control tokens prove "current user installed this client" ONLY.
 * - Control tokens do NOT grant direct-user provenance.
 * - Hooks, MCP, and peers can NEVER obtain user-level permissions
 *   regardless of token possession.
 * - Peer provenance is permanently distinct from user provenance.
 * - directUser on mcp/host channels is rejected at the schema level.
 */
import { describe, it, expect } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import {
  ActorProvenanceSchema,
  canActAsDirectUser,
  isPeerProvenance,
} from "@sestina/schema";
import type { ActorProvenance } from "@sestina/schema";
import type { SecretBackend } from "../src/port.js";
import {
  createEnvironmentBackend,
  getOrCreateControlToken,
  verifyChallengeResponse,
} from "../src/index.js";

function createMemoryBackend(): SecretBackend {
  const store = new Map<string, string>();
  return {
    get(ref) {
      return Promise.resolve(store.get(ref));
    },
    set(ref, value) {
      store.set(ref, value);
      return Promise.resolve();
    },
    delete(ref) {
      store.delete(ref);
      return Promise.resolve();
    },
    describe(ref) {
      return Promise.resolve({ configured: store.has(ref) });
    },
    health() {
      return Promise.resolve({ available: true, backend: "dpapi" });
    },
  };
}

// ── Tests ──

describe("client capability boundaries", () => {
  describe("direct-user provenance", () => {
    it("grants directUser to desktop user interaction", () => {
      const provenance: ActorProvenance = {
        actor: "user",
        channel: "desktop",
        directUser: true,
        challengeId: "challenge-001",
      };
      expect(canActAsDirectUser(provenance)).toBe(true);
    });

    it("grants directUser to CLI user interaction", () => {
      const provenance: ActorProvenance = {
        actor: "user",
        channel: "cli",
        directUser: true,
        challengeId: "challenge-002",
      };
      expect(canActAsDirectUser(provenance)).toBe(true);
    });

    it("denies directUser when directUser flag is false even on desktop", () => {
      const provenance: ActorProvenance = {
        actor: "system",
        channel: "desktop",
        directUser: false,
      };
      expect(canActAsDirectUser(provenance)).toBe(false);
    });

    it("denies directUser for Hook channel regardless of actor", () => {
      const provenance: ActorProvenance = {
        actor: "hook",
        channel: "host",
        directUser: false,
      };
      expect(canActAsDirectUser(provenance)).toBe(false);
      expect(isPeerProvenance(provenance)).toBe(true);
    });

    it("denies directUser for MCP channel regardless of actor", () => {
      const provenance: ActorProvenance = {
        actor: "agent",
        channel: "mcp",
        directUser: false,
      };
      expect(canActAsDirectUser(provenance)).toBe(false);
      expect(isPeerProvenance(provenance)).toBe(true);
    });
  });

  describe("control token cannot elevate peer to user", () => {
    it.each([
      ["hook", "host"],
      ["agent", "mcp"],
    ] as const)(
      "a cryptographically valid token cannot elevate %s/%s provenance",
      async (actor, channel) => {
        const backend = createMemoryBackend();
        const token = await getOrCreateControlToken(backend, "ipc");
        const clientNonce = randomBytes(32);
        const serverNonce = randomBytes(32);
        const role = channel;
        const response = createHmac("sha256", Buffer.from(token.value, "hex"))
          .update(Buffer.concat([clientNonce, serverNonce, Buffer.from(role)]))
          .digest();

        await expect(
          verifyChallengeResponse(
            backend,
            "ipc",
            response,
            clientNonce,
            serverNonce,
            role,
          ),
        ).resolves.toBe(true);

        expect(
          ActorProvenanceSchema.safeParse({
            actor,
            channel,
            directUser: true,
          }).success,
        ).toBe(false);
        const peer = ActorProvenanceSchema.parse({
          actor,
          channel,
          directUser: false,
        });
        expect(isPeerProvenance(peer)).toBe(true);
        expect(canActAsDirectUser(peer)).toBe(false);
      },
    );

    it("peer provenance can never mutate into directUser", () => {
      const peerChannels = ["host", "mcp"] as const;
      for (const channel of peerChannels) {
        // Attempt to "spoof" — should always be false for peer channels
        const spoofed: ActorProvenance = {
          actor: "user", // trying to look like a user
          channel,
          directUser: false, // system forces false for peer channels
        };
        expect(canActAsDirectUser(spoofed)).toBe(false);
      }
    });
  });

  describe("schema-level rejection of directUser on peer channels", () => {
    it("rejects {actor:user, channel:mcp, directUser:true} at parse time", () => {
      const result = ActorProvenanceSchema.safeParse({
        actor: "user",
        channel: "mcp",
        directUser: true,
      });
      expect(result.success).toBe(false);
    });

    it("rejects {actor:user, channel:host, directUser:true} at parse time", () => {
      const result = ActorProvenanceSchema.safeParse({
        actor: "user",
        channel: "host",
        directUser: true,
      });
      expect(result.success).toBe(false);
    });

    it("accepts {actor:user, channel:desktop, directUser:true}", () => {
      const result = ActorProvenanceSchema.safeParse({
        actor: "user",
        channel: "desktop",
        directUser: true,
      });
      expect(result.success).toBe(true);
    });

    it("accepts {actor:user, channel:cli, directUser:true}", () => {
      const result = ActorProvenanceSchema.safeParse({
        actor: "user",
        channel: "cli",
        directUser: true,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("override authorization boundary", () => {
    it("requires directUser provenance for override confirmation", () => {
      // Desktop user can confirm
      expect(
        canActAsDirectUser({
          actor: "user",
          channel: "desktop",
          directUser: true,
          challengeId: "c1",
        }),
      ).toBe(true);

      // CLI user can confirm
      expect(
        canActAsDirectUser({
          actor: "user",
          channel: "cli",
          directUser: true,
          challengeId: "c2",
        }),
      ).toBe(true);

      // MCP agent CANNOT confirm (even with a valid challenge ID)
      expect(
        canActAsDirectUser({
          actor: "agent",
          channel: "mcp",
          directUser: false,
          challengeId: "c3",
        }),
      ).toBe(false);

      // Hook CANNOT confirm
      expect(
        canActAsDirectUser({
          actor: "hook",
          channel: "host",
          directUser: false,
        }),
      ).toBe(false);

      // System CANNOT confirm
      expect(
        canActAsDirectUser({
          actor: "system",
          channel: "runtime",
          directUser: false,
        }),
      ).toBe(false);
    });
  });

  describe("secret backend access boundary", () => {
    it("peers access secrets through the backend but never see raw storage", () => {
      const backend = createEnvironmentBackend({
        read: () => undefined,
        keys: () => ["SESTINA_SECRET_PRIVATE_INTERNAL_KEY"],
      });
      const publicSurface = Reflect.ownKeys(backend);

      expect(publicSurface).toEqual([
        "get",
        "set",
        "delete",
        "describe",
        "health",
      ]);
      expect(publicSurface).not.toContain("list");
      expect(publicSurface).not.toContain("keys");
    });
  });
});
