import { projectKernelWorkspace } from "@sestina/core";
import { it, expect } from "vitest";
import { performance } from "node:perf_hooks";
import { writeFile, mkdir } from "node:fs/promises";
import { cpus } from "node:os";
import {
  readKernelWorkspaceSnapshot,
  rebuildKernelProjection,
} from "@sestina/research-store";
import { workspaceVolumeFixture } from "../workspace-volume-fixture.js";
import { session } from "../application-fixtures.js";

it("G8: seeded large project reads and serialization meet bounded page thresholds", async () => {
  const f = await workspaceVolumeFixture();
  try {
    const snapshot = readKernelWorkspaceSnapshot(
      f.kernel.database,
      f.projectId,
    );
    expect(
      snapshot.state.objects.filter(
        (o) => !["memory", "claim_evidence_link"].includes(o.kind),
      ).length,
    ).toBeGreaterThanOrEqual(1000);
    expect(snapshot.workflows.reviews).toHaveLength(1100);
    expect(snapshot.legacy).toHaveLength(1000);
    expect(
      snapshot.state.objects.filter((o) => o.kind === "claim_evidence_link"),
    ).toHaveLength(500);
    expect(
      snapshot.state.objects.filter((o) => o.kind === "memory"),
    ).toHaveLength(50);
    expect(
      f.kernel.workspace({ view: "attention" }, session).total,
    ).toBeGreaterThanOrEqual(300);
    const samples: Record<string, number[]> = {
      snapshot: [],
      today: [],
      project: [],
      search: [],
      serialization: [],
      projection: [],
      nextPage: [],
      rebuild: [],
    };
    for (let i = 0; i < 25; i++) {
      let start = performance.now();
      readKernelWorkspaceSnapshot(f.kernel.database, f.projectId);
      samples.snapshot!.push(performance.now() - start);
      for (const view of ["today", "project", "search"]) {
        start = performance.now();
        const result = f.kernel.workspace({ view, limit: 50 }, session);
        samples[view]!.push(performance.now() - start);
        start = performance.now();
        JSON.stringify(result);
        samples.serialization!.push(performance.now() - start);
        expect(result.items.length).toBeLessThanOrEqual(50);
      }
      start = performance.now();
      projectKernelWorkspace(snapshot, { view: "today", limit: 50 });
      samples.projection!.push(performance.now() - start);
      const first = f.kernel.workspace({ view: "search", limit: 50 }, session);
      start = performance.now();
      f.kernel.workspace(
        { view: "search", limit: 50, cursor: first.nextCursor },
        session,
      );
      samples.nextPage!.push(performance.now() - start);
      start = performance.now();
      expect(
        rebuildKernelProjection(
          f.kernel.database,
          f.projectId,
          "today",
          (state) =>
            projectKernelWorkspace(state, { view: "today", limit: 50 }),
        ).ok,
      ).toBe(true);
      samples.rebuild!.push(performance.now() - start);
    }
    const p95 = Object.fromEntries(
      Object.entries(samples).map(([key, values]) => [
        key,
        [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!,
      ]),
    );
    await mkdir(".tmp/g8-g9", { recursive: true });
    await writeFile(
      ".tmp/g8-g9/performance.json",
      JSON.stringify(
        {
          seed: f.seed,
          inputHash: snapshot.inputHash,
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          cpu: cpus()[0]?.model,
          samples,
          p95,
        },
        null,
        2,
      ),
    );
    expect(p95.today).toBeLessThanOrEqual(750);
    expect(p95.project).toBeLessThanOrEqual(750);
    expect(p95.search).toBeLessThanOrEqual(500);
    expect(p95.nextPage).toBeLessThanOrEqual(400);
  } finally {
    await f.cleanup();
  }
}, 240000);
