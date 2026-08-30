import {
  DESKTOP_NEEDS,
  DESKTOP_SOLUTION_EVIDENCE,
  DISTRIBUTION_SOURCES,
  FRICTION_SEVERITIES,
  JOURNEY_OUTCOMES,
  OPERATING_MODES,
  PILOT_AGGREGATE_SCHEMA_VERSION,
  PILOT_EXIT_POINTS,
  PREFERRED_ENTRIES,
  RECOVERY_OUTCOMES,
  RELEASE_PLATFORMS,
  REPEAT_CORRECTION_IMPACTS,
  SESSION_EXIT_RESULTS,
  STEP_OUTCOMES,
  SYNTHETIC_CASE_DISCUSSION_VALUES,
  UI_NEEDS,
  WOULD_USE_AGAIN_VALUES,
  canonicalStringify,
  expectExactKeys,
  isRecord,
  parseShareablePilotExport,
  sha256,
  type ShareablePilotExport,
} from "./contracts.js";

export interface ProportionMetric {
  readonly numerator: number;
  readonly denominator: number;
  readonly missing: number;
  readonly percentage: number | null;
  readonly evidenceIds: readonly string[];
}

export interface DurationDistribution {
  readonly count: number;
  readonly minimumMinutes: number | null;
  readonly medianMinutes: number | null;
  readonly maximumMinutes: number | null;
  readonly evidenceIds: readonly string[];
}

export interface CategoryMetric {
  readonly counts: Readonly<Record<string, number>>;
  readonly denominator: number;
  readonly missing: number;
  readonly evidenceIds: readonly string[];
}

export interface BurdenMetric extends CategoryMetric {
  readonly average: number | null;
}

export interface PilotAggregateReport {
  readonly schemaVersion: typeof PILOT_AGGREGATE_SCHEMA_VERSION;
  readonly inputHash: string;
  readonly sample: {
    readonly status:
      | "insufficient_external_sample"
      | "sufficient_external_sample_no_decision";
    readonly inputExportCount: number;
    readonly deduplicatedExportCount: number;
    readonly externalParticipantCount: number;
    readonly externalSessionCount: number;
    readonly excludedSessionCount: number;
    readonly evidenceIds: readonly string[];
  };
  readonly setup: {
    readonly successRate: ProportionMetric;
    readonly duration: DurationDistribution;
  };
  readonly publicPreview: {
    readonly releasePlatform: CategoryMetric;
    readonly distributionSource: CategoryMetric;
    readonly operatingMode: CategoryMetric;
  };
  readonly distribution: {
    readonly downloadSuccessRate: ProportionMetric;
    readonly checksumSuccessRate: ProportionMetric;
    readonly extractionSuccessRate: ProportionMetric;
    readonly firstLaunchSuccessRate: ProportionMetric;
    readonly timeToRoom: DurationDistribution;
    readonly failurePoints: CategoryMetric;
  };
  readonly journey: {
    readonly project: CategoryMetric;
    readonly brief: CategoryMetric;
    readonly review: CategoryMetric;
    readonly manifest: CategoryMetric;
    readonly disposition: CategoryMetric;
    readonly receipt: CategoryMetric;
    readonly recovery: CategoryMetric;
    readonly relaunch: CategoryMetric;
  };
  readonly localWebLifecycle: {
    readonly outcome: CategoryMetric;
    readonly frictionSeverity: CategoryMetric;
    readonly blockingRate: ProportionMetric;
  };
  readonly episode: {
    readonly completionRate: ProportionMetric;
    readonly duration: DurationDistribution;
  };
  readonly exitResults: CategoryMetric;
  readonly exitPoints: CategoryMetric;
  readonly repeatCorrection: CategoryMetric;
  readonly findings: {
    readonly counts: {
      readonly necessary: number;
      readonly unnecessary: number;
      readonly uncertain: number;
    };
    readonly necessaryRate: ProportionMetric;
    readonly unnecessaryRate: ProportionMetric;
    readonly uncertainRate: ProportionMetric;
  };
  readonly maintenanceBurden: {
    readonly brief: BurdenMetric;
    readonly decision: BurdenMetric;
    readonly issue: BurdenMetric;
    readonly manifest: BurdenMetric;
    readonly recovery: BurdenMetric;
  };
  readonly secondUse: {
    readonly status: "second_use_unproven" | "second_use_proven";
    readonly rate: ProportionMetric;
  };
  readonly entryPreference: CategoryMetric;
  readonly desktopNeed: CategoryMetric;
  readonly desktopSolutionEvidence: CategoryMetric;
  readonly uiNeed: CategoryMetric;
  readonly syntheticCaseDiscussion: CategoryMetric;
  readonly wouldUseAgain: CategoryMetric;
  readonly failures: {
    readonly failureSessionCount: number;
    readonly exitSessionCount: number;
    readonly negativeFeedbackSessionCount: number;
    readonly evidenceIds: readonly string[];
  };
  readonly ri55Eligibility: {
    readonly status:
      | "waiting_real_public_preview_behavior_evidence"
      | "eligible_for_product_shape_review";
    readonly requiredExternalParticipants: 5;
    readonly missingExternalParticipants: number;
    readonly requiredPairedParticipants: 1;
    readonly pairedParticipantCount: number;
    readonly missingPairedParticipants: number;
    readonly requiredBehaviorFieldGroups: readonly [
      "distribution",
      "journey",
      "local_web_lifecycle",
      "desktop_need",
      "maintenance_burden",
      "repeat_correction",
      "willingness",
      "failures_and_exits",
    ];
    readonly missingBehaviorFieldSessions: number;
    readonly missingBehaviorFieldGroups: number;
  };
  readonly limitations: readonly [
    "no_automatic_go_no_go",
    "synthetic_fixtures_are_not_pilot_evidence",
    "participant_self_report_is_not_semantic_completion_proof",
  ];
}

const compareExport = (
  left: ShareablePilotExport,
  right: ShareablePilotExport,
): number =>
  left.participantCode.localeCompare(right.participantCode, "en") ||
  left.sessionOrdinal - right.sessionOrdinal ||
  left.sessionId.localeCompare(right.sessionId, "en");

function evidence(values: readonly ShareablePilotExport[]): string[] {
  return [...new Set(values.map((value) => value.evidenceId))].sort();
}

function percentage(numerator: number, denominator: number): number | null {
  return denominator === 0
    ? null
    : Number(((numerator / denominator) * 100).toFixed(2));
}

function proportion(
  values: readonly ShareablePilotExport[],
  numerator: (value: ShareablePilotExport) => boolean,
  missing: (value: ShareablePilotExport) => boolean = () => false,
): ProportionMetric {
  const numeratorValues = values.filter(numerator);
  const missingCount = values.filter(missing).length;
  return {
    numerator: numeratorValues.length,
    denominator: values.length,
    missing: missingCount,
    percentage: percentage(numeratorValues.length, values.length),
    evidenceIds: evidence(values.filter((value) => !missing(value))),
  };
}

function durations(
  values: readonly ShareablePilotExport[],
  select: (value: ShareablePilotExport) => number | null,
): DurationDistribution {
  const observed = values
    .map((value) => ({ value, duration: select(value) }))
    .filter(
      (item): item is { value: ShareablePilotExport; duration: number } =>
        item.duration !== null,
    );
  const ordered = observed.map((item) => item.duration).sort((a, b) => a - b);
  let median: number | null = null;
  if (ordered.length > 0) {
    const middle = Math.floor(ordered.length / 2);
    median =
      ordered.length % 2 === 1
        ? (ordered[middle] ?? null)
        : Number(
            (((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2).toFixed(
              2,
            ),
          );
  }
  return {
    count: ordered.length,
    minimumMinutes: ordered[0] ?? null,
    medianMinutes: median,
    maximumMinutes: ordered.at(-1) ?? null,
    evidenceIds: evidence(observed.map((item) => item.value)),
  };
}

function category(
  values: readonly ShareablePilotExport[],
  categories: readonly string[],
  select: (value: ShareablePilotExport) => string,
): CategoryMetric {
  const counts = Object.fromEntries(categories.map((item) => [item, 0]));
  for (const value of values) {
    const selected = select(value);
    counts[selected] = (counts[selected] ?? 0) + 1;
  }
  return {
    counts,
    denominator: values.length,
    missing: 0,
    evidenceIds: evidence(values),
  };
}

function optionalCategory(
  values: readonly ShareablePilotExport[],
  categories: readonly string[],
  select: (value: ShareablePilotExport) => string | null,
): CategoryMetric {
  const counts = Object.fromEntries(categories.map((item) => [item, 0]));
  const observed: ShareablePilotExport[] = [];
  for (const value of values) {
    const selected = select(value);
    if (selected === null) continue;
    counts[selected] = (counts[selected] ?? 0) + 1;
    observed.push(value);
  }
  return {
    counts,
    denominator: values.length,
    missing: values.length - observed.length,
    evidenceIds: evidence(observed),
  };
}

function burden(
  values: readonly ShareablePilotExport[],
  select: (value: ShareablePilotExport) => number,
): BurdenMetric {
  const metric = category(values, ["1", "2", "3", "4", "5"], (value) =>
    String(select(value)),
  );
  const average =
    values.length === 0
      ? null
      : Number(
          (
            values.reduce((sum, value) => sum + select(value), 0) /
            values.length
          ).toFixed(2),
        );
  return { ...metric, average };
}

function findingRate(
  values: readonly ShareablePilotExport[],
  kind: "necessary" | "unnecessary" | "uncertain",
  totals: Readonly<Record<typeof kind, number>>,
): ProportionMetric {
  const denominator = totals.necessary + totals.unnecessary + totals.uncertain;
  return {
    numerator: totals[kind],
    denominator,
    missing: 0,
    percentage: percentage(totals[kind], denominator),
    evidenceIds: evidence(values),
  };
}

export function aggregatePilotExports(
  rawExports: readonly unknown[],
): PilotAggregateReport {
  const parsed = rawExports.map((value) => parseShareablePilotExport(value));
  const byParticipantOrdinal = new Map<string, ShareablePilotExport>();
  const bySessionId = new Map<string, ShareablePilotExport>();
  const byEvidenceId = new Map<string, ShareablePilotExport>();
  for (const value of parsed) {
    const participantKey = `${value.participantCode}:${value.sessionOrdinal}`;
    const existingParticipant = byParticipantOrdinal.get(participantKey);
    if (
      existingParticipant !== undefined &&
      existingParticipant.contentHash !== value.contentHash
    ) {
      throw new Error("pilot_aggregate_conflict");
    }
    const existingSession = bySessionId.get(value.sessionId);
    if (
      existingSession !== undefined &&
      (existingSession.participantCode !== value.participantCode ||
        existingSession.sessionOrdinal !== value.sessionOrdinal ||
        existingSession.contentHash !== value.contentHash)
    ) {
      throw new Error("pilot_aggregate_conflict");
    }
    const existingEvidence = byEvidenceId.get(value.evidenceId);
    if (
      existingEvidence !== undefined &&
      (existingEvidence.participantCode !== value.participantCode ||
        existingEvidence.sessionId !== value.sessionId ||
        existingEvidence.contentHash !== value.contentHash)
    ) {
      throw new Error("pilot_aggregate_conflict");
    }
    byParticipantOrdinal.set(participantKey, value);
    bySessionId.set(value.sessionId, value);
    byEvidenceId.set(value.evidenceId, value);
  }
  const deduplicated = [...byParticipantOrdinal.values()].sort(compareExport);
  const external = deduplicated.filter(
    (value) => value.participantRole === "external_researcher",
  );
  const firstSessions = external.filter((value) => value.sessionOrdinal === 1);
  const participantCodes = [...new Set(external.map((value) => value.participantCode))].sort();
  const firstUseParticipants = new Set(
    firstSessions.map((value) => value.participantCode),
  );
  const validSecondSessions = external.filter(
    (value) =>
      value.sessionOrdinal === 2 &&
      value.secondUseObserved &&
      firstUseParticipants.has(value.participantCode),
  );
  const secondUseParticipants = new Set(
    validSecondSessions.map((value) => value.participantCode),
  );
  const secondUseEvidence = evidence(validSecondSessions);
  const findings = external.reduce(
    (totals, value) => ({
      necessary: totals.necessary + value.findingAssessment.necessary,
      unnecessary: totals.unnecessary + value.findingAssessment.unnecessary,
      uncertain: totals.uncertain + value.findingAssessment.uncertain,
    }),
    { necessary: 0, unnecessary: 0, uncertain: 0 },
  );
  const secondUseRate: ProportionMetric = {
    numerator: secondUseParticipants.size,
    denominator: participantCodes.length,
    missing: participantCodes.length - secondUseParticipants.size,
    percentage: percentage(secondUseParticipants.size, participantCodes.length),
    evidenceIds: secondUseEvidence,
  };
  const allEvidence = evidence(external);
  return {
    schemaVersion: PILOT_AGGREGATE_SCHEMA_VERSION,
    inputHash: sha256(
      deduplicated.map((value) => canonicalStringify(value)).join("\n"),
    ),
    sample: {
      status:
        participantCodes.length < 5
          ? "insufficient_external_sample"
          : "sufficient_external_sample_no_decision",
      inputExportCount: parsed.length,
      deduplicatedExportCount: deduplicated.length,
      externalParticipantCount: participantCodes.length,
      externalSessionCount: external.length,
      excludedSessionCount: deduplicated.length - external.length,
      evidenceIds: allEvidence,
    },
    setup: {
      successRate: proportion(
        firstSessions,
        (value) => value.setup.outcome === "success",
        (value) => value.setup.outcome === "not_observed",
      ),
      duration: durations(firstSessions, (value) => value.setup.durationMinutes),
    },
    publicPreview: {
      releasePlatform: category(
        external,
        RELEASE_PLATFORMS,
        (value) => value.releasePlatform,
      ),
      distributionSource: category(
        external,
        DISTRIBUTION_SOURCES,
        (value) => value.distributionSource,
      ),
      operatingMode: category(
        external,
        OPERATING_MODES,
        (value) => value.operatingMode,
      ),
    },
    distribution: {
      downloadSuccessRate: proportion(
        external,
        (value) => value.distribution.download.outcome === "success",
        (value) => value.distribution.download.outcome === "not_observed",
      ),
      checksumSuccessRate: proportion(
        external,
        (value) =>
          value.distribution.checksumVerification.outcome === "success",
        (value) =>
          value.distribution.checksumVerification.outcome === "not_observed",
      ),
      extractionSuccessRate: proportion(
        external,
        (value) => value.distribution.extraction.outcome === "success",
        (value) => value.distribution.extraction.outcome === "not_observed",
      ),
      firstLaunchSuccessRate: proportion(
        external,
        (value) => value.distribution.firstLaunch.outcome === "success",
        (value) => value.distribution.firstLaunch.outcome === "not_observed",
      ),
      timeToRoom: durations(
        external,
        (value) => value.distribution.timeToRoomMinutes,
      ),
      failurePoints: optionalCategory(
        external,
        PILOT_EXIT_POINTS,
        (value) => value.distribution.failurePoint,
      ),
    },
    journey: {
      project: category(external, JOURNEY_OUTCOMES, (value) => value.journey.project),
      brief: category(external, JOURNEY_OUTCOMES, (value) => value.journey.brief),
      review: category(external, JOURNEY_OUTCOMES, (value) => value.journey.review),
      manifest: category(external, JOURNEY_OUTCOMES, (value) => value.journey.manifest),
      disposition: category(
        external,
        JOURNEY_OUTCOMES,
        (value) => value.journey.disposition,
      ),
      receipt: category(external, JOURNEY_OUTCOMES, (value) => value.journey.receipt),
      recovery: category(
        external,
        RECOVERY_OUTCOMES,
        (value) => value.journey.recovery,
      ),
      relaunch: category(external, STEP_OUTCOMES, (value) => value.journey.relaunch),
    },
    localWebLifecycle: {
      outcome: category(
        external,
        STEP_OUTCOMES,
        (value) => value.localWebLifecycle.outcome,
      ),
      frictionSeverity: category(
        external,
        FRICTION_SEVERITIES,
        (value) => value.localWebLifecycle.frictionSeverity,
      ),
      blockingRate: proportion(
        external,
        (value) => value.localWebLifecycle.blocking,
      ),
    },
    episode: {
      completionRate: proportion(
        external,
        (value) => value.episode.outcome === "completed",
        (value) => value.episode.outcome === "not_observed",
      ),
      duration: durations(external, (value) => value.episode.durationMinutes),
    },
    exitResults: category(
      external,
      SESSION_EXIT_RESULTS,
      (value) => value.exitResult,
    ),
    exitPoints: optionalCategory(
      external,
      PILOT_EXIT_POINTS,
      (value) => value.exitPoint,
    ),
    repeatCorrection: category(
      external,
      REPEAT_CORRECTION_IMPACTS,
      (value) => value.repeatCorrectionImpact,
    ),
    findings: {
      counts: findings,
      necessaryRate: findingRate(external, "necessary", findings),
      unnecessaryRate: findingRate(external, "unnecessary", findings),
      uncertainRate: findingRate(external, "uncertain", findings),
    },
    maintenanceBurden: {
      brief: burden(external, (value) => value.maintenanceBurden.brief),
      decision: burden(external, (value) => value.maintenanceBurden.decision),
      issue: burden(external, (value) => value.maintenanceBurden.issue),
      manifest: burden(external, (value) => value.maintenanceBurden.manifest),
      recovery: burden(external, (value) => value.maintenanceBurden.recovery),
    },
    secondUse: {
      status:
        secondUseParticipants.size === 0
          ? "second_use_unproven"
          : "second_use_proven",
      rate: secondUseRate,
    },
    entryPreference: category(
      external,
      PREFERRED_ENTRIES,
      (value) => value.preferredEntry,
    ),
    desktopNeed: category(
      external,
      DESKTOP_NEEDS,
      (value) => value.desktopNeed,
    ),
    desktopSolutionEvidence: category(
      external,
      DESKTOP_SOLUTION_EVIDENCE,
      (value) => value.desktopSolutionEvidence,
    ),
    uiNeed: category(external, UI_NEEDS, (value) => value.uiNeed),
    syntheticCaseDiscussion: category(
      external,
      SYNTHETIC_CASE_DISCUSSION_VALUES,
      (value) => value.syntheticCaseDiscussion,
    ),
    wouldUseAgain: category(
      external,
      WOULD_USE_AGAIN_VALUES,
      (value) => value.wouldUseAgain,
    ),
    failures: {
      failureSessionCount: external.filter((value) => value.failureObserved)
        .length,
      exitSessionCount: external.filter(
        (value) => value.exitResult !== "completed",
      ).length,
      negativeFeedbackSessionCount: external.filter(
        (value) => value.negativeFeedbackObserved,
      ).length,
      evidenceIds: evidence(
        external.filter(
          (value) =>
            value.failureObserved ||
            value.exitResult !== "completed" ||
            value.negativeFeedbackObserved,
        ),
      ),
    },
    ri55Eligibility: {
      status:
        participantCodes.length >= 5 && secondUseParticipants.size >= 1
          ? "eligible_for_product_shape_review"
          : "waiting_real_public_preview_behavior_evidence",
      requiredExternalParticipants: 5,
      missingExternalParticipants: Math.max(0, 5 - participantCodes.length),
      requiredPairedParticipants: 1,
      pairedParticipantCount: secondUseParticipants.size,
      missingPairedParticipants: Math.max(0, 1 - secondUseParticipants.size),
      requiredBehaviorFieldGroups: [
        "distribution",
        "journey",
        "local_web_lifecycle",
        "desktop_need",
        "maintenance_burden",
        "repeat_correction",
        "willingness",
        "failures_and_exits",
      ],
      missingBehaviorFieldSessions: Math.max(0, 5 - firstSessions.length),
      missingBehaviorFieldGroups:
        Math.max(0, 5 - firstSessions.length) * 8,
    },
    limitations: [
      "no_automatic_go_no_go",
      "synthetic_fixtures_are_not_pilot_evidence",
      "participant_self_report_is_not_semantic_completion_proof",
    ],
  };
}

function aggregateInvalid(): never {
  throw new Error("pilot_aggregate_invalid");
}

function aggregateInteger(value: unknown, maximum = 1_000_000): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    aggregateInvalid();
  }
  return value as number;
}

function aggregateEvidence(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    aggregateInvalid();
  }
  const parsed = value.map((item): string => {
    if (typeof item !== "string" || !/^pe_[a-f0-9]{24}$/u.test(item)) {
      aggregateInvalid();
    }
    return item;
  });
  const sorted = [...parsed].sort();
  if (
    new Set(parsed).size !== parsed.length ||
    parsed.some((item, index) => item !== sorted[index])
  ) {
    aggregateInvalid();
  }
  return parsed;
}

function parseProportion(value: unknown): void {
  expectExactKeys(
    value,
    ["numerator", "denominator", "missing", "percentage", "evidenceIds"],
    "pilot_aggregate_invalid",
  );
  const numerator = aggregateInteger(value.numerator);
  const denominator = aggregateInteger(value.denominator);
  const missing = aggregateInteger(value.missing);
  if (numerator > denominator || numerator + missing > denominator) {
    aggregateInvalid();
  }
  const expected =
    denominator === 0
      ? null
      : Number(((numerator / denominator) * 100).toFixed(2));
  if (value.percentage !== expected) aggregateInvalid();
  aggregateEvidence(value.evidenceIds);
}

function parseDuration(value: unknown): void {
  expectExactKeys(
    value,
    [
      "count",
      "minimumMinutes",
      "medianMinutes",
      "maximumMinutes",
      "evidenceIds",
    ],
    "pilot_aggregate_invalid",
  );
  const count = aggregateInteger(value.count);
  for (const item of [
    value.minimumMinutes,
    value.medianMinutes,
    value.maximumMinutes,
  ]) {
    if (item !== null && (typeof item !== "number" || item < 0 || item > 1_440)) {
      aggregateInvalid();
    }
  }
  if (
    (count === 0) !==
    (value.minimumMinutes === null &&
      value.medianMinutes === null &&
      value.maximumMinutes === null)
  ) {
    aggregateInvalid();
  }
  if (
    count > 0 &&
    ((value.minimumMinutes as number) > (value.medianMinutes as number) ||
      (value.medianMinutes as number) > (value.maximumMinutes as number))
  ) {
    aggregateInvalid();
  }
  aggregateEvidence(value.evidenceIds);
}

function parseCategory(
  value: unknown,
  expectedCategories: readonly string[],
  burden = false,
): void {
  expectExactKeys(
    value,
    burden
      ? ["counts", "denominator", "missing", "evidenceIds", "average"]
      : ["counts", "denominator", "missing", "evidenceIds"],
    "pilot_aggregate_invalid",
  );
  const countsValue = value.counts;
  expectExactKeys(countsValue, expectedCategories, "pilot_aggregate_invalid");
  const total = expectedCategories.reduce(
    (sum, categoryName) => sum + aggregateInteger(countsValue[categoryName]),
    0,
  );
  const denominator = aggregateInteger(value.denominator);
  const missing = aggregateInteger(value.missing);
  if (total + missing !== denominator) aggregateInvalid();
  aggregateEvidence(value.evidenceIds);
  if (burden) {
    if (
      value.average !== null &&
      (typeof value.average !== "number" || value.average < 1 || value.average > 5)
    ) {
      aggregateInvalid();
    }
    if ((denominator === 0) !== (value.average === null)) aggregateInvalid();
  }
}

export function parsePilotAggregateReport(value: unknown): PilotAggregateReport {
  expectExactKeys(
    value,
    [
      "schemaVersion",
      "inputHash",
      "sample",
      "setup",
      "publicPreview",
      "distribution",
      "journey",
      "localWebLifecycle",
      "episode",
      "exitResults",
      "exitPoints",
      "repeatCorrection",
      "findings",
      "maintenanceBurden",
      "secondUse",
      "entryPreference",
      "desktopNeed",
      "desktopSolutionEvidence",
      "uiNeed",
      "syntheticCaseDiscussion",
      "wouldUseAgain",
      "failures",
      "ri55Eligibility",
      "limitations",
    ],
    "pilot_aggregate_invalid",
  );
  if (
    value.schemaVersion !== PILOT_AGGREGATE_SCHEMA_VERSION ||
    typeof value.inputHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.inputHash)
  ) {
    aggregateInvalid();
  }
  expectExactKeys(
    value.sample,
    [
      "status",
      "inputExportCount",
      "deduplicatedExportCount",
      "externalParticipantCount",
      "externalSessionCount",
      "excludedSessionCount",
      "evidenceIds",
    ],
    "pilot_aggregate_invalid",
  );
  const participants = aggregateInteger(value.sample.externalParticipantCount);
  const externalSessions = aggregateInteger(value.sample.externalSessionCount);
  const excluded = aggregateInteger(value.sample.excludedSessionCount);
  const deduplicated = aggregateInteger(value.sample.deduplicatedExportCount);
  const inputCount = aggregateInteger(value.sample.inputExportCount);
  if (
    externalSessions + excluded !== deduplicated ||
    deduplicated > inputCount ||
    participants > externalSessions ||
    value.sample.status !==
      (participants < 5
        ? "insufficient_external_sample"
        : "sufficient_external_sample_no_decision")
  ) {
    aggregateInvalid();
  }
  aggregateEvidence(value.sample.evidenceIds);
  expectExactKeys(value.setup, ["successRate", "duration"], "pilot_aggregate_invalid");
  parseProportion(value.setup.successRate);
  parseDuration(value.setup.duration);
  expectExactKeys(
    value.publicPreview,
    ["releasePlatform", "distributionSource", "operatingMode"],
    "pilot_aggregate_invalid",
  );
  parseCategory(value.publicPreview.releasePlatform, RELEASE_PLATFORMS);
  parseCategory(value.publicPreview.distributionSource, DISTRIBUTION_SOURCES);
  parseCategory(value.publicPreview.operatingMode, OPERATING_MODES);
  expectExactKeys(
    value.distribution,
    [
      "downloadSuccessRate",
      "checksumSuccessRate",
      "extractionSuccessRate",
      "firstLaunchSuccessRate",
      "timeToRoom",
      "failurePoints",
    ],
    "pilot_aggregate_invalid",
  );
  for (const key of [
    "downloadSuccessRate",
    "checksumSuccessRate",
    "extractionSuccessRate",
    "firstLaunchSuccessRate",
  ] as const) {
    parseProportion(value.distribution[key]);
  }
  parseDuration(value.distribution.timeToRoom);
  parseCategory(value.distribution.failurePoints, PILOT_EXIT_POINTS);
  expectExactKeys(
    value.journey,
    [
      "project",
      "brief",
      "review",
      "manifest",
      "disposition",
      "receipt",
      "recovery",
      "relaunch",
    ],
    "pilot_aggregate_invalid",
  );
  for (const key of [
    "project",
    "brief",
    "review",
    "manifest",
    "disposition",
    "receipt",
  ] as const) {
    parseCategory(value.journey[key], JOURNEY_OUTCOMES);
  }
  parseCategory(value.journey.recovery, RECOVERY_OUTCOMES);
  parseCategory(value.journey.relaunch, STEP_OUTCOMES);
  expectExactKeys(
    value.localWebLifecycle,
    ["outcome", "frictionSeverity", "blockingRate"],
    "pilot_aggregate_invalid",
  );
  parseCategory(value.localWebLifecycle.outcome, STEP_OUTCOMES);
  parseCategory(
    value.localWebLifecycle.frictionSeverity,
    FRICTION_SEVERITIES,
  );
  parseProportion(value.localWebLifecycle.blockingRate);
  expectExactKeys(value.episode, ["completionRate", "duration"], "pilot_aggregate_invalid");
  parseProportion(value.episode.completionRate);
  parseDuration(value.episode.duration);
  parseCategory(value.exitResults, SESSION_EXIT_RESULTS);
  parseCategory(value.exitPoints, PILOT_EXIT_POINTS);
  parseCategory(value.repeatCorrection, REPEAT_CORRECTION_IMPACTS);
  expectExactKeys(
    value.findings,
    ["counts", "necessaryRate", "unnecessaryRate", "uncertainRate"],
    "pilot_aggregate_invalid",
  );
  expectExactKeys(
    value.findings.counts,
    ["necessary", "unnecessary", "uncertain"],
    "pilot_aggregate_invalid",
  );
  for (const key of ["necessary", "unnecessary", "uncertain"] as const) {
    aggregateInteger(value.findings.counts[key]);
  }
  parseProportion(value.findings.necessaryRate);
  parseProportion(value.findings.unnecessaryRate);
  parseProportion(value.findings.uncertainRate);
  expectExactKeys(
    value.maintenanceBurden,
    ["brief", "decision", "issue", "manifest", "recovery"],
    "pilot_aggregate_invalid",
  );
  for (const key of [
    "brief",
    "decision",
    "issue",
    "manifest",
    "recovery",
  ] as const) {
    parseCategory(value.maintenanceBurden[key], ["1", "2", "3", "4", "5"], true);
  }
  expectExactKeys(value.secondUse, ["status", "rate"], "pilot_aggregate_invalid");
  parseProportion(value.secondUse.rate);
  if (
    !isRecord(value.secondUse.rate) ||
    value.secondUse.status !==
      ((value.secondUse.rate.numerator as number) === 0
        ? "second_use_unproven"
        : "second_use_proven")
  ) {
    aggregateInvalid();
  }
  parseCategory(value.entryPreference, PREFERRED_ENTRIES);
  parseCategory(value.desktopNeed, DESKTOP_NEEDS);
  parseCategory(
    value.desktopSolutionEvidence,
    DESKTOP_SOLUTION_EVIDENCE,
  );
  parseCategory(value.uiNeed, UI_NEEDS);
  parseCategory(
    value.syntheticCaseDiscussion,
    SYNTHETIC_CASE_DISCUSSION_VALUES,
  );
  parseCategory(value.wouldUseAgain, WOULD_USE_AGAIN_VALUES);
  expectExactKeys(
    value.failures,
    [
      "failureSessionCount",
      "exitSessionCount",
      "negativeFeedbackSessionCount",
      "evidenceIds",
    ],
    "pilot_aggregate_invalid",
  );
  for (const key of [
    "failureSessionCount",
    "exitSessionCount",
    "negativeFeedbackSessionCount",
  ] as const) {
    if (aggregateInteger(value.failures[key]) > externalSessions) aggregateInvalid();
  }
  aggregateEvidence(value.failures.evidenceIds);
  expectExactKeys(
    value.ri55Eligibility,
    [
      "status",
      "requiredExternalParticipants",
      "missingExternalParticipants",
      "requiredPairedParticipants",
      "pairedParticipantCount",
      "missingPairedParticipants",
      "requiredBehaviorFieldGroups",
      "missingBehaviorFieldSessions",
      "missingBehaviorFieldGroups",
    ],
    "pilot_aggregate_invalid",
  );
  const paired = aggregateInteger(value.ri55Eligibility.pairedParticipantCount);
  const missingParticipants = aggregateInteger(
    value.ri55Eligibility.missingExternalParticipants,
  );
  const missingPairs = aggregateInteger(
    value.ri55Eligibility.missingPairedParticipants,
  );
  const missingBehaviorSessions = aggregateInteger(
    value.ri55Eligibility.missingBehaviorFieldSessions,
  );
  const missingBehaviorGroups = aggregateInteger(
    value.ri55Eligibility.missingBehaviorFieldGroups,
  );
  const behaviorGroups = [
    "distribution",
    "journey",
    "local_web_lifecycle",
    "desktop_need",
    "maintenance_burden",
    "repeat_correction",
    "willingness",
    "failures_and_exits",
  ];
  if (
    value.ri55Eligibility.requiredExternalParticipants !== 5 ||
    value.ri55Eligibility.requiredPairedParticipants !== 1 ||
    missingParticipants !== Math.max(0, 5 - participants) ||
    paired > participants ||
    missingPairs !== Math.max(0, 1 - paired) ||
    !Array.isArray(value.ri55Eligibility.requiredBehaviorFieldGroups) ||
    canonicalStringify(value.ri55Eligibility.requiredBehaviorFieldGroups) !==
      canonicalStringify(behaviorGroups) ||
    missingBehaviorSessions > 5 ||
    missingBehaviorGroups !== missingBehaviorSessions * behaviorGroups.length ||
    value.ri55Eligibility.status !==
      (participants >= 5 && paired >= 1
        ? "eligible_for_product_shape_review"
        : "waiting_real_public_preview_behavior_evidence")
  ) {
    aggregateInvalid();
  }
  if (
    !Array.isArray(value.limitations) ||
    value.limitations.length !== 3 ||
    value.limitations[0] !== "no_automatic_go_no_go" ||
    value.limitations[1] !== "synthetic_fixtures_are_not_pilot_evidence" ||
    value.limitations[2] !==
      "participant_self_report_is_not_semantic_completion_proof"
  ) {
    aggregateInvalid();
  }
  return structuredClone(value) as unknown as PilotAggregateReport;
}

export function renderPilotAggregateJson(report: PilotAggregateReport): string {
  return `${canonicalStringify(report)}\n`;
}

function ratio(metric: ProportionMetric): string {
  return `${metric.numerator}/${metric.denominator} (${metric.percentage ?? "not_available"}%; missing ${metric.missing})`;
}

function distribution(metric: DurationDistribution): string {
  return metric.count === 0
    ? "not_observed"
    : `n=${metric.count}; min=${metric.minimumMinutes}; median=${metric.medianMinutes}; max=${metric.maximumMinutes} minutes`;
}

function counts(metric: CategoryMetric): string {
  return Object.entries(metric.counts)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

function ids(values: readonly string[]): string {
  return values.length === 0 ? "none" : values.join(", ");
}

export function renderPilotAggregateMarkdown(
  report: PilotAggregateReport,
): string {
  const lines = [
    "# Sestina external researcher Pilot aggregate",
    "",
    "## Sample and denominators",
    `- Status: ${report.sample.status}`,
    `- External participants: ${report.sample.externalParticipantCount}`,
    `- External sessions: ${report.sample.externalSessionCount}`,
    `- Excluded project-owner/internal sessions: ${report.sample.excludedSessionCount}`,
    `- Evidence IDs: ${ids(report.sample.evidenceIds)}`,
    "",
    "## Setup",
    `- First/setup success: ${ratio(report.setup.successRate)}`,
    `- Setup duration: ${distribution(report.setup.duration)}`,
    `- Evidence IDs: ${ids(report.setup.successRate.evidenceIds)}`,
    "",
    "## Public Preview distribution",
    `- Platforms: ${counts(report.publicPreview.releasePlatform)}`,
    `- Distribution source: ${counts(report.publicPreview.distributionSource)}`,
    `- Operating mode: ${counts(report.publicPreview.operatingMode)}`,
    `- Download success: ${ratio(report.distribution.downloadSuccessRate)}`,
    `- SHA-256 verification success: ${ratio(report.distribution.checksumSuccessRate)}`,
    `- Extraction success: ${ratio(report.distribution.extractionSuccessRate)}`,
    `- First launch success: ${ratio(report.distribution.firstLaunchSuccessRate)}`,
    `- Time to Research Room: ${distribution(report.distribution.timeToRoom)}`,
    `- Distribution failure points: ${counts(report.distribution.failurePoints)}`,
    "",
    "## Research Room journey",
    `- Project: ${counts(report.journey.project)}`,
    `- Brief: ${counts(report.journey.brief)}`,
    `- Review: ${counts(report.journey.review)}`,
    `- Context Manifest: ${counts(report.journey.manifest)}`,
    `- Disposition: ${counts(report.journey.disposition)}`,
    `- Receipt: ${counts(report.journey.receipt)}`,
    `- Recovery: ${counts(report.journey.recovery)}`,
    `- Relaunch: ${counts(report.journey.relaunch)}`,
    "",
    "## Local web lifecycle",
    `- Outcome: ${counts(report.localWebLifecycle.outcome)}`,
    `- Friction severity: ${counts(report.localWebLifecycle.frictionSeverity)}`,
    `- Blocking: ${ratio(report.localWebLifecycle.blockingRate)}`,
    "",
    "## Episode",
    `- Completed one Episode: ${ratio(report.episode.completionRate)}`,
    `- Episode duration: ${distribution(report.episode.duration)}`,
    `- Evidence IDs: ${ids(report.episode.completionRate.evidenceIds)}`,
    "",
    "## Repeated correction",
    `- ${counts(report.repeatCorrection)}`,
    `- Evidence IDs: ${ids(report.repeatCorrection.evidenceIds)}`,
    "",
    "## Finding assessment",
    `- necessary=${report.findings.counts.necessary}, unnecessary=${report.findings.counts.unnecessary}, uncertain=${report.findings.counts.uncertain}`,
    `- Necessary: ${ratio(report.findings.necessaryRate)}`,
    `- Unnecessary: ${ratio(report.findings.unnecessaryRate)}`,
    `- Uncertain: ${ratio(report.findings.uncertainRate)}`,
    `- Evidence IDs: ${ids(report.findings.necessaryRate.evidenceIds)}`,
    "",
    "## State maintenance burden",
    `- Brief (1-5): average=${report.maintenanceBurden.brief.average ?? "not_available"}; ${counts(report.maintenanceBurden.brief)}`,
    `- Decision (1-5): average=${report.maintenanceBurden.decision.average ?? "not_available"}; ${counts(report.maintenanceBurden.decision)}`,
    `- Issue (1-5): average=${report.maintenanceBurden.issue.average ?? "not_available"}; ${counts(report.maintenanceBurden.issue)}`,
    `- Manifest (1-5): average=${report.maintenanceBurden.manifest.average ?? "not_available"}; ${counts(report.maintenanceBurden.manifest)}`,
    `- Recovery (1-5): average=${report.maintenanceBurden.recovery.average ?? "not_available"}; ${counts(report.maintenanceBurden.recovery)}`,
    `- Evidence IDs: ${ids(report.maintenanceBurden.brief.evidenceIds)}`,
    "",
    "## Second use",
    `- Status: ${report.secondUse.status}`,
    `- Participants with a valid real session 2: ${ratio(report.secondUse.rate)}`,
    `- Evidence IDs: ${ids(report.secondUse.rate.evidenceIds)}`,
    "",
    "## Entry and UI",
    `- Entry preference: ${counts(report.entryPreference)}`,
    `- Desktop need: ${counts(report.desktopNeed)}`,
    `- Desktop-specific solution evidence: ${counts(report.desktopSolutionEvidence)}`,
    `- UI need: ${counts(report.uiNeed)}`,
    `- Would use again: ${counts(report.wouldUseAgain)}`,
    `- Synthetic-case discussion willingness: ${counts(report.syntheticCaseDiscussion)}`,
    `- Evidence IDs: ${ids(report.entryPreference.evidenceIds)}`,
    "",
    "## Failures and exits",
    `- Exit results: ${counts(report.exitResults)}`,
    `- Exit points: ${counts(report.exitPoints)}; denominator=${report.exitPoints.denominator}; missing=${report.exitPoints.missing}`,
    `- Exit-point evidence IDs: ${ids(report.exitPoints.evidenceIds)}`,
    `- Failure sessions: ${report.failures.failureSessionCount}`,
    `- Exit sessions: ${report.failures.exitSessionCount}`,
    `- Negative-feedback sessions: ${report.failures.negativeFeedbackSessionCount}`,
    `- Evidence IDs: ${ids(report.failures.evidenceIds)}`,
    "",
    "## Negative feedback",
    `- Explicit negative-feedback sessions are retained, never filtered: ${report.failures.negativeFeedbackSessionCount}`,
    `- Would not use again: ${report.wouldUseAgain.counts.no ?? 0}`,
    "",
    "## RI-55 eligibility gate",
    `- Status: ${report.ri55Eligibility.status}`,
    `- Missing external participants: ${report.ri55Eligibility.missingExternalParticipants}/${report.ri55Eligibility.requiredExternalParticipants}`,
    `- Valid paired session-1/session-2 participants: ${report.ri55Eligibility.pairedParticipantCount}; missing ${report.ri55Eligibility.missingPairedParticipants}`,
    `- Missing participant behavior sessions: ${report.ri55Eligibility.missingBehaviorFieldSessions}`,
    `- Missing behavior field groups: ${report.ri55Eligibility.missingBehaviorFieldGroups}`,
    "",
    "## Evidence limitations",
    "- No automatic Go, Conditional Go, or No-Go decision is produced.",
    "- Synthetic fixtures are code-test inputs, not Pilot evidence.",
    "- Participant reports and successful tools do not prove semantic research benefit.",
    "",
    "## Conclusions that cannot yet be drawn",
    report.sample.status === "insufficient_external_sample"
      ? "- insufficient_external_sample"
      : "- The sample threshold alone does not establish effectiveness.",
    report.secondUse.status === "second_use_unproven"
      ? "- second_use_unproven"
      : "- Observed second use does not by itself establish research effectiveness.",
    "",
  ];
  return lines.join("\n");
}
