import { describe, expect, it } from "vitest";
import {
  FixedClock,
  SequenceIdFactory,
  addArtifactRevision,
  chooseArtifactBranch,
  createArtifactRevision,
  createResearchArtifact,
  createResearchProject,
  getArtifactRevision,
  rebuildArtifactRevisionChain,
  tombstoneResearchArtifact,
  updateResearchProject,
  type ResearchSource,
} from "../src/index.js";

const USER_SOURCE: ResearchSource = {
  actor: { kind: "user", actorId: "researcher" },
  authority: "user_recorded",
  recordedAt: "2026-08-19T00:00:00.000Z",
};

function setup() {
  return {
    clock: new FixedClock("2026-08-19T01:00:00.000Z"),
    ids: new SequenceIdFactory(),
  };
}

describe("research projects", () => {
  it("creates validated immutable project state and updates with expected-version semantics", () => {
    const { clock, ids } = setup();
    const created = createResearchProject(
      { title: "Field study", rootPath: ".", source: USER_SOURCE },
      { clock, idFactory: ids },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const old = created.value;
    const updated = updateResearchProject(
      old,
      { title: "Field study revised", expectedVersion: old.version },
      { clock },
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.version).toBe(2);
    expect(old.title).toBe("Field study");
    expect(updateResearchProject(updated.value, { title: "stale", expectedVersion: old.version }, { clock })).toMatchObject({
      ok: false,
      error: { code: "version_conflict" },
    });
  });

  it("rejects unsafe project-relative paths without echoing path contents", () => {
    const { clock, ids } = setup();
    const sentinel = "PRIVATE_PATH_SENTINEL";
    const result = createResearchProject(
      { title: "Project", rootPath: `../${sentinel}`, source: USER_SOURCE },
      { clock, idFactory: ids },
    );
    expect(result).toMatchObject({ ok: false, error: { code: "unsafe_relative_path" } });
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });
});

describe("artifact revisions", () => {
  it("keeps revisions immutable while equal content keeps an equal hash and distinct ids", () => {
    const { clock, ids } = setup();
    const project = createResearchProject(
      { title: "Project", rootPath: ".", source: USER_SOURCE },
      { clock, idFactory: ids },
    );
    expect(project.ok).toBe(true);
    if (!project.ok) return;
    const artifact = createResearchArtifact(
      { projectId: project.value.id, kind: "manuscript", title: "Paper", source: USER_SOURCE },
      { clock, idFactory: ids },
    );
    expect(artifact.ok).toBe(true);
    if (!artifact.ok) return;
    const first = createArtifactRevision(
      {
        projectId: project.value.id,
        artifactId: artifact.value.id,
        content: "same text",
        mediaType: "text/markdown",
        source: USER_SOURCE,
      },
      { clock, idFactory: ids },
    );
    const duplicate = createArtifactRevision(
      {
        projectId: project.value.id,
        artifactId: artifact.value.id,
        content: "same text",
        mediaType: "text/markdown",
        source: USER_SOURCE,
      },
      { clock, idFactory: ids },
    );
    expect(first.ok && duplicate.ok).toBe(true);
    if (!first.ok || !duplicate.ok) return;
    expect(first.value.id).not.toBe(duplicate.value.id);
    expect(first.value.content.contentHash).toBe(duplicate.value.content.contentHash);
    expect(first.value.content.byteLength).toBe(9);
    expect(Object.isFrozen(first.value)).toBe(true);
    expect(Object.isFrozen(first.value.content)).toBe(true);
  });

  it("accepts empty text with an explicit byte length and stable hash", () => {
    const { clock, ids } = setup();
    const result = createArtifactRevision(
      {
        projectId: ids.create("rprj_"),
        artifactId: ids.create("rart_"),
        content: "",
        mediaType: "text/plain",
        source: USER_SOURCE,
      },
      { clock, idFactory: ids },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.content.byteLength).toBe(0);
      expect(result.value.content.contentHash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    }
  });

  it("rejects path escape and invalid external content metadata", () => {
    const { clock, ids } = setup();
    const base = {
      projectId: ids.create("rprj_"),
      artifactId: ids.create("rart_"),
      source: USER_SOURCE,
    };
    const result = createArtifactRevision(
      {
        ...base,
        contentReference: {
          storage: "project_file",
          mediaType: "text/plain",
          relativePath: "../private.txt",
          contentHash: "a".repeat(64),
          byteLength: 1,
        },
      },
      { clock, idFactory: ids },
    );
    expect(result).toMatchObject({ ok: false, error: { code: "unsafe_relative_path" } });
  });

  it("requires the current active parent, records forks, and changes branch only explicitly", () => {
    const { clock, ids } = setup();
    const projectId = ids.create("rprj_");
    const artifact = createResearchArtifact(
      { projectId, kind: "section", title: "Introduction", source: USER_SOURCE },
      { clock, idFactory: ids },
    );
    expect(artifact.ok).toBe(true);
    if (!artifact.ok) return;
    const first = createArtifactRevision(
      { projectId, artifactId: artifact.value.id, content: "v1", mediaType: "text/plain", source: USER_SOURCE },
      { clock, idFactory: ids },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const withFirst = addArtifactRevision(artifact.value, first.value, artifact.value.version);
    expect(withFirst.ok).toBe(true);
    if (!withFirst.ok) return;
    const badParent = createArtifactRevision(
      { projectId, artifactId: artifact.value.id, parentRevisionId: ids.create("rrev_"), content: "bad", mediaType: "text/plain", source: USER_SOURCE },
      { clock, idFactory: ids },
    );
    expect(badParent.ok).toBe(true);
    if (!badParent.ok) return;
    expect(addArtifactRevision(withFirst.value, badParent.value, withFirst.value.version)).toMatchObject({
      ok: false,
      error: { code: "invalid_revision_parent" },
    });

    const activeFork = createArtifactRevision(
      { projectId, artifactId: artifact.value.id, parentRevisionId: first.value.id, content: "candidate", mediaType: "text/plain", source: USER_SOURCE },
      { clock, idFactory: ids },
    );
    expect(activeFork.ok).toBe(true);
    if (!activeFork.ok) return;
    const forkedFromActive = addArtifactRevision(withFirst.value, activeFork.value, withFirst.value.version, { allowFork: true });
    expect(forkedFromActive.ok).toBe(true);
    if (!forkedFromActive.ok) return;
    expect(forkedFromActive.value.activeRevisionId).toBe(first.value.id);
    expect(forkedFromActive.value.branchHeads).toEqual([first.value.id, activeFork.value.id]);

    const second = createArtifactRevision(
      { projectId, artifactId: artifact.value.id, parentRevisionId: first.value.id, content: "v2", mediaType: "text/plain", source: USER_SOURCE },
      { clock, idFactory: ids },
    );
    const fork = createArtifactRevision(
      { projectId, artifactId: artifact.value.id, parentRevisionId: first.value.id, content: "alternative", mediaType: "text/plain", source: USER_SOURCE },
      { clock, idFactory: ids },
    );
    expect(second.ok && fork.ok).toBe(true);
    if (!second.ok || !fork.ok) return;
    const withSecond = addArtifactRevision(withFirst.value, second.value, withFirst.value.version);
    expect(withSecond.ok).toBe(true);
    if (!withSecond.ok) return;
    const forked = addArtifactRevision(withSecond.value, fork.value, withSecond.value.version, { allowFork: true });
    expect(forked.ok).toBe(true);
    if (!forked.ok) return;
    expect(forked.value.activeRevisionId).toBe(second.value.id);
    expect(forked.value.branchHeads).toEqual([second.value.id, fork.value.id]);
    const selected = chooseArtifactBranch(forked.value, fork.value.id, forked.value.version);
    expect(selected.ok).toBe(true);
    if (selected.ok) expect(selected.value.activeRevisionId).toBe(fork.value.id);
  });

  it("rebuilds a selected linear chain, rejects broken/cyclic history, and preserves history after tombstone", () => {
    const { clock, ids } = setup();
    const projectId = ids.create("rprj_");
    const artifactId = ids.create("rart_");
    const first = createArtifactRevision(
      { projectId, artifactId, content: "one", mediaType: "text/plain", source: USER_SOURCE },
      { clock, idFactory: ids },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = createArtifactRevision(
      { projectId, artifactId, parentRevisionId: first.value.id, content: "two", mediaType: "text/plain", source: USER_SOURCE },
      { clock, idFactory: ids },
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const chain = rebuildArtifactRevisionChain([second.value, first.value], second.value.id);
    expect(chain.ok).toBe(true);
    if (chain.ok) expect(chain.value.map((item) => item.id)).toEqual([first.value.id, second.value.id]);

    const artifact = createResearchArtifact(
      { projectId, kind: "analysis", title: "Analysis", source: USER_SOURCE },
      { clock, idFactory: ids },
    );
    expect(artifact.ok).toBe(true);
    if (!artifact.ok) return;
    const added = addArtifactRevision(artifact.value, first.value, artifact.value.version);
    expect(added.ok).toBe(false);

    const correctRevision = { ...first.value, artifactId: artifact.value.id };
    const withRevision = addArtifactRevision(artifact.value, correctRevision, artifact.value.version);
    expect(withRevision.ok).toBe(true);
    if (!withRevision.ok) return;
    const deleted = tombstoneResearchArtifact(withRevision.value, withRevision.value.version, USER_SOURCE, clock);
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.value.tombstone).toBeDefined();
    expect(getArtifactRevision(deleted.value, first.value.id)?.id).toBe(first.value.id);
  });
});
