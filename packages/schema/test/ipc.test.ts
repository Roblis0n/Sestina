import { describe, it, expect } from "vitest";
import {
  RpcRequestSchema,
  RpcSuccessSchema,
  RpcFailureSchema,
  RpcMethodSchema,
  StreamEnvelopeSchema,
  ClientRoleSchema,
} from "../src/index.js";

describe("IPC envelope validation", () => {
  describe("ClientRoleSchema", () => {
    it.each(["hook", "mcp", "cli", "desktop"] as const)("accepts valid role: %s", (role) => {
      expect(ClientRoleSchema.safeParse(role).success).toBe(true);
    });

    it("rejects invalid roles", () => {
      expect(ClientRoleSchema.safeParse("admin").success).toBe(false);
      expect(ClientRoleSchema.safeParse("").success).toBe(false);
      expect(ClientRoleSchema.safeParse("user").success).toBe(false);
    });
  });

  describe("RpcMethodSchema", () => {
    it("accepts valid RPC methods", () => {
      expect(RpcMethodSchema.safeParse("runtime.health").success).toBe(true);
      expect(RpcMethodSchema.safeParse("project.list").success).toBe(true);
      expect(RpcMethodSchema.safeParse("project.get").success).toBe(true);
      expect(RpcMethodSchema.safeParse("decision.get").success).toBe(true);
      expect(RpcMethodSchema.safeParse("conversation.send").success).toBe(true);
      expect(RpcMethodSchema.safeParse("stream.subscribe").success).toBe(true);
      expect(RpcMethodSchema.safeParse("event.submit").success).toBe(true);
      expect(RpcMethodSchema.safeParse("task.resolve").success).toBe(true);
    });

    it("rejects unknown RPC methods", () => {
      expect(RpcMethodSchema.safeParse("project.delete").success).toBe(false);
      expect(RpcMethodSchema.safeParse("health").success).toBe(false);
      expect(RpcMethodSchema.safeParse("chat.send").success).toBe(false);
      expect(RpcMethodSchema.safeParse("").success).toBe(false);
    });
  });

  describe("RpcRequestSchema", () => {
    it("validates a correct RPC request", () => {
      const req = {
        jsonrpc: "2.0" as const,
        id: "req-1",
        method: "project.list",
        meta: {
          protocolVersion: "1.0.0" as const,
          clientRole: "cli" as const,
          clientVersion: "0.1.0",
          timestamp: new Date().toISOString(),
          deadlineMs: 5000,
          maxResponseBytes: 262144,
        },
      };
      expect(RpcRequestSchema.safeParse(req).success).toBe(true);
    });

    it("validates a request with params", () => {
      const req = {
        jsonrpc: "2.0" as const,
        id: "req-2",
        method: "project.get",
        params: { projectId: "JGP7HHVP7X6E3F3PBJ2RHB7YJW" },
        meta: {
          protocolVersion: "1.0.0" as const,
          clientRole: "desktop" as const,
          clientVersion: "0.1.0",
          timestamp: new Date().toISOString(),
          deadlineMs: 5000,
          maxResponseBytes: 262144,
        },
      };
      expect(RpcRequestSchema.safeParse(req).success).toBe(true);
    });

    it("rejects invalid jsonrpc version", () => {
      expect(RpcRequestSchema.safeParse({
        jsonrpc: "1.0",
        id: "req-1",
        method: "project.list",
        meta: {
          protocolVersion: "1.0.0",
          clientRole: "cli",
          clientVersion: "1.0",
          timestamp: new Date().toISOString(),
          deadlineMs: 5000,
          maxResponseBytes: 262144,
        },
      }).success).toBe(false);
    });

    it("rejects missing meta", () => {
      expect(RpcRequestSchema.safeParse({
        jsonrpc: "2.0",
        id: "req-1",
        method: "project.list",
      }).success).toBe(false);
    });

    it("rejects missing clientRole in meta", () => {
      expect(RpcRequestSchema.safeParse({
        jsonrpc: "2.0",
        id: "req-1",
        method: "project.list",
        meta: {
          protocolVersion: "1.0.0",
          clientVersion: "1.0",
          timestamp: new Date().toISOString(),
          deadlineMs: 5000,
          maxResponseBytes: 262144,
        },
      }).success).toBe(false);
    });

    it("rejects invalid clientRole in meta", () => {
      expect(RpcRequestSchema.safeParse({
        jsonrpc: "2.0",
        id: "req-1",
        method: "project.list",
        meta: {
          protocolVersion: "1.0.0",
          clientRole: "admin",
          clientVersion: "1.0",
          timestamp: new Date().toISOString(),
          deadlineMs: 5000,
          maxResponseBytes: 262144,
        },
      }).success).toBe(false);
    });

    it("rejects missing protocolVersion in meta", () => {
      expect(RpcRequestSchema.safeParse({
        jsonrpc: "2.0",
        id: "req-1",
        method: "project.list",
        meta: {
          clientRole: "cli",
          clientVersion: "1.0",
          timestamp: new Date().toISOString(),
          deadlineMs: 5000,
          maxResponseBytes: 262144,
        },
      }).success).toBe(false);
    });

    it("rejects negative deadlineMs", () => {
      expect(RpcRequestSchema.safeParse({
        jsonrpc: "2.0",
        id: "req-1",
        method: "project.list",
        meta: {
          protocolVersion: "1.0.0",
          clientRole: "cli",
          clientVersion: "1.0",
          timestamp: new Date().toISOString(),
          deadlineMs: -1,
          maxResponseBytes: 262144,
        },
      }).success).toBe(false);
    });

    it("rejects deadlineMs exceeding max (30000)", () => {
      expect(RpcRequestSchema.safeParse({
        jsonrpc: "2.0",
        id: "req-1",
        method: "project.list",
        meta: {
          protocolVersion: "1.0.0",
          clientRole: "cli",
          clientVersion: "1.0",
          timestamp: new Date().toISOString(),
          deadlineMs: 60000,
          maxResponseBytes: 262144,
        },
      }).success).toBe(false);
    });
  });

  describe("RpcSuccessSchema", () => {
    it("validates a correct RPC success response", () => {
      const res = {
        jsonrpc: "2.0" as const,
        id: "req-1",
        result: { projects: [] },
        meta: {
          protocolVersion: "1.0.0" as const,
          serverVersion: "0.1.0",
          processingMs: 15,
        },
      };
      expect(RpcSuccessSchema.safeParse(res).success).toBe(true);
    });

    it("rejects negative processingMs", () => {
      expect(RpcSuccessSchema.safeParse({
        jsonrpc: "2.0",
        id: "req-1",
        result: {},
        meta: {
          protocolVersion: "1.0.0",
          serverVersion: "0.1.0",
          processingMs: -1,
        },
      }).success).toBe(false);
    });

    it("rejects missing protocolVersion", () => {
      expect(RpcSuccessSchema.safeParse({
        jsonrpc: "2.0",
        id: "req-1",
        result: {},
        meta: { serverVersion: "0.1.0", processingMs: 15 },
      }).success).toBe(false);
    });
  });

  describe("RpcFailureSchema", () => {
    it("validates a correct RPC failure response", () => {
      const fail = {
        jsonrpc: "2.0" as const,
        id: "req-1",
        error: {
          code: "task_not_found" as const,
          message: "Task not found",
        },
        meta: {
          protocolVersion: "1.0.0" as const,
          serverVersion: "0.1.0",
        },
      };
      expect(RpcFailureSchema.safeParse(fail).success).toBe(true);
    });

    it("rejects unknown error codes", () => {
      expect(RpcFailureSchema.safeParse({
        jsonrpc: "2.0",
        id: "req-1",
        error: { code: "not_a_real_code", message: "Bad" },
        meta: {
          protocolVersion: "1.0.0",
          serverVersion: "0.1.0",
        },
      }).success).toBe(false);
    });

    it("validates failure with optional error data", () => {
      const fail = {
        jsonrpc: "2.0" as const,
        id: "req-1",
        error: {
          code: "validation_failed" as const,
          message: "Invalid input",
          data: { field: "name", issue: "required" },
        },
        meta: {
          protocolVersion: "1.0.0" as const,
          serverVersion: "0.1.0",
        },
      };
      expect(RpcFailureSchema.safeParse(fail).success).toBe(true);
    });
  });

  describe("StreamEnvelopeSchema", () => {
    it("validates a correct stream envelope", () => {
      const env = {
        streamId: "stream-1",
        sequence: 0,
        event: { key: "value" },
        timestamp: new Date().toISOString(),
      };
      expect(StreamEnvelopeSchema.safeParse(env).success).toBe(true);
    });

    it("rejects negative sequence numbers", () => {
      expect(StreamEnvelopeSchema.safeParse({
        streamId: "s",
        sequence: -1,
        event: {},
        timestamp: new Date().toISOString(),
      }).success).toBe(false);
    });

    it("rejects non-integer sequence numbers", () => {
      expect(StreamEnvelopeSchema.safeParse({
        streamId: "s",
        sequence: 1.5,
        event: {},
        timestamp: new Date().toISOString(),
      }).success).toBe(false);
    });

    it("validates a stream envelope with complex event data", () => {
      const env = {
        streamId: "stream-detail",
        sequence: 42,
        event: {
          type: "tool_output",
          toolName: "write_file",
          result: { path: "/output/report.md", bytesWritten: 5000 },
        },
        timestamp: new Date().toISOString(),
      };
      expect(StreamEnvelopeSchema.safeParse(env).success).toBe(true);
    });
  });
});
