import { it, expect } from "vitest";
import { KernelApplicationApi } from "../../../packages/application/src/kernel-api.js";
import { TrustedKernelCommands } from "../../../packages/application/src/trusted-commands.js";
import { applicationFixture } from "../application-fixtures.js";

it("a consumed native confirmation does not block progress reads or cancellation during Provider I/O", async () => {
  const f = await applicationFixture();
  f.kernel.close();
  let started!: () => void;
  const sending = new Promise<void>((resolve) => {
    started = resolve;
  });
  const api = new KernelApplicationApi({
    provider: async () => ({
      identity: {
        id: "synthetic",
        family: "openai_compatible",
        model: "synthetic",
        origin: "http://127.0.0.1",
        locality: "local",
        configGeneration: 1,
        serializerVersion: "1.0.0",
      },
      maxOutputTokens: 1024,
      timeoutMs: 5000,
      send: async (_body: string, signal: AbortSignal) => {
        started();
        return new Promise<string>((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          ),
        );
      },
    }),
  });
  const desktop = new TrustedKernelCommands(api, async () => true);
  let attempt: Promise<unknown> | undefined;
  try {
    const s = await api.open({ projectPath: f.root });
    const call = (action: string, body: object = {}) =>
      desktop.execute({
        projectId: s.projectId,
        sessionGeneration: s.sessionGeneration,
        action,
        ...body,
      });
    const draft = (await call("create", {
      suggestion: "Cancel the actual pending request",
    })) as any;
    const prepared = (await call("prepare_manifest", {
      reviewId: draft.id,
      expectedVersion: draft.version,
      selection: {},
      useProvider: true,
    })) as any;
    const confirmed = (await call("confirm_manifest", {
      reviewId: draft.id,
      expectedVersion: prepared.review.version,
      manifestIdentityHash: prepared.manifest.identityHash,
      confirmed: true,
    })) as any;
    const ready = (await call("prepare_attempt", {
      reviewId: draft.id,
      expectedVersion: confirmed.version,
    })) as any;
    attempt = call("start_attempt", {
      reviewId: draft.id,
      expectedVersion: ready.version,
      manifestIdentityHash: prepared.manifest.identityHash,
    });
    await sending;
    const running = (await call("read", { reviewId: draft.id })) as any;
    expect(running.review.status).toBe("provider_attempt_running");
    await call("cancel_attempt", {
      reviewId: draft.id,
      expectedVersion: running.review.version,
    });
    await attempt;
    const result = (await call("read", { reviewId: draft.id })) as any;
    expect(result.attempts[0].status).toBe("uncertain");
    expect(result.review.terminalOutcome).toBeNull();
  } finally {
    api.dispose();
    await attempt?.catch(() => undefined);
    await f.cleanup();
  }
});

it("trusted copy confirmation distinguishes retention from deletion using the actual request", async () => {
  const f = await applicationFixture();
  f.kernel.close();
  const api = new KernelApplicationApi({});
  let snapshot: any;
  const desktop = new TrustedKernelCommands(api, async (detail) => {
    snapshot = detail.snapshot;
    return false;
  });
  try {
    const session = await api.open({ projectPath: f.root });
    await expect(
      desktop.execute({
        ...session,
        action: "privacy_cleanup",
        copyAction: "retire",
        confirmed: true,
      }),
    ).rejects.toThrow("confirmation_declined");
    expect(snapshot.copyAction).toBe("retire");
    expect(snapshot.plan.projectId).toBe(session.projectId);
    expect(snapshot.plan.planHash).toMatch(/^[a-f0-9]{64}$/);
  } finally {
    api.dispose();
    await f.cleanup();
  }
});

it("a forged renderer confirmation cannot commit without trusted user confirmation", async () => {
  const f = await applicationFixture();
  f.kernel.close();
  const api = new KernelApplicationApi({});
  const desktop = new TrustedKernelCommands(api, async () => false);
  try {
    const s = await api.open({ projectPath: f.root });
    const call = (action: string, body: object = {}) =>
      desktop.execute({
        projectId: s.projectId,
        sessionGeneration: s.sessionGeneration,
        action,
        ...body,
      });
    const review = (await call("create", {
      suggestion: "Synthetic renderer proposal",
    })) as any;
    const skipped = (await call("skip_assessment", {
      reviewId: review.id,
      expectedVersion: review.version,
    })) as any;
    const preview = (await call("prepare_effect", {
      reviewId: review.id,
      expectedVersion: skipped.version,
      payload: {
        kind: "record_only",
        outcome: "reference_only",
        reason: "Synthetic",
      },
    })) as any;
    await expect(
      call("commit", {
        reviewId: review.id,
        expectedVersion: preview.version,
        previewHash: preview.effectDraft.previewHash,
        authorityCommandId: preview.effectDraft.authorityCommandId,
        confirmed: true,
      }),
    ).rejects.toThrow("confirmation_declined");
  } finally {
    api.dispose();
    await f.cleanup();
  }
});

it.each(["expired", "revoked"])(
  "trusted confirmation is discarded when %s before consumption",
  async (mode) => {
    const f = await applicationFixture();
    f.kernel.close();
    const api = new KernelApplicationApi({});
    let now = 0;
    const desktop = new TrustedKernelCommands(
      api,
      async () => {
        if (mode === "expired") now += 60001;
        else desktop.revoke();
        return true;
      },
      () => now,
    );
    try {
      const s = await api.open({ projectPath: f.root });
      const call = (action: string, body: object = {}) =>
        desktop.execute({
          projectId: s.projectId,
          sessionGeneration: s.sessionGeneration,
          action,
          ...body,
        });
      const draft = (await call("create", {
        suggestion: "Synthetic confirmation lifetime",
      })) as any;
      const skipped = (await call("skip_assessment", {
        reviewId: draft.id,
        expectedVersion: draft.version,
      })) as any;
      const prepared = (await call("prepare_effect", {
        reviewId: draft.id,
        expectedVersion: skipped.version,
        payload: {
          kind: "record_only",
          outcome: "deferred",
          reason: "Synthetic",
        },
      })) as any;
      await expect(
        call("commit", {
          reviewId: draft.id,
          expectedVersion: prepared.version,
          previewHash: prepared.effectDraft.previewHash,
          authorityCommandId: prepared.effectDraft.authorityCommandId,
          confirmed: true,
        }),
      ).rejects.toThrow("confirmation_expired");
      const result = (await call("read", { reviewId: draft.id })) as any;
      expect(result.review.terminalOutcome).toBeNull();
      expect(result.review.version).toBe(prepared.version);
    } finally {
      api.dispose();
      await f.cleanup();
    }
  },
);
