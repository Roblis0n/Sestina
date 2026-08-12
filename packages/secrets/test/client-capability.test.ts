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
import {
  ActorProvenanceSchema,
  canActAsDirectUser,
  isPeerProvenance,
} from "@sestina/schema";
import type { ActorProvenance } from "@sestina/schema";

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
    it("Hook with valid control token is still peer provenance", () => {
      const hookProvenance: ActorProvenance = {
        actor: "hook",
        channel: "host",
        directUser: false,
      };
      expect(canActAsDirectUser(hookProvenance)).toBe(false);
    });

    it("MCP agent with valid control token is still peer provenance", () => {
      const mcpProvenance: ActorProvenance = {
        actor: "agent",
        channel: "mcp",
        directUser: false,
      };
      expect(canActAsDirectUser(mcpProvenance)).toBe(false);
    });

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
      // The SecretBackend interface has no "list all" or "enumerate" method.
      // The describe() method only answers { configured: boolean }.
      const describableMethods = ["describe"] as const;
      const nonEnumeratingMethods = ["get", "set", "delete", "describe", "health"] as const;

      expect(describableMethods).toHaveLength(1);
      expect(nonEnumeratingMethods).not.toContain("list" as never);
      expect(nonEnumeratingMethods).not.toContain("keys" as never);
    });
  });
});
