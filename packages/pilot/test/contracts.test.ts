import { describe, expect, it } from "vitest";

import {
  createShareablePilotExport,
  parseShareablePilotExport,
} from "../src/index.js";
import { unsignedExport } from "./fixtures.js";

describe("ShareablePilotExport exact-key contract", () => {
  it("round-trips a signed export and rejects an unknown field", () => {
    const signed = createShareablePilotExport(unsignedExport());
    expect(parseShareablePilotExport(signed)).toEqual(signed);

    expect(() =>
      parseShareablePilotExport({
        ...signed,
        paperText: "SYNTHETIC_PRIVATE_PAPER_CANARY",
      }),
    ).toThrowError("pilot_export_invalid");
  });

  it("rejects unknown versions, enums, invalid boundaries, and a damaged hash", () => {
    const valid = createShareablePilotExport(unsignedExport());
    const invalidValues: unknown[] = [
      { ...valid, schemaVersion: "99.0.0" },
      { ...valid, participantRole: "friend" },
      { ...valid, totalDurationMinutes: -1 },
      { ...valid, sessionOrdinal: 3 },
      { ...valid, participantCode: "13800138000" },
      { ...valid, contentHash: "0".repeat(64) },
    ];
    for (const value of invalidValues) {
      expect(() => parseShareablePilotExport(value)).toThrowError(
        "pilot_export_invalid",
      );
    }
  });

  it("contains no free-text field or private path field", () => {
    const serialized = JSON.stringify(
      createShareablePilotExport(unsignedExport()),
    );
    for (const forbidden of [
      "notes",
      "paperText",
      "briefText",
      "privateRoot",
      "projectPath",
      "stdout",
      "stderr",
      "email",
      "institution",
    ]) {
      expect(serialized).not.toContain(`"${forbidden}"`);
    }
  });
});
