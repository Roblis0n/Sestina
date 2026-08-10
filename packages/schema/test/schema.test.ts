import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  ID_SCHEMA,
  generateId,
  isValidId,
} from "../src/ids.js";
import {
  HOST_SCHEMA,
  HOST_VISIBILITY_LEVEL_SCHEMA,
  PRIVACY_CLASS_SCHEMA,
  ActorProvenanceSchema,
  PreviewConfirmationSchema,
  DegradationStateSchema,
} from "../src/common.js";
import {
  SestinaErrorCode,
  SestinaError,
  isSestinaError,
  errorSchema,
} from "../src/errors.js";

// ============================================================================
// ID Tests
// ============================================================================
describe("IDs", () => {
  describe("ID_SCHEMA", () => {
    it("accepts valid ULID-like 26-char Crockford strings", () => {
      const id = generateId();
      expect(id).toHaveLength(26);
      const result = ID_SCHEMA.safeParse(id);
      expect(result.success).toBe(true);
    });

    it("rejects strings that are not 26 chars", () => {
      expect(ID_SCHEMA.safeParse("abc").success).toBe(false);
      expect(ID_SCHEMA.safeParse("").success).toBe(false);
      expect(ID_SCHEMA.safeParse("a".repeat(27)).success).toBe(false);
    });

    it("rejects strings with invalid Crockford characters (I, L, O, U)", () => {
      expect(ID_SCHEMA.safeParse("I23456789ABCDEFGHJKMNPQRS").success).toBe(false);
      expect(ID_SCHEMA.safeParse("L23456789ABCDEFGHJKMNPQRS").success).toBe(false);
      expect(ID_SCHEMA.safeParse("O23456789ABCDEFGHJKMNPQRS").success).toBe(false);
      expect(ID_SCHEMA.safeParse("U23456789ABCDEFGHJKMNPQRS").success).toBe(false);
    });

    it("rejects non-string inputs", () => {
      expect(ID_SCHEMA.safeParse(123).success).toBe(false);
      expect(ID_SCHEMA.safeParse(null).success).toBe(false);
      expect(ID_SCHEMA.safeParse(undefined).success).toBe(false);
      expect(ID_SCHEMA.safeParse({}).success).toBe(false);
    });
  });

  describe("generateId", () => {
    it("generates unique IDs", () => {
      const ids = new Set(Array.from({ length: 1000 }, () => generateId()));
      expect(ids.size).toBe(1000);
    });

    it("generates 26-character strings", () => {
      for (let i = 0; i < 100; i++) {
        expect(generateId()).toHaveLength(26);
      }
    });
  });

  describe("isValidId", () => {
    it("returns true for valid IDs", () => {
      expect(isValidId(generateId())).toBe(true);
    });

    it("returns false for invalid inputs", () => {
      expect(isValidId(null)).toBe(false);
      expect(isValidId(undefined)).toBe(false);
      expect(isValidId("")).toBe(false);
      expect(isValidId("too-short")).toBe(false);
      expect(isValidId(123)).toBe(false);
    });
  });
});

// ============================================================================
// Common Types Tests
// ============================================================================
describe("Common Types", () => {
  describe("HOST_SCHEMA", () => {
    it("accepts valid host values", () => {
      for (const host of ["codex", "claude_code", "desktop", "service", "cli", "test"]) {
        expect(HOST_SCHEMA.safeParse(host).success).toBe(true);
      }
    });

    it("rejects invalid host values", () => {
      expect(HOST_SCHEMA.safeParse("invalid").success).toBe(false);
      expect(HOST_SCHEMA.safeParse("").success).toBe(false);
    });
  });

  describe("HOST_VISIBILITY_LEVEL_SCHEMA", () => {
    it("accepts valid visibility levels", () => {
      const levels = ["full_stream", "message_stream", "tool_lifecycle", "governance_events", "disconnected"];
      for (const level of levels) {
        expect(HOST_VISIBILITY_LEVEL_SCHEMA.safeParse(level).success).toBe(true);
      }
    });
  });

  describe("PRIVACY_CLASS_SCHEMA", () => {
    it("accepts valid privacy classes", () => {
      for (const pc of ["public", "internal", "sensitive", "restricted"]) {
        expect(PRIVACY_CLASS_SCHEMA.safeParse(pc).success).toBe(true);
      }
    });
  });

  describe("ActorProvenanceSchema", () => {
    it("validates correct actor provenance", () => {
      const valid = {
        source: "user",
        verified: true,
      };
      expect(ActorProvenanceSchema.safeParse(valid).success).toBe(true);
    });

    it("includes optional fields when present", () => {
      const withSession = {
        source: "agent",
        sessionId: generateId(),
        verified: false,
        challenge: "challenge-token-123",
      };
      const result = ActorProvenanceSchema.safeParse(withSession);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sessionId).toBe(withSession.sessionId);
        expect(result.data.challenge).toBe(withSession.challenge);
      }
    });
  });

  describe("PreviewConfirmationSchema", () => {
    it("validates a preview confirmation", () => {
      const valid = {
        previewHash: "sha256:abc123def456",
        confirmedBy: { source: "user", verified: true },
        confirmedAt: new Date().toISOString(),
      };
      expect(PreviewConfirmationSchema.safeParse(valid).success).toBe(true);
    });
  });
});

// ============================================================================
// Error Tests
// ============================================================================
describe("Errors", () => {
  describe("SestinaErrorCode enum", () => {
    it("has all expected error codes", () => {
      // Verify key codes exist as enum members
      expect(SestinaErrorCode.task_not_found).toBe("task_not_found");
      expect(SestinaErrorCode.validation_failed).toBe("validation_failed");
      expect(SestinaErrorCode.internal_error).toBe("internal_error");
      expect(SestinaErrorCode.ipc_auth_failed).toBe("ipc_auth_failed");
      expect(SestinaErrorCode.provider_unavailable).toBe("provider_unavailable");
    });

    it("rejects unknown codes via nativeEnum", () => {
      const schema = z.enum(SestinaErrorCode);
      expect(schema.safeParse("not_a_real_code").success).toBe(false);
    });

    it("accepts valid codes via nativeEnum", () => {
      const schema = z.enum(SestinaErrorCode);
      expect(schema.safeParse(SestinaErrorCode.task_not_found).success).toBe(true);
      expect(schema.safeParse(SestinaErrorCode.internal_error).success).toBe(true);
    });
  });

  describe("SestinaError", () => {
    it("creates an error with code and status", () => {
      const err = new SestinaError(
        SestinaErrorCode.task_not_found,
        "Task T001 not found",
        404,
      );
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(SestinaError);
      expect(err.code).toBe("task_not_found");
      expect(err.message).toBe("Task T001 not found");
      expect(err.status).toBe(404);
    });

    it("has default status from the STATUS_MAP", () => {
      const err = new SestinaError(
        SestinaErrorCode.internal_error,
        "Something broke",
      );
      expect(err.status).toBe(500);
    });

    it("supports toJSON serialization", () => {
      const err = new SestinaError(
        SestinaErrorCode.validation_failed,
        "Invalid input",
        400,
        { field: "name" },
      );
      const json = err.toJSON();
      expect(json.code).toBe("validation_failed");
      expect(json.message).toBe("Invalid input");
      expect(json.status).toBe(400);
      expect(json.details).toEqual({ field: "name" });
    });
  });

  describe("isSestinaError", () => {
    it("identifies SestinaError instances", () => {
      const err = new SestinaError(
        SestinaErrorCode.validation_failed,
        "Invalid input",
      );
      expect(isSestinaError(err)).toBe(true);
    });

    it("returns false for regular errors", () => {
      expect(isSestinaError(new Error("regular error"))).toBe(false);
    });

    it("returns false for non-error values", () => {
      expect(isSestinaError(null)).toBe(false);
      expect(isSestinaError("string")).toBe(false);
      expect(isSestinaError({ code: "something" })).toBe(false);
    });
  });

  describe("errorSchema", () => {
    it("validates a serialized SestinaError", () => {
      const serialized = {
        name: "SestinaError",
        code: SestinaErrorCode.validation_failed,
        message: "test error",
        status: 400,
      };
      expect(errorSchema.safeParse(serialized).success).toBe(true);
    });
  });
});

// ============================================================================
// Schema Roundtrip Tests
// ============================================================================
describe("Schema serialization roundtrips", () => {
  it("ActorProvenance survives JSON roundtrip", () => {
    const original = {
      source: "user" as const,
      verified: true,
    };
    const parsed = ActorProvenanceSchema.parse(original);
    const json = JSON.stringify(parsed);
    const rehydrated = ActorProvenanceSchema.parse(JSON.parse(json));
    expect(rehydrated).toEqual(parsed);
  });

  it("DegradationState survives JSON roundtrip", () => {
    const original = {
      level: "degraded" as const,
      missingCapabilities: ["provider_openai"],
      since: new Date().toISOString(),
    };
    const parsed = DegradationStateSchema.parse(original);
    const json = JSON.stringify(parsed);
    const rehydrated = DegradationStateSchema.parse(JSON.parse(json));
    expect(rehydrated).toEqual(parsed);
  });
});
