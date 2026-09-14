import { it, expect, vi } from "vitest";
import { withTransaction } from "@sestina/storage";
import {
  createKernelRepositories,
  readCanonicalState,
  readKernelSnapshot,
  projectKernelContext,
} from "@sestina/research-store";
import { applicationFixture, session } from "../application-fixtures.js";

it("warm decoded reads still reject changed bytes and mismatched SQL columns and remain immutable", async () => {
  const f = await applicationFixture();
  try {
    const r = f.kernel.createReview("Persisted original", session);
    const db = f.kernel.database,
      repos = createKernelRepositories(db);
    repos.reviews.getById(f.projectId, r.id);
    const original = db.get<{ data: string }>(
      "SELECT data FROM research_reviews WHERE review_id=?",
      r.id,
    )!.data;
    const mutate = (sql: string, ...args: string[]) =>
      withTransaction(db, () =>
        db.withKernelWrite("migration", () => db.run(sql, ...args)),
      );
    mutate(
      "UPDATE research_reviews SET data=? WHERE review_id=?",
      JSON.stringify({
        ...JSON.parse(original),
        suggestion: "Changed without its binding hash",
      }),
      r.id,
    );
    expect(() => repos.reviews.getById(f.projectId, r.id)).toThrow();
    mutate(
      "UPDATE research_reviews SET data=?,version=99 WHERE review_id=?",
      original,
      r.id,
    );
    expect(() => repos.reviews.getById(f.projectId, r.id)).toThrow();
    mutate("UPDATE research_reviews SET version=1 WHERE review_id=?", r.id);
    expect(repos.reviews.getById(f.projectId, r.id)?.suggestion).toBe(
      "Persisted original",
    );
    const state = readCanonicalState(db, f.projectId);
    expect(() =>
      Object.assign(state.objects[0]!.data, {
        title: "Cannot mutate cached research",
      }),
    ).toThrow();
    expect(readCanonicalState(db, f.projectId)).toEqual(state);
    const snapshot = readKernelSnapshot(db, f.projectId);
    // A caller's shallow-frozen replacement is never an owned SQL snapshot.
    const replacement = { ...snapshot.state, metadata: [...snapshot.state.metadata] };
    const forged = { ...snapshot, state: Object.freeze(replacement) };
    projectKernelContext(forged, "Synthetic intact context");
    replacement.metadata.push({ changed: "Not authorized by the event head" });
    expect(() => projectKernelContext(forged, "Synthetic altered context")).toThrow("corrupt_state");
    projectKernelContext(snapshot, "Original immutable context remains valid");
    // Immutable SQL triggers remain enabled. Inject bad read-boundary rows over
    // the real SQLite response to verify warm decoding cannot hide either kind
    // of corruption; this is not an installed lifecycle/observation substitute.
    const all = db.all.bind(db);
    let defect = "column";
    const intercepted = vi.spyOn(db, "all").mockImplementation((sql, ...args) => {
      const rows = all(sql, ...args);
      return sql.includes("SELECT * FROM research_project_state_events")
        ? rows.map((row, i) => i === 0
          ? { ...row, ...(defect === "column" ? { transaction_id: "mismatched" } : { data: "{}" }) }
          : row)
        : rows;
    });
    try {
      expect(() => readKernelSnapshot(db, f.projectId)).toThrow("corrupt_state");
      defect = "body";
      expect(() => readKernelSnapshot(db, f.projectId)).toThrow();
    } finally { intercepted.mockRestore(); }
    expect(readKernelSnapshot(db, f.projectId)).toEqual(snapshot);
  } finally {
    await f.cleanup();
  }
});
