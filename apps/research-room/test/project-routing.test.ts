import { describe, expect, it } from "vitest";
import { hrefForRoute, parseProjectRoute } from "../client/src/routing/project-route.js";

describe("UI-02 project-local routing", () => {
  it("parses refreshable workspace routes without paths or research content", () => {
    expect(parseProjectRoute("/project/overview")).toEqual({ workspace: "overview" });
    expect(parseProjectRoute("/project/decisions/rdec_01ARZ3NDEKTSV4RRFFQ69G5FAV")).toEqual({ workspace: "decision", objectId: "rdec_01ARZ3NDEKTSV4RRFFQ69G5FAV" });
    expect(parseProjectRoute("/project/review")).toEqual({ workspace: "review" });
    expect(hrefForRoute({ workspace: "issue", objectId: "riss_01ARZ3NDEKTSV4RRFFQ69G5FAV" })).toBe("/project/issues/riss_01ARZ3NDEKTSV4RRFFQ69G5FAV");
  });

  it("fails closed on malformed, cross-surface, or sensitive route material", () => {
    expect(parseProjectRoute("/project/decisions/not-an-id")).toEqual({ workspace: "not_found" });
    expect(parseProjectRoute("/project/overview/H:/AI")).toEqual({ workspace: "not_found" });
    expect(parseProjectRoute("/project/receipts/rrcp_01ARZ3NDEKTSV4RRFFQ69G5FAV/secret")).toEqual({ workspace: "not_found" });
  });
});
