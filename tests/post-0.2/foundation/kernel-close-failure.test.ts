import { expect, it, vi } from "vitest";
import {
  applicationFixture,
  ApplicationProvider,
  session,
} from "../application-fixtures.js";
it("G8: a failed uncertainty write during close still releases the database and aborts the request", async () => {
  let entered!: () => void;
  const sent = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let aborted = false;
  const provider = new ApplicationProvider();
  provider.send = (_body, signal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          reject(new Error("Synthetic interrupted request"));
        },
        { once: true },
      );
      entered();
    });
  const f = await applicationFixture(provider, { timeoutMs: 10000 });
  try {
    const draft = f.kernel.createReview("Synthetic lifecycle failure", session),
      prepared = await f.kernel.prepareManifest(
        draft.id,
        draft.version,
        {},
        true,
        session,
      );
    let r = await f.kernel.confirmManifest(
      draft.id,
      prepared.review.version,
      prepared.manifest.identityHash,
      session,
    );
    r = f.kernel.prepareAttempt(r.id, r.version, session);
    const pending = f.kernel
      .startAttempt(r.id, r.version, prepared.manifest.identityHash, session)
      .catch(() => undefined);
    await sent;
    const original = f.kernel.database.get.bind(f.kernel.database),
      closed = vi.spyOn(f.kernel.database, "close");
    vi.spyOn(f.kernel.database, "get").mockImplementation((sql, ...args) => {
      if (sql.includes("research_provider_attempts"))
        throw new Error("Synthetic disk read failure");
      return original(sql, ...args);
    });
    expect(() => f.kernel.close()).toThrow();
    expect(closed).toHaveBeenCalled();
    expect(aborted).toBe(true);
    vi.restoreAllMocks();
    await pending;
    await f.restart();
    expect(f.kernel.readReview(r.id, session).review.status).toBe(
      "provider_attempt_uncertain",
    );
  } finally {
    vi.restoreAllMocks();
    await f.cleanup();
  }
});
