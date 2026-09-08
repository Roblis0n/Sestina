import { describe, it, expect, afterEach, vi } from "vitest";
import { KernelApplicationApi } from "../../../apps/research-room/src/kernel-api.js";
import * as core from "@sestina/core";
import { KernelFault, KernelApplicationFault } from "@sestina/core";
import { applicationFixture } from "../application-fixtures.js";

describe("F03: KernelApplicationApi lifecycle and open/close race", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    while (cleanups.length > 0) {
      const fn = cleanups.pop()!;
      await fn().catch(() => {});
    }
  });

  it("AC-F03-01: late open handle is closed, active does not resurrect, pending rejects cleanly", async () => {
    let lateHandleClosed = 0;
    let resolveOpenKernel!: (kernel: any) => void;
    const pendingOpen = new Promise<any>((resolve) => {
      resolveOpenKernel = resolve;
    });

    vi.spyOn(core, "openResearchDeliberationKernel").mockImplementation(
      () => pendingOpen,
    );

    const api = new KernelApplicationApi({});

    // 1. Initiate open - returns pending Promise
    const openPromise = api.open({ projectPath: "synthetic-project" });

    // 2. Synchronously close while open is in flight
    api.close();
    expect(api.active).toBe(false);

    // 3. Late kernel arrives after close
    resolveOpenKernel({
      projectId: "synthetic-project",
      close() {
        lateHandleClosed++;
      },
    });

    // 4. Pending promise rejects with storage_unavailable
    await expect(openPromise).rejects.toThrow("storage_unavailable");

    // 5. Active remains false and late handle was closed exactly once
    expect(api.active).toBe(false);
    expect(lateHandleClosed).toBe(1);
  });

  it("AC-F03-02: commands rejected during closed state, previously committed transactions preserved", async () => {
    const f = await applicationFixture();
    cleanups.push(f.cleanup);
    f.kernel.close();

    const api = new KernelApplicationApi({});
    // Before open: execute must throw KernelApplicationFault
    try {
      await api.execute({
        projectId: f.projectId,
        action: "read",
        reviewId: "rw_none",
      });
      expect.unreachable();
    } catch (err: any) {
      expect(err).toBeInstanceOf(KernelApplicationFault);
      expect(err.reasons).toContain("kernel_project_not_open");
    }

    // Open project
    const opened = await api.open({ projectPath: f.root });
    expect(opened.projectId).toBe(f.projectId);
    expect(api.active).toBe(true);

    // Create a review
    const created = (await api.execute({
      projectId: f.projectId,
      action: "create",
      suggestion: "Valid research suggestion before close",
    })) as { id: string; version: number };
    expect(created.id).toBeDefined();

    // Close the API
    api.close();
    expect(api.active).toBe(false);

    // Execute must fail immediately after close without leaking authority
    try {
      await api.execute({
        projectId: f.projectId,
        action: "read",
        reviewId: created.id,
      });
      expect.unreachable();
    } catch (err: any) {
      expect(err).toBeInstanceOf(KernelApplicationFault);
      expect(err.reasons).toContain("kernel_project_not_open");
    }

    // Reopen and verify the previous transaction is intact
    await api.open({ projectPath: f.root });
    expect(api.active).toBe(true);

    const readBack = (await api.execute({
      projectId: f.projectId,
      action: "read",
      reviewId: created.id,
    })) as { review: { id: string; suggestion: string } };
    expect(readBack.review.id).toBe(created.id);
    expect(readBack.review.suggestion).toBe(
      "Valid research suggestion before close",
    );

    api.close();
  });

  it("AC-F03-03: project lease can be safely re-acquired after close; project switching works", async () => {
    const f1 = await applicationFixture();
    cleanups.push(f1.cleanup);
    f1.kernel.close();

    const f2 = await applicationFixture();
    cleanups.push(f2.cleanup);
    f2.kernel.close();

    const api = new KernelApplicationApi({});

    // 1. Open f1
    const res1 = await api.open({ projectPath: f1.root });
    expect(res1.projectId).toBe(f1.projectId);
    expect(api.status().projectId).toBe(f1.projectId);

    // 2. Close f1
    api.close();
    expect(api.active).toBe(false);
    expect(api.status().projectId).toBeNull();

    // 3. Re-acquire lease on f1
    const res1Reopen = await api.open({ projectPath: f1.root });
    expect(res1Reopen.projectId).toBe(f1.projectId);
    expect(api.active).toBe(true);

    // 4. Switch project directly to f2 (implicit close of f1)
    const res2 = await api.open({ projectPath: f2.root });
    expect(res2.projectId).toBe(f2.projectId);
    expect(api.status().projectId).toBe(f2.projectId);

    // 5. Switch back to f1 to confirm f1 lease was released
    const res1Again = await api.open({ projectPath: f1.root });
    expect(res1Again.projectId).toBe(f1.projectId);

    // 6. Test dispose: cannot open again after dispose
    api.dispose();
    expect(api.active).toBe(false);
    expect(api.disposed).toBe(true);

    await expect(api.open({ projectPath: f1.root })).rejects.toThrow(
      "storage_unavailable",
    );
  });

  it("handles concurrent open rejection", async () => {
    const f = await applicationFixture();
    cleanups.push(f.cleanup);
    f.kernel.close();

    const api = new KernelApplicationApi({});

    // Launch two open requests simultaneously
    const p1 = api.open({ projectPath: f.root });
    const p2 = api.open({ projectPath: f.root });

    // One of them should be rejected with storage_unavailable
    const results = await Promise.allSettled([p1, p2]);
    const rejected = results.filter((r) => r.status === "rejected");
    const fulfilled = results.filter((r) => r.status === "fulfilled");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    if (rejected[0].status === "rejected") {
      expect((rejected[0].reason as KernelFault).code).toBe(
        "storage_unavailable",
      );
    }

    api.close();
  });
  it("F03: closing revokes the actual session resolver and releases a late real database lease", async () => {
    const f = await applicationFixture();
    cleanups.push(f.cleanup);
    f.kernel.close();
    const realOpen = core.openResearchDeliberationKernel;
    let capturedOptions: core.KernelApplicationOptions | undefined;
    let realKernel: core.ResearchDeliberationKernel | undefined;
    vi.spyOn(core, "openResearchDeliberationKernel").mockImplementation(
      async (path, options) => {
        capturedOptions = options;
        realKernel = await realOpen(path, options);
        return realKernel;
      },
    );
    const api = new KernelApplicationApi({});
    await api.open({ projectPath: f.root });
    let capability: unknown;
    const original = realKernel!.createReview.bind(realKernel);
    vi.spyOn(realKernel!, "createReview").mockImplementation(
      (suggestion, cap, ...rest) => {
        capability = cap;
        return original(suggestion, cap, ...rest);
      },
    );
    await api.execute({
      projectId: f.projectId,
      action: "create",
      suggestion: "Synthetic resolver revocation",
    });
    expect(capturedOptions!.resolveUser(capability)?.kind).toBe("user");
    api.close();
    expect(capturedOptions!.resolveUser(capability)).toBeUndefined();
    const reopened = await realOpen(f.root, { resolveUser: () => undefined });
    reopened.close();
  });
});
