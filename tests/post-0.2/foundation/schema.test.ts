import { expect, it } from "vitest";
import * as storage from "@sestina/storage";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("G2: the opt-in Kernel schema stores workflow, canonical head, receipts and privacy separately", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sestina-schema-red-"));
  // The baseline supports only the shipped set. This probes real schema
  // behavior without failing on an unresolved import or a missing SQL symbol.
  const migrations =
    (
      storage as typeof storage & {
        KERNEL_MIGRATIONS?: readonly storage.Migration[];
      }
    ).KERNEL_MIGRATIONS ?? storage.MIGRATIONS;
  const db = await storage.openDatabase({
    path: join(dir, "state.sqlite"),
    migrate: { migrations },
  });
  try {
    const tables = db
      .all<{ name: string }>(
        "SELECT name FROM sqlite_schema WHERE type='table'",
      )
      .map((r) => r.name);
    expect(
      tables,
      "The shipped schema has no durable head, interactive Review, or atomic transition proof.",
    ).toEqual(
      expect.arrayContaining([
        "research_project_state_heads",
        "research_project_state_events",
        "research_reviews",
        "research_provider_attempts",
        "research_review_corrections",
        "context_manifests",
        "research_transition_receipts",
        "research_authority_commands",
        "research_brief_metadata",
        "research_legacy_mappings",
        "research_projection_outbox",
        "research_privacy_redactions",
        "research_copy_inventory",
      ]),
    );
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
