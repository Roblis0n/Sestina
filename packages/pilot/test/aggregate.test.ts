import { describe, expect, it } from "vitest";

import {
  aggregatePilotExports,
  createShareablePilotExport,
  parsePilotAggregateReport,
  renderPilotAggregateJson,
  renderPilotAggregateMarkdown,
} from "../src/index.js";
import { unsignedExport } from "./fixtures.js";

function external(
  code: string,
  ordinal: 1 | 2,
  seed: string,
  overrides: Parameters<typeof unsignedExport>[0] = {},
) {
  return createShareablePilotExport(
    unsignedExport({
      participantCode: code,
      sessionId: `ps_${seed.repeat(32).slice(0, 32)}`,
      evidenceId: `pe_${seed.repeat(24).slice(0, 24)}`,
      sessionOrdinal: ordinal,
      secondUseObserved: ordinal === 2,
      ...overrides,
    }),
  );
}

describe("deterministic Pilot aggregation", () => {
  it("isolates external denominators, reports missing values, and proves second use only with session 2", () => {
    const exports = [
      external("EXT-0001", 1, "1"),
      external("EXT-0001", 2, "2", {
        hostEntry: "research_room_with_mcp",
        preferredEntry: "research_room_with_mcp",
      }),
      external("EXT-0002", 1, "3", {
        setup: { outcome: "failure", durationMinutes: 15 },
        episode: { outcome: "not_completed", durationMinutes: null },
        exitResult: "exited",
        exitPoint: "review",
        repeatCorrectionImpact: "increased",
        wouldUseAgain: "no",
        failureObserved: true,
        negativeFeedbackObserved: true,
      }),
      external("OWNER", 1, "4", { participantRole: "project_owner" }),
      external("FIXTURE", 2, "5", { participantRole: "internal_test" }),
    ];

    const report = aggregatePilotExports(exports);
    expect(report.sample.externalParticipantCount).toBe(2);
    expect(report.sample.externalSessionCount).toBe(3);
    expect(report.sample.excludedSessionCount).toBe(2);
    expect(report.sample.status).toBe("insufficient_external_sample");
    expect(report.setup.successRate).toMatchObject({
      numerator: 1,
      denominator: 2,
      missing: 0,
    });
    expect(report.episode.completionRate.numerator).toBe(2);
    expect(report.secondUse.status).toBe("second_use_proven");
    expect(report.secondUse.rate).toMatchObject({
      numerator: 1,
      denominator: 2,
      missing: 1,
    });
    expect(report.failures.failureSessionCount).toBe(1);
    expect(report.failures.exitSessionCount).toBe(1);
    expect(report.failures.negativeFeedbackSessionCount).toBe(1);
    expect(report.exitPoints).toMatchObject({
      counts: { review: 1 },
      denominator: 3,
      missing: 2,
    });
  });

  it("deduplicates byte-equivalent exports and rejects conflicting participant ordinals", () => {
    const first = external("EXT-0001", 1, "1");
    expect(aggregatePilotExports([first, first]).sample.externalSessionCount).toBe(
      1,
    );

    const conflict = external("EXT-0001", 1, "9");
    expect(() => aggregatePilotExports([first, conflict])).toThrowError(
      "pilot_aggregate_conflict",
    );
    const evidenceConflict = external("EXT-0002", 1, "2", {
      evidenceId: first.evidenceId,
    });
    expect(() => aggregatePilotExports([first, evidenceConflict])).toThrowError(
      "pilot_aggregate_conflict",
    );
  });

  it("is byte-stable across input order and never upgrades a small sample to a decision", () => {
    const first = external("EXT-0001", 1, "1");
    const second = external("EXT-0002", 1, "2");
    const left = aggregatePilotExports([first, second]);
    const right = aggregatePilotExports([second, first]);
    expect(renderPilotAggregateJson(left)).toBe(renderPilotAggregateJson(right));
    expect(renderPilotAggregateMarkdown(left)).toBe(
      renderPilotAggregateMarkdown(right),
    );
    expect(left.sample.status).toBe("insufficient_external_sample");
    expect(left.secondUse.status).toBe("second_use_unproven");
    expect(left).not.toHaveProperty("decision");
    expect(parsePilotAggregateReport(left)).toEqual(left);
    expect(() =>
      parsePilotAggregateReport({ ...left, conclusion: "go" }),
    ).toThrowError("pilot_aggregate_invalid");
    expect(() =>
      parsePilotAggregateReport({
        ...left,
        setup: {
          ...left.setup,
          successRate: {
            ...left.setup.successRate,
            missing: left.setup.successRate.denominator,
          },
        },
      }),
    ).toThrowError("pilot_aggregate_invalid");

    const unpairedSecond = aggregatePilotExports([
      external("EXT-ONLY-SECOND", 2, "8"),
    ]);
    expect(unpairedSecond.secondUse).toMatchObject({
      status: "second_use_unproven",
      rate: { numerator: 0, denominator: 1, missing: 1 },
    });
  });

  it("reports the full five-participant synthetic matrix with explicit denominators", () => {
    const values = [
      external("EXT-0001", 1, "1"),
      external("EXT-0001", 2, "2", {
        preferredEntry: "research_room_with_mcp",
      }),
      external("EXT-0002", 1, "3", { uiNeed: "yes" }),
      external("EXT-0003", 1, "4", { repeatCorrectionImpact: "unchanged" }),
      external("EXT-0004", 1, "5", { repeatCorrectionImpact: "uncertain" }),
      external("EXT-0005", 1, "6", {
        setup: { outcome: "failure", durationMinutes: 12 },
        episode: { outcome: "not_completed", durationMinutes: null },
        exitResult: "abandoned",
        exitPoint: "download",
        repeatCorrectionImpact: "increased",
        wouldUseAgain: "no",
        failureObserved: true,
        negativeFeedbackObserved: true,
      }),
      external("OWNER", 1, "7", { participantRole: "project_owner" }),
    ];
    const report = aggregatePilotExports(values);
    expect(report.sample).toMatchObject({
      status: "sufficient_external_sample_no_decision",
      externalParticipantCount: 5,
      externalSessionCount: 6,
      excludedSessionCount: 1,
    });
    expect(report.setup.successRate).toMatchObject({
      numerator: 4,
      denominator: 5,
      missing: 0,
      percentage: 80,
    });
    expect(report.episode.completionRate).toMatchObject({
      numerator: 5,
      denominator: 6,
      missing: 0,
      percentage: 83.33,
    });
    expect(report.secondUse.rate).toMatchObject({
      numerator: 1,
      denominator: 5,
      missing: 4,
      percentage: 20,
    });
    expect(report.repeatCorrection.counts).toEqual({
      reduced: 3,
      unchanged: 1,
      increased: 1,
      uncertain: 1,
    });
    expect(report.failures).toMatchObject({
      failureSessionCount: 1,
      exitSessionCount: 1,
      negativeFeedbackSessionCount: 1,
    });
  });
});
