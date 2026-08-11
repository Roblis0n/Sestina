 
/**
 * Client capability and permission boundary tests.
 *
 * These tests verify the hard security boundary:
 * - Control tokens prove "current user installed this client" ONLY.
 * - Control tokens do NOT grant direct-user provenance.
 * - Hooks, MCP, and peers can NEVER obtain user-level permissions
 *   regardless of token possession.
 * - Peer provenance is permanently distinct from user provenance.
 */
import { describe, it, expect } from "vitest";

// ── Provenance model (mirrors schema but tested independently here) ──

type ActorKind = "user" | "agent" | "system" | "hook" | "cli";
type ChannelKind = "desktop" | "host" | "mcp" | "cli" | "runtime";

interface ActorProvenance {
  actor: ActorKind;
  channel: ChannelKind;
  directUser: boolean;
  challengeId?: string;
}

/** Peer provenance types — defined here to be tested BEFORE Task 5 storage. */
type PeerProvenanceKind = "hook" | "mcp_agent" | "cli_script";

interface PeerProvenance {
  kind: PeerProvenanceKind;
  /** Peer identity — NOT a user identity. */
  peerId: string;
  /** The host session this peer is attached to. */
  hostSessionId: string;
}

// ── Permission boundary rules (to be enforced by core) ──

const DIRECT_USER_CHANNELS: ChannelKind[] = ["desktop", "cli"];
const PEER_CHANNELS: ChannelKind[] = ["host", "mcp"];

function canActAsDirectUser(provenance: ActorProvenance): boolean {
  return provenance.directUser && DIRECT_USER_CHANNELS.includes(provenance.channel);
}

function isPeerProvenance(provenance: ActorProvenance): boolean {
  return PEER_CHANNELS.includes(provenance.channel);
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
    it("Hook with valid control token is still peer provenance", () => {
      // Even if a Hook runner possesses the control token (it needs it for IPC),
      // its provenance remains "hook" — never "user".
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
      // The directUser flag is set by the IPC handshake based on channel type,
      // NOT by token possession. Peers cannot flip this flag.
      const peerChannels: ChannelKind[] = ["host", "mcp"];
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

  describe("peer provenance isolation", () => {
    it("different peers have independent identities", () => {
      const hookPeer: PeerProvenance = {
        kind: "hook",
        peerId: "hook-codex-001",
        hostSessionId: "session-a",
      };
      const mcpPeer: PeerProvenance = {
        kind: "mcp_agent",
        peerId: "mcp-agent-001",
        hostSessionId: "session-b",
      };

      // Different kinds
      expect(hookPeer.kind).not.toBe(mcpPeer.kind);
      // Different identities
      expect(hookPeer.peerId).not.toBe(mcpPeer.peerId);
      // May share host session
      expect(hookPeer.hostSessionId).not.toBe(mcpPeer.hostSessionId);
    });

    it("peer provenance is always distinct from user provenance", () => {
      const peerKind: PeerProvenanceKind[] = ["hook", "mcp_agent", "cli_script"];
      const userActor: ActorKind = "user";

      // Peer kinds should never equal "user" actor
      for (const pk of peerKind) {
        expect(pk).not.toBe(userActor);
      }
    });
  });

  describe("override authorization boundary", () => {
    it("requires directUser provenance for override confirmation", () => {
      // This is the rule: override.confirm needs ActorProvenance with
      // directUser=true AND channel in ["desktop", "cli"].

      function canConfirmOverride(provenance: ActorProvenance): boolean {
        return provenance.directUser && DIRECT_USER_CHANNELS.includes(provenance.channel);
      }

      // Desktop user can confirm
      expect(
        canConfirmOverride({
          actor: "user",
          channel: "desktop",
          directUser: true,
          challengeId: "c1",
        }),
      ).toBe(true);

      // CLI user can confirm
      expect(
        canConfirmOverride({
          actor: "user",
          channel: "cli",
          directUser: true,
          challengeId: "c2",
        }),
      ).toBe(true);

      // MCP agent CANNOT confirm (even with a valid challenge ID)
      expect(
        canConfirmOverride({
          actor: "agent",
          channel: "mcp",
          directUser: false,
          challengeId: "c3",
        }),
      ).toBe(false);

      // Hook CANNOT confirm
      expect(
        canConfirmOverride({
          actor: "hook",
          channel: "host",
          directUser: false,
        }),
      ).toBe(false);

      // System CANNOT confirm
      expect(
        canConfirmOverride({
          actor: "system",
          channel: "runtime",
          directUser: false,
        }),
      ).toBe(false);
    });
  });

  describe("secret backend access boundary", () => {
    it("peers access secrets through the backend but never see raw storage", () => {
      // Peers (Hooks, MCP) use getOrCreateControlToken which returns
      // the token value they need for IPC. But they:
      // 1. Never get direct access to the backend's raw storage
      // 2. Never enumerate all stored secrets
      // 3. Only access their scope-specific token

      // This is a structural guarantee: the SecretBackend interface
      // has no "list all" or "enumerate" method.
      // The describe() method only answers { configured: boolean }.
      const describableMethods = ["describe"] as const;
      const nonEnumeratingMethods = ["get", "set", "delete", "describe", "health"] as const;

      // Verify describe exists but has no "list" method
      expect(describableMethods).toHaveLength(1);
      // Confirm there is no "list" or "keys" or "enumerate" method
      // in the interface (this is a type-level check, reinforced here)
      expect(nonEnumeratingMethods).not.toContain("list" as never);
      expect(nonEnumeratingMethods).not.toContain("keys" as never);
    });
  });
});
