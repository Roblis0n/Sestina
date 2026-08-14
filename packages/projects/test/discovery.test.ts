import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { generateId } from "@sestina/schema";
import { sha256, type StorageDatabase } from "@sestina/storage";
import {
  createProjectDiscovery,
  createProjectService,
  canonicalizeRootPath,
} from "../src/index.js";
import { makeTempDir, removeTempDir, makeDb, expectSestinaCode, T0 } from "./helpers.js";

describe("project discovery (docs/30 §4)", () => {
  let dir: string;
  let db: StorageDatabase;

  beforeEach(async () => {
    dir = makeTempDir();
    db = await makeDb(dir);
  });
  afterEach(() => {
    db.close();
    removeTempDir(dir);
  });

  it("creates a discovered project for an unrecognized root", async () => {
    const discovery = createProjectDiscovery(db);
    const root = join(dir, "fresh-root");
    const result = await discovery.discover(root);
    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    expect(result.project.name).toBe("fresh-root");
    expect(result.project.status).toBe("active");
    const binding = result.project.bindings[0];
    expect(binding?.rootPath).toBe(canonicalizeRootPath(root, true));
    expect(binding?.source).toBe("discovered");
    expect(binding?.confirmed).toBe(false);
  });

  it("attaches to the project already bound at the canonical root", async () => {
    const projects = createProjectService(db);
    const discovery = createProjectDiscovery(db);
    const root = join(dir, "known-root");
    const created = await projects.createProject({ name: "Known", roots: [root] });
    const result = await discovery.discover(root);
    expect(result.kind).toBe("attached");
    if (result.kind !== "attached") return;
    expect(result.project.projectId).toBe(created.projectId);
  });

  it("queues unowned host events with the exact raw payload retained", () => {
    const discovery = createProjectDiscovery(db);
    const rawEvent = '{"type":"turn.started","session":"hs-1"}';
    discovery.enqueueUnowned({
      host: "codex",
      hostSessionId: "hs-1",
      occurredAt: T0,
      reason: "no_project",
      rawEvent,
    });
    const pending = discovery.listPending({ limit: 10 });
    expect(pending.items).toHaveLength(1);
    const queued = pending.items[0];
    expect(queued?.rawEvent).toBe(rawEvent);
    expect(queued?.payloadHash).toBe(sha256(rawEvent));
    expect(queued?.reason).toBe("no_project");

    const projectId = generateId();
    const taskId = generateId();
    discovery.resolve(queued?.unownedId ?? "", { projectId, taskId });
    expect(discovery.listPending({ limit: 10 }).items).toHaveLength(0);

    // A second resolve of the same activity is an idempotency violation.
    expectSestinaCode(() => {
      discovery.resolve(queued?.unownedId ?? "", { projectId, taskId });
    }, "idempotency_violation");
  });
});
