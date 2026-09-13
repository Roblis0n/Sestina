import {
  openDatabase,
  readSchemaVersion,
  type StorageDatabase,
} from "@sestina/storage";
import { createResearchStore } from "@sestina/research-store";
import {
  getActiveResearchBriefVersion,
  exportResearchBriefYaml,
} from "@sestina/research";
import {
  coreErr,
  coreOk,
  fromDomain,
  mapDomainError,
  type CoreResult,
} from "./errors.js";
import type { CoreBriefState } from "./sestina-core.js";

/** Legacy decoding for migration, recovery and read-only integrations. No old
 * service, Provider, pending-review map or research writer is constructed. */
export class LegacyResearchReader {
  get schemaVersion(): number {
    return readSchemaVersion(this.database);
  }
  readonly #store;
  constructor(private readonly database: StorageDatabase) {
    if (!database.readOnly) throw new Error("storage_readonly");
    this.#store = createResearchStore(database);
  }
  close() {
    this.database.close();
  }
  listProjects() {
    const result = fromDomain(this.#store.projects.list({ limit: 200 }));
    return result.ok
      ? result.value.nextCursor
        ? coreErr("state_conflict")
        : coreOk(result.value.items)
      : result;
  }
  getBriefState(projectId: string): CoreResult<CoreBriefState | undefined> {
    const result = fromDomain(
      this.#store.briefs.listByProject(projectId, { limit: 200 }),
    );
    if (!result.ok) return result;
    if (result.value.nextCursor) return coreErr("state_conflict");
    const active = result.value.items
      .flatMap((brief) => {
        const version = getActiveResearchBriefVersion(brief);
        return version ? [{ brief, version }] : [];
      })
      .sort(
        (left, right) =>
          right.version.createdAt.localeCompare(left.version.createdAt) ||
          right.version.id.localeCompare(left.version.id),
      )[0];
    if (!active) return coreOk(undefined);
    const yaml = fromDomain(exportResearchBriefYaml(active.version));
    return yaml.ok
      ? coreOk(Object.freeze({ ...active, yaml: yaml.value }))
      : yaml;
  }
  getActiveBriefProjection(projectId: string) {
    const result = this.getBriefState(projectId);
    return result.ok
      ? coreOk(
          result.value
            ? Object.freeze({
                briefId: result.value.brief.id,
                versionId: result.value.version.id,
                yaml: result.value.yaml,
              })
            : undefined,
        )
      : result;
  }
  listEpisodes(projectId: string) {
    const result = fromDomain(
      this.#store.episodes.listByProject(projectId, { limit: 200 }),
    );
    return result.ok
      ? result.value.nextCursor
        ? coreErr("state_conflict")
        : coreOk(result.value.items)
      : result;
  }
  listDecisions(projectId: string) {
    const result = fromDomain(
      this.#store.decisions.listByScope(projectId, undefined, { limit: 200 }),
    );
    return result.ok
      ? result.value.nextCursor
        ? coreErr("state_conflict")
        : coreOk(result.value.items)
      : result;
  }
  listIssues(projectId: string) {
    const result = fromDomain(
      this.#store.issues.listByStatus(projectId, undefined, { limit: 200 }),
    );
    return result.ok
      ? result.value.nextCursor
        ? coreErr("state_conflict")
        : coreOk(result.value.items)
      : result;
  }
}
export async function openLegacyResearchReader(options: {
  databasePath: string;
  readOnly?: boolean;
  immutable?: boolean;
}): Promise<CoreResult<LegacyResearchReader>> {
  if (options.readOnly === false) return coreErr("storage_readonly");
  try {
    return coreOk(
      new LegacyResearchReader(
        await openDatabase({
          path: options.databasePath,
          readOnly: true,
          immutable: options.immutable,
        }),
      ),
    );
  } catch (error) {
    return {
      ok: false,
      error: mapDomainError(
        typeof error === "object" && error !== null ? error : {},
      ),
    };
  }
}
