import {
  SestinaCore as LegacyCore,
  openSestina as openLegacyCore,
  type OpenSestinaOptions,
} from "./sestina-core.js";
import { coreErr, coreOk, type CoreResult } from "./errors.js";
export function legacyFixtureWritesEnabled(): boolean {
  return false;
}
// Explicit read allowlist. New methods default to rejection; no legacy class or
// bound writer is exposed through the public facade's prototype.
const reads = new Set([
  "close",
  "getBriefState",
  "getEpisodeIntegritySummary",
  "verifyResearchSnapshot",
  "renderReviewReport",
  "renderReviewReportForRun",
  "getProject",
  "listProjects",
  "getActiveBriefProjection",
  "getArtifact",
  "listArtifacts",
  "listRevisions",
  "getRevision",
  "diffRevisions",
  "listEpisodes",
  "listDecisions",
  "getDecision",
  "listIssues",
  "getIssue",
  "listSnapshots",
  "getReviewSummary",
  "getEpisode",
  "getReviewRun",
  "getSnapshot",
  "getResearchRoomState",
  "listResearchRoomReceipts",
  "listCorrectionAppeals",
  "getCorrectionAppeal",
  "listDeliberationRooms",
  "getDeliberationRoom",
  "getProjectOverviewProjection",
  "getBriefWorkspaceProjection",
  "listDecisionProjections",
  "getDecisionProjection",
  "listIssueProjections",
  "getIssueProjection",
  "listEvidenceProjections",
  "getEvidenceProjection",
  "listEpisodeProjections",
  "getEpisodeProjection",
  "listReceiptProjections",
  "getReceiptProjection",
  "listAppealProjections",
  "getAppealProjection",
  "listDeliberationRoomProjections",
  "getDeliberationRoomProjection",
  "getAttentionProjection",
  "searchResearchObjects",
  "getProjectMemoryProjection",
  "getClosedExternalAppPilot",
  "listClosedExternalAppPilots",
]);
function historyFacade(core: LegacyCore): LegacyCore {
  const facade: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const name of Object.getOwnPropertyNames(LegacyCore.prototype)) {
    if (name === "constructor") continue;
    const method: unknown = Object.getOwnPropertyDescriptor(
      LegacyCore.prototype,
      name,
    )?.value;
    if (typeof method !== "function") continue;
    Object.defineProperty(facade, name, {
      enumerable: true,
      value: reads.has(name)
        ? (...args: unknown[]): unknown =>
            Reflect.apply(method, core, args) as unknown
        : () => coreErr("storage_readonly"),
    });
  }
  return Object.freeze(facade) as unknown as LegacyCore;
}
/** Public legacy access is historical reading only. Synthetic legacy fixture
 * construction uses the private frozen implementation explicitly in tests. */
export type SestinaCore = LegacyCore;
export const SestinaCore = function (
  ...args: ConstructorParameters<typeof LegacyCore>
) {
  if (!args[0].readOnly) throw new Error("storage_readonly");
  return historyFacade(new LegacyCore(...args));
} as unknown as new (
  ...args: ConstructorParameters<typeof LegacyCore>
) => LegacyCore;
export async function openSestina(
  options: OpenSestinaOptions,
): Promise<CoreResult<LegacyCore>> {
  if (options.readOnly === false) return coreErr("storage_readonly");
  const opened = await openLegacyCore({ ...options, readOnly: true });
  return opened.ok ? coreOk(historyFacade(opened.value)) : opened;
}
