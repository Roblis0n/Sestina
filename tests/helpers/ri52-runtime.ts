import type { ClosedCodexPilotFailureCode, ClosedCodexPilotRunResult, CodexHostInspection } from "../../integrations/mcp/src/codex-host.js";
import type { ClosedExternalAppHostRuntime } from "../../apps/research-room/src/server.js";

export interface Ri52RuntimeObservation {
  readonly kind: "candidate_generation" | "continuity_check";
  readonly contextUtf8: string;
  readonly manifestHash: string;
  readonly invocationOrdinal: number;
}

export class Ri52FixtureHostRuntime implements ClosedExternalAppHostRuntime {
  readonly evidenceClass = "synthetic_fixture" as const;
  readonly observations: Ri52RuntimeObservation[] = [];
  failureCode?: ClosedCodexPilotFailureCode;
  delayMs = 650;

  constructor(private readonly decisionId: string) {}

  inspect(): Promise<CodexHostInspection> {
    return Promise.resolve({
      availability: "available",
      supportedVersion: "codex-cli synthetic-fixture",
      verifiedAt: "2026-08-28T03:00:00.000Z",
      capabilities: { start: "observed", structuredOutput: "observed", mcp: "observed", readOnlySandbox: "observed", cancellation: "observed", contextIsolation: "observed" },
      configurationSeparateFromVerification: true,
    });
  }

  async run(input: Parameters<ClosedExternalAppHostRuntime["run"]>[0]): Promise<ClosedCodexPilotRunResult> {
    this.observations.push({ kind: input.kind, contextUtf8: input.contextUtf8, manifestHash: input.binding.manifestHash, invocationOrdinal: this.observations.length + 1 });
    const stopped = await new Promise<boolean>((resolve) => {
      if (input.signal.aborted) { resolve(true); return; }
      const timer = setTimeout(() => { input.signal.removeEventListener("abort", abort); resolve(false); }, this.delayMs);
      const abort = () => { clearTimeout(timer); resolve(true); };
      input.signal.addEventListener("abort", abort, { once: true });
    });
    if (stopped) return { ok: false, error: { code: "cancelled_by_user", stdoutBytes: 0, stderrBytes: 0 } };
    if (this.failureCode) return { ok: false, error: { code: this.failureCode, stdoutBytes: 128, stderrBytes: 24 } };
    const mcpObservation = { health: "completed" as const, getResearchContext: "completed" as const, payloadHash: input.binding.manifestHash };
    if (input.kind === "candidate_generation") return {
      ok: true,
      value: {
        candidate: {
          candidateMarkdown: "## Bounded external candidate\n\nAdd an explicit uncertainty boundary while preserving every user-recorded Decision. " + "Long-context pressure remains readable without becoming Authority. ".repeat(22),
          materialDelta: "Adds one explicit uncertainty boundary and no automatic research action.",
          preservedDecisionIds: [this.decisionId],
          affectedIssueIds: [], evidenceUsed: [],
          unknowns: ["External-user value remains unproven.", "Host success does not establish semantic correctness."],
          reopenResolvedIssue: false, authority: "model_proposed", canMutateAuthority: false,
        },
        mcpObservation, stdoutBytes: 768, stderrBytes: 0, usage: "unavailable",
      },
    };
    return {
      ok: true,
      value: {
        continuity: {
          authority: "host_observation", canMutateAuthority: false,
          projectId: input.binding.projectId, briefId: input.binding.briefId, briefVersion: input.binding.briefVersion,
          episodeId: input.binding.episodeId, episodeStatus: input.binding.episodeStatus ?? "active",
          decisionStates: input.binding.decisionStates ?? [],
          issueStates: (input.binding.issueStates ?? []).map((item) => ({ ...item, treatAsOpenAudit: false, reopenProposed: false })),
          canonicalStateHash: input.binding.canonicalStateHash ?? input.binding.manifestHash,
        },
        mcpObservation, stdoutBytes: 512, stderrBytes: 0, usage: "unavailable",
      },
    };
  }
}

export class Ri52UnavailableHostRuntime implements ClosedExternalAppHostRuntime {
  readonly evidenceClass = "synthetic_fixture" as const;
  inspect(): Promise<CodexHostInspection> {
    return Promise.resolve({ availability: "unavailable", supportedVersion: null, capabilities: { start: "unavailable", structuredOutput: "unproven", mcp: "unproven", readOnlySandbox: "unproven", cancellation: "unproven", contextIsolation: "unproven" }, configurationSeparateFromVerification: true });
  }
  run(): Promise<ClosedCodexPilotRunResult> { return Promise.resolve({ ok: false, error: { code: "host_unavailable" } }); }
}
