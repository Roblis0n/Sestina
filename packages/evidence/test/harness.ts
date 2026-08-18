import { generateId } from "@sestina/schema";
import { ClaimService } from "../src/claim-service.js";
import { DeliverableLedgerService } from "../src/deliverables.js";
import { EvidenceService } from "../src/evidence-service.js";
import { SituationService } from "../src/situation-service.js";
import type { EvidencePorts } from "../src/ports.js";
import {
  FakeClaimStore,
  FakeConfirmationAuthority,
  FakeDeliverableStore,
  FakeEvidenceStore,
  FakeSituationStore,
  World,
  advancingPorts,
  fakePorts,
} from "./fakes.js";

// ── Shared test harness: one project, one task, all four services ──

export interface Harness {
  projectId: string;
  taskId: string;
  otherProjectId: string;
  otherTaskId: string;
  situations: SituationService;
  evidence: EvidenceService;
  claims: ClaimService;
  deliverables: DeliverableLedgerService;
  stores: {
    situations: FakeSituationStore;
    evidence: FakeEvidenceStore;
    claims: FakeClaimStore;
    deliverables: FakeDeliverableStore;
  };
  world: World;
  confirmations: FakeConfirmationAuthority;
}

export function makeHarness(ports: EvidencePorts = fakePorts()): Harness {
  const world = new World();
  const projectId = generateId();
  const taskId = generateId();
  const otherProjectId = generateId();
  const otherTaskId = generateId();
  world.tasks.set(taskId, projectId);
  world.tasks.set(otherTaskId, otherProjectId);
  const evidenceStore = new FakeEvidenceStore(world);
  const claimStore = new FakeClaimStore(world);
  const deliverableStore = new FakeDeliverableStore(world);
  const confirmations = new FakeConfirmationAuthority();
  const situationStore = new FakeSituationStore(
    world,
    evidenceStore,
    confirmations,
    () => ports.nowMs(),
  );
  evidenceStore.bindClaimsForFence(claimStore.registry);
  return {
    projectId,
    taskId,
    otherProjectId,
    otherTaskId,
    situations: new SituationService(situationStore, evidenceStore, confirmations, ports),
    evidence: new EvidenceService(evidenceStore, ports),
    claims: new ClaimService(claimStore, evidenceStore, deliverableStore, ports),
    deliverables: new DeliverableLedgerService(deliverableStore, evidenceStore, ports),
    stores: {
      situations: situationStore,
      evidence: evidenceStore,
      claims: claimStore,
      deliverables: deliverableStore,
    },
    world,
    confirmations,
  };
}

export { advancingPorts, fakePorts };

export const AGENT = { actor: "agent", channel: "runtime", directUser: false } as const;
export const USER = { actor: "user", channel: "desktop", directUser: true } as const;
export const PEER_MCP = { actor: "agent", channel: "mcp", directUser: false } as const;
export const PEER_HOOK = { actor: "hook", channel: "host", directUser: false } as const;
export const NOW_ISO = "2026-08-01T00:00:00.000Z";
export const HASH_A = "a".repeat(64);
export const HASH_B = "b".repeat(64);

/** Satisfies SestinaError assertions on code. */
export function errorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    return String((error).code);
  }
  return undefined;
}

/** Asserts the call throws a SestinaError with the given code (repo idiom). */
export function expectSestinaCode(run: () => unknown, code: string | number): void {
  try {
    run();
  } catch (error) {
    if (errorCode(error) === String(code)) return;
    throw new Error(`expected code ${code}, got ${errorCode(error)}`, { cause: error });
  }
  throw new Error(`expected a SestinaError with code ${code}`);
}
