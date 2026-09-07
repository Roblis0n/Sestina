import {
  KernelFault,
  FixedClock,
  kernelRecord,
  kernelText,
  kernelInteger,
  parseProjectWorkingMemory,
  stableResearchHash,
  createProjectWorkingMemoryCandidate,
  confirmProjectWorkingMemory,
  editProjectWorkingMemory,
  renewProjectWorkingMemory,
  retireProjectWorkingMemory,
  forgetProjectWorkingMemory,
  markProjectWorkingMemorySourceStale,
  expireProjectWorkingMemory,
  type ProjectWorkingMemory,
  type ResearchActor,
  type IdFactory,
} from "@sestina/research";
import { type KernelSnapshot } from "@sestina/research-store";
import { unwrapKernelDomain } from "./kernel-effects.js";

function memorySourceObject(snapshot: KernelSnapshot, kind: string, id: string) {
  const object = snapshot.state.objects.find(o => o.kind === kind && o.id === id);
  if (object) return { ...object, sourceVersion: object.version };
  if (kind === "brief") {
    for (const brief of snapshot.state.objects.filter(o => o.kind === "brief")) {
      const versions = brief.data.versions as readonly Record<string, import("@sestina/research").KernelJson>[];
      const version = versions.find(v => v.id === id);
      if (version && typeof version.versionNumber === "number") return { ...brief, data: version, sourceVersion: version.versionNumber };
    }
  }
  return undefined;
}

export function projectMemorySource(snapshot: KernelSnapshot, input: unknown) {
  const ref = kernelRecord(input, ["kind", "id", "version"]);
  kernelText(ref.kind, 64); kernelText(ref.id, 160); kernelInteger(ref.version);
  const object = memorySourceObject(snapshot, ref.kind, ref.id);
  if (object?.sourceVersion !== ref.version) throw new KernelFault("stale_object");
  return { kind: "project_object" as const, objectKind: ref.kind, objectId: ref.id, objectVersion: ref.version, contentFingerprint: unwrapKernelDomain(stableResearchHash(object.data)) };
}

export function memoryValidity(
  item: ProjectWorkingMemory,
  snapshot: KernelSnapshot,
  at: string,
): string | null {
  if (item.state === "forgotten") return "forgotten";
  if (item.source.kind === "project_object") {
    const source = item.source;
    const object = memorySourceObject(snapshot, source.objectKind, source.objectId);
    if (!object) return "source_unavailable";
    if (object.sourceVersion !== source.objectVersion)
      return "source_version_changed";
    if (unwrapKernelDomain(stableResearchHash(object.data)) !== source.contentFingerprint)
      return "source_content_changed";
  }
  if (item.kind === "workset" && "refs" in item.content) {
    for (const ref of item.content.refs) {
      const object = memorySourceObject(snapshot, ref.kind, ref.id);
      if (object?.sourceVersion !== ref.version) return "workset_changed";
    }
  }
  if (item.retention.policy === "until_date" && item.retention.expiresAt <= at)
    return "expired";
  if (item.retention.policy === "current_episode") {
    const episodeId = item.retention.episodeId;
    const episode = snapshot.state.objects.find(
      (o) => o.kind === "episode" && o.id === episodeId,
    );
    if (
      !episode ||
      ["accepted", "rejected", "abandoned"].includes(
        typeof episode.data.status === "string" ? episode.data.status : "",
      )
    )
      return "episode_ended";
  }
  return null;
}
export function projectMemory(snapshot: KernelSnapshot, at: string) {
  return snapshot.state.objects
    .filter((o) => o.kind === "memory")
    .map((o) => {
      const item = unwrapKernelDomain(parseProjectWorkingMemory(o.data));
      const invalid = memoryValidity(item, snapshot, at);
      const userState =
        item.state === "forgotten"
          ? "forgotten"
          : invalid
            ? "not_in_use"
            : item.state === "candidate"
              ? "suggested"
              : item.state === "active"
                ? "in_use"
                : "not_in_use";
      return {
        item,
        userState,
        reason: invalid ?? item.state,
        recallEligible: userState === "in_use",
        sendEligible:
          userState === "in_use" &&
          item.state !== "forgotten" &&
          item.outboundPolicy === "explicit_manifest_only" &&
          item.sensitivity !== "secret_never_send",
        selectedByDefault: false,
      };
    });
}
export function buildMemoryChange(
  snapshot: KernelSnapshot,
  input: unknown,
  actor: ResearchActor,
  at: string,
  idFactory: IdFactory,
) {
  if (actor.kind !== "user") throw new KernelFault("authority_required");
  const v = kernelRecord(input, [
    "action",
    "itemId",
    "expectedVersion",
    "kind",
    "content",
    "source",
    "retention",
    "sensitivity",
    "outboundPolicy",
    "publicReason",
    "confirmation",
  ]);
  kernelText(v.publicReason, 4096);
  const allowed: Record<string, readonly string[]> = {
    create: ["kind", "content", "source", "retention", "sensitivity", "outboundPolicy"],
    edit: ["itemId", "expectedVersion", "content", "source", "retention", "sensitivity", "outboundPolicy"],
    confirm: ["itemId", "expectedVersion"], renew: ["itemId", "expectedVersion", "retention"],
    retire: ["itemId", "expectedVersion"], forget: ["itemId", "expectedVersion", "confirmation"], recheck: ["itemId", "expectedVersion"],
  };
  if (typeof v.action !== "string" || !allowed[v.action]) throw new KernelFault("invalid_record");
  const actionFields = allowed[v.action];
  if (!actionFields) throw new KernelFault("invalid_record");
  kernelRecord(v, ["action", "publicReason", ...actionFields]);
  if (v.source !== undefined) {
    const source = kernelRecord(v.source, ["kind", "actorId", "objectKind", "objectId", "objectVersion", "contentFingerprint"]);
    if (source.kind === "direct_user" && source.actorId !== actor.actorId) throw new KernelFault("authority_required");
  }
  const ports = { clock: new FixedClock(at), idFactory };
  const before =
    v.action === "create"
      ? null
      : unwrapKernelDomain(
          parseProjectWorkingMemory(
            snapshot.state.objects.find(
              (o) => o.kind === "memory" && o.id === v.itemId,
            )?.data,
          ),
        );
  if (before) {
    kernelInteger(v.expectedVersion);
    if (before.version !== v.expectedVersion)
      throw new KernelFault("stale_object");
  }
  let after: ProjectWorkingMemory;
  const common = {
    expectedVersion: before?.version ?? 1,
    actor,
    publicReason: v.publicReason,
  };
  if (v.action === "create") {
    const source =
      v.source === undefined
        ? {
            kind: "direct_user",
            actorId: actor.actorId,
          }
        : v.source;
    after = unwrapKernelDomain(
      createProjectWorkingMemoryCandidate(
        {
          projectId: snapshot.head.projectId,
          kind: v.kind,
          content: v.content,
          source,
          retention: v.retention,
          sensitivity: v.sensitivity,
          outboundPolicy: v.outboundPolicy,
          publicReason: v.publicReason,
          actor,
        } as Parameters<typeof createProjectWorkingMemoryCandidate>[0],
        ports,
      ),
    );
  } else {
    if (!before) throw new KernelFault("relation_mismatch");
    if (v.action === "confirm")
      after = unwrapKernelDomain(
        confirmProjectWorkingMemory(before, common, ports),
      );
    else if (v.action === "edit")
      after = unwrapKernelDomain(
        editProjectWorkingMemory(
          before,
          {
            ...common,
            content: v.content,
            retention: v.retention,
            sensitivity: v.sensitivity,
            outboundPolicy: v.outboundPolicy,
            ...(v.source === undefined ? {} : { source: v.source }),
          } as Parameters<typeof editProjectWorkingMemory>[1],
          ports,
        ),
      );
    else if (v.action === "renew")
      after = unwrapKernelDomain(
        renewProjectWorkingMemory(
          before,
          { ...common, retention: v.retention } as Parameters<
            typeof renewProjectWorkingMemory
          >[1],
          ports,
        ),
      );
    else if (v.action === "retire")
      after = unwrapKernelDomain(
        retireProjectWorkingMemory(before, common, ports),
      );
    else if (v.action === "forget")
      after = unwrapKernelDomain(
        forgetProjectWorkingMemory(
          before,
          { ...common, confirmation: String(v.confirmation) },
          ports,
        ),
      );
    else if (v.action === "recheck") {
      const invalid = memoryValidity(before, snapshot, at);
      if (invalid === "expired" || invalid === "episode_ended")
        after = unwrapKernelDomain(
          expireProjectWorkingMemory(
            before,
            {
              currentEpisodeActive: invalid !== "episode_ended",
              publicReason: v.publicReason,
            },
            ports,
          ),
        );
      else if (invalid?.startsWith("source_")) {
        const source =
          before.state !== "forgotten" &&
          before.source.kind === "project_object"
            ? before.source
            : null;
        const obj = source
          ? memorySourceObject(snapshot, source.objectKind, source.objectId)
          : undefined;
        after = unwrapKernelDomain(
          markProjectWorkingMemorySourceStale(
            before,
            {
              sourceAvailable: !!obj,
              objectVersion: obj?.sourceVersion,
              contentFingerprint: obj ? unwrapKernelDomain(stableResearchHash(obj.data)) : undefined,
              publicReason: v.publicReason,
            },
            ports,
          ),
        );
      } else throw new KernelFault("illegal_transition");
    } else throw new KernelFault("invalid_record");
  }
  if (
    ["create", "confirm", "edit", "renew"].includes(v.action) &&
    memoryValidity(after, snapshot, at)
  )
    throw new KernelFault("stale_object");
  if (
    after.state === "active" &&
    before?.state !== "active" &&
    snapshot.state.objects.filter(
      (o) => o.kind === "memory" && o.data.state === "active",
    ).length >= 200
  )
    throw new KernelFault("invalid_record");
  const objectVersions = [
    { kind: "memory", id: after.id, version: before?.version ?? 0 },
  ];
  if (after.state !== "forgotten") {
    const references = [
      ...(after.source.kind === "project_object" ? [{ kind: after.source.objectKind, id: after.source.objectId }] : []),
      ...(after.kind === "workset" && "refs" in after.content ? after.content.refs : []),
    ];
    for (const ref of references) {
      const object = memorySourceObject(snapshot, ref.kind, ref.id);
      if (object && !objectVersions.some(saved => saved.kind === object.kind && saved.id === object.id)) objectVersions.push({ kind: object.kind, id: object.id, version: object.version });
    }
  }
  return { before, after, objectVersions, publicReason: v.publicReason };
}
export function assertMemorySelection(
  snapshot: KernelSnapshot,
  selected: readonly { id: string; version: number; contentHash: string }[],
  at: string,
  locality: "local" | "external" | undefined,
) {
  for (const ref of selected) {
    const item = unwrapKernelDomain(
      parseProjectWorkingMemory(
        snapshot.state.objects.find(
          (o) => o.kind === "memory" && o.id === ref.id,
        )?.data,
      ),
    );
    if (
      item.state !== "active" ||
      memoryValidity(item, snapshot, at) ||
      item.version !== ref.version ||
      item.contentHash !== ref.contentHash ||
      item.outboundPolicy !== "explicit_manifest_only" ||
      item.sensitivity === "secret_never_send" ||
      (locality === "external" && item.sensitivity !== "public")
    )
      throw new KernelFault("stale_object");
  }
}
