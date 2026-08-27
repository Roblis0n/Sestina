import { join } from "node:path";
import { openSestina, type CoreResult } from "../../packages/core/src/index.js";
import type { LiveProjectWorkingMemory, ProjectWorkingMemoryContent } from "../../packages/research/src/index.js";
import { createUi02Project, UI02_USER, type Ui02ProjectFixture } from "./ui02-project.js";

function valueOf<T>(result: CoreResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

export interface Ri51ProjectFixture extends Ui02ProjectFixture {
  readonly eligibleMemoryId: string;
  readonly eligibleSearchToken: string;
  readonly candidateMemoryId: string;
  readonly staleMemoryId: string;
  readonly expiredMemoryId: string;
  readonly retiredMemoryId: string;
  readonly forgottenMemoryId: string;
  readonly forgottenSecret: string;
}

export async function createRi51Project(): Promise<Ri51ProjectFixture> {
  const base = await createUi02Project({
    title: "RI-51 Governed Continuity Workspace",
    question: "How can project-level recovery stay useful without turning working memory into research Authority?",
    uniqueToken: "ri51-unstructured-file-must-not-be-memory",
  });
  const core = valueOf(await openSestina({ databasePath: join(base.root, ".sestina", "state.sqlite") }));
  try {
    const create = (input: {
      readonly kind?: "term" | "working_hint" | "resume_note" | "workset";
      readonly content: ProjectWorkingMemoryContent;
      readonly outboundPolicy?: "never_send" | "explicit_manifest_only";
      readonly sensitivity?: "project_private" | "public" | "sensitive" | "secret_never_send";
      readonly retention?: { readonly policy: "until_unpinned" } | { readonly policy: "until_date"; readonly expiresAt: string } | { readonly policy: "current_episode"; readonly episodeId: string };
      readonly reason: string;
    }): LiveProjectWorkingMemory => valueOf(core.createProjectMemoryCandidate({
      projectId: base.projectId,
      kind: input.kind ?? "working_hint",
      content: input.content,
      retention: input.retention ?? { policy: "until_unpinned" },
      sensitivity: input.sensitivity ?? "project_private",
      outboundPolicy: input.outboundPolicy ?? "never_send",
      publicReason: input.reason,
      actor: UI02_USER,
    }));
    const confirm = (item: LiveProjectWorkingMemory, reason: string): LiveProjectWorkingMemory => valueOf(core.confirmProjectMemory({
      projectId: base.projectId,
      itemId: item.id,
      expectedVersion: item.version,
      publicReason: reason,
      actor: UI02_USER,
    }));

    // Enough real records to force bounded paging without manufacturing a screenshot-only state.
    for (let index = 1; index <= 43; index += 1) {
      const candidate = create({
        kind: index % 7 === 0 ? "resume_note" : "working_hint",
        content: { text: `Bounded continuity note ${String(index).padStart(2, "0")}: preserve source, state, and user Authority while resuming.` },
        reason: `Seed governed continuity record ${index} through the real Core path.`,
      });
      confirm(candidate, `User reviewed governed continuity record ${index}.`);
    }

    const eligibleSearchToken = "ri51-explicit-manifest-canary";
    const eligible = confirm(create({
      kind: "term",
      content: {
        term: "Governed recovery boundary",
        definition: `${eligibleSearchToken}: working memory is project-local, non-authoritative, and request-scoped before any Provider handoff. ` + "Long bilingual pressure content 保持来源、保留期、Authority 与外发边界可见。".repeat(14),
      },
      outboundPolicy: "explicit_manifest_only",
      sensitivity: "project_private",
      reason: "Create one explicit Manifest-eligible definition for production verification.",
    }), "User reviewed the exact Manifest-eligible definition.");

    confirm(create({
      kind: "workset",
      content: { purpose: "Current governed recovery workset", refs: [{ kind: "decision", id: base.acceptedDecisionId, version: 1 }, { kind: "issue", id: base.resolveIssueId, version: 1 }] },
      reason: "Keep references without copying canonical object content.",
    }), "User reviewed the object references in this workset.");

    confirm(create({
      kind: "resume_note",
      content: { text: "Secret local continuity note that must never enter an outbound Manifest." },
      sensitivity: "secret_never_send",
      outboundPolicy: "never_send",
      reason: "Keep a controlled note local to this project.",
    }), "User confirmed this note remains local-only.");

    const candidate = create({
      content: { text: "Candidate awaiting the user's second confirmation." },
      outboundPolicy: "explicit_manifest_only",
      reason: "Demonstrate the candidate gate without enabling recall.",
    });

    const expired = confirm(create({
      kind: "resume_note",
      content: { text: "Expired recovery note retained only for an explicit lifecycle decision." },
      retention: { policy: "until_date", expiresAt: "2020-01-02T00:00:00.000Z" },
      reason: "Exercise deterministic retention expiry through the real lifecycle.",
    }), "User confirmed the bounded note before its retention date passed.");

    const retiredActive = confirm(create({
      content: { text: "Retired memory remains auditable but is not recalled or sent." },
      reason: "Exercise the explicit retirement path.",
    }), "User reviewed the note before retirement.");
    const retired = valueOf(core.retireProjectMemory({ projectId: base.projectId, itemId: retiredActive.id, expectedVersion: retiredActive.version, publicReason: "User explicitly retired this working note.", actor: UI02_USER }));

    const forgottenSecret = "ri51-forgotten-content-must-not-survive";
    const forgetCandidate = create({
      content: { text: forgottenSecret },
      sensitivity: "secret_never_send",
      reason: "Exercise irreversible deletion without creating a second truth.",
    });
    const forgotten = valueOf(core.forgetProjectMemory({ projectId: base.projectId, itemId: forgetCandidate.id, expectedVersion: forgetCandidate.version, confirmation: "FORGET", publicReason: "user_requested_irreversible_forget", actor: UI02_USER }));

    const pinned = valueOf(core.createPinnedProjectMemoryCandidate({
      projectId: base.projectId,
      objectKind: "decision",
      objectId: base.acceptedDecisionId,
      kind: "working_hint",
      content: { text: "Pinned Decision source must become stale when the canonical version changes." },
      retention: { policy: "until_unpinned" },
      sensitivity: "project_private",
      outboundPolicy: "explicit_manifest_only",
      publicReason: "Pin the canonical Decision by exact source version and fingerprint.",
      actor: UI02_USER,
    }));
    const pinnedActive = confirm(pinned, "User reviewed the pinned source before enabling recall.");
    const decision = valueOf(core.getDecision(base.projectId, base.acceptedDecisionId));
    if (decision === undefined) throw new Error("RI-51 Decision fixture is missing.");
    valueOf(core.transitionDecision({ projectId: base.projectId, decisionId: decision.id, target: "frozen", reason: "Create deterministic source-version drift for RI-51 recovery verification.", expectedVersion: decision.version, actor: UI02_USER }));

    return {
      ...base,
      eligibleMemoryId: eligible.id,
      eligibleSearchToken,
      candidateMemoryId: candidate.id,
      staleMemoryId: pinnedActive.id,
      expiredMemoryId: expired.id,
      retiredMemoryId: retired.id,
      forgottenMemoryId: forgotten.id,
      forgottenSecret,
    };
  } catch (error) {
    await base.cleanup();
    throw error;
  } finally {
    core.close();
  }
}
