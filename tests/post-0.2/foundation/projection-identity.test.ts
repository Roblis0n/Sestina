import { afterEach, expect, it, vi } from "vitest";
import {
  readKernelProjection,
  rebuildKernelProjection,
} from "@sestina/research-store";
import { withTransaction, backupDatabase } from "@sestina/storage";
import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import {
  applicationFixture,
  session,
  ready,
  commit,
} from "../application-fixtures.js";
import { FixedClock, SequenceIdFactory } from "@sestina/research";

const fixtures: Awaited<ReturnType<typeof applicationFixture>>[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const f of fixtures.splice(0)) await f.cleanup();
});

it("G8: a saved draft invalidates a ready view without advancing research revision", async () => {
  const f = await applicationFixture();
  fixtures.push(f);
  expect(
    rebuildKernelProjection(f.kernel.database, f.projectId, "today", () => ({
      count: 0,
    })).ok,
  ).toBe(true);
  expect(
    readKernelProjection(f.kernel.database, f.projectId, "today").status,
  ).toBe("ready");
  f.kernel.createReview(
    "A newly saved suggestion needs a user decision",
    session,
  );
  const view = readKernelProjection(f.kernel.database, f.projectId, "today");
  expect(view.sourceProjectStateRevision).toBe(1);
  expect(view.status).toBe("rebuilding");
  expect(view.data).toBeNull();
});

it("G8: restoring a verified baseline and reaching the same revision cannot reuse another content branch", async () => {
  const f = await applicationFixture();
  fixtures.push(f);
  const baseline = await backupDatabase(f.kernel.database, {
    backupDirectory: join(f.root, "synthetic-backup"),
  });
  commit(f, await ready(f, "First content branch"), {
    kind: "record_only",
    outcome: "reference_only",
    reason: "Synthetic first result",
  });
  expect(
    rebuildKernelProjection(f.kernel.database, f.projectId, "today", () => ({
      title: "First content branch",
    })).ok,
  ).toBe(true);
  const old = f.kernel.database.get<{ data: string }>(
    "SELECT data FROM research_projection_metadata WHERE project_id=? AND projection_kind='today'",
    f.projectId,
  )!;
  f.kernel.close();
  await copyFile(baseline.path, f.databasePath);
  await f.restart();
  commit(f, await ready(f, "Different restored content branch"), {
    kind: "record_only",
    outcome: "deferred",
    reason: "Synthetic different result",
  });
  withTransaction(f.kernel.database, () =>
    f.kernel.database.withKernelWrite("workflow", () =>
      f.kernel.database.run(
        "UPDATE research_projection_metadata SET source_revision=2,status='ready',data=? WHERE project_id=? AND projection_kind='today'",
        old.data,
        f.projectId,
      ),
    ),
  );
  expect(
    readKernelProjection(f.kernel.database, f.projectId, "today"),
  ).toMatchObject({
    sourceProjectStateRevision: 2,
    status: "rebuilding",
    data: null,
  });
  expect(f.kernel.workspace({ view: "today" }, session).recent[0]?.title).toBe(
    "record_only",
  );
});

it("G8: Memory expiry invalidates derived data without any database write", async () => {
  const clock = new FixedClock("2026-09-08T00:00:00.000Z"),
    ids = new SequenceIdFactory(910000);
  const f = await applicationFixture(undefined, { clock });
  fixtures.push(f);
  f.kernel.governMemory(
    ids.create("rpev_"),
    1,
    {
      action: "create",
      kind: "working_hint",
      content: { text: "Synthetic expiring body" },
      retention: {
        policy: "until_date",
        expiresAt: "2026-09-09T00:00:00.000Z",
      },
      sensitivity: "public",
      outboundPolicy: "explicit_manifest_only",
      publicReason: "Short-lived synthetic context",
    },
    session,
  );
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime("2026-09-08T00:00:00.000Z");
  expect(
    rebuildKernelProjection(f.kernel.database, f.projectId, "search", () => ({
      text: "Synthetic expiring body",
    })).ok,
  ).toBe(true);
  vi.setSystemTime("2026-09-10T00:00:00.000Z");
  expect(
    readKernelProjection(f.kernel.database, f.projectId, "search"),
  ).toMatchObject({
    sourceProjectStateRevision: 2,
    status: "rebuilding",
    data: null,
  });
});

it("G8: a workflow edit during rebuilding cannot publish an obsolete view", async () => {
  const f = await applicationFixture();
  fixtures.push(f);
  const result = rebuildKernelProjection(
    f.kernel.database,
    f.projectId,
    "search",
    () => {
      f.kernel.createReview(
        "Changed while projection was being built",
        session,
      );
      return { count: 0 };
    },
  );
  expect(result.ok).toBe(false);
  expect(
    readKernelProjection(f.kernel.database, f.projectId, "search").status,
  ).toBe("rebuilding");
});

it("G8: corrupt derived bytes are unavailable and rebuildable, with outbox preserved", async () => {
  const f = await applicationFixture();
  fixtures.push(f);
  const db = f.kernel.database;
  const before = db.all("SELECT * FROM research_projection_outbox");
  withTransaction(db, () =>
    db.withKernelWrite("workflow", () =>
      db.run(
        "UPDATE research_projection_metadata SET status='ready',source_revision=1,data='{}' WHERE project_id=? AND projection_kind='search'",
        f.projectId,
      ),
    ),
  );
  expect(readKernelProjection(db, f.projectId, "search")).toMatchObject({
    status: "unavailable",
    data: null,
  });
  expect(
    rebuildKernelProjection(db, f.projectId, "search", () => ({
      restored: true,
    })).ok,
  ).toBe(true);
  expect(readKernelProjection(db, f.projectId, "search")).toMatchObject({
    status: "ready",
    data: { restored: true },
  });
  withTransaction(db, () =>
    db.withKernelWrite("workflow", () =>
      db.run(
        "UPDATE research_projection_metadata SET data=json_set(data,'$.payload.restored',0) WHERE project_id=? AND projection_kind='search'",
        f.projectId,
      ),
    ),
  );
  expect(readKernelProjection(db, f.projectId, "search")).toMatchObject({
    status: "unavailable",
    data: null,
  });
  expect(db.all("SELECT * FROM research_projection_outbox")).toEqual(before);
});
