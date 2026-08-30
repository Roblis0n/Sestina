import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ExternalAppPilotWorkspace } from "../client/src/components/product/ExternalAppPilotWorkspace.js";
import { hrefForRoute, parseProjectRoute } from "../client/src/routing/project-route.js";

describe("RI-52 production External App Pilot workspace", () => {
  it("has a canonical deep link and renders the bounded host, disclosure, Authority, Review, and continuity contract", () => {
    expect(parseProjectRoute("/project/external-app-pilot/rpil_01ARZ3NDEKTSV4RRFFQ69G5FAV")).toEqual({
      workspace: "external_app_pilot",
      objectId: "rpil_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    });
    expect(hrefForRoute({ workspace: "external_app_pilot", objectId: "rpil_01ARZ3NDEKTSV4RRFFQ69G5FAV" })).toBe(
      "/project/external-app-pilot/rpil_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    );

    const html = renderToStaticMarkup(createElement(ExternalAppPilotWorkspace, {
      language: "en",
      projectId: "rprj_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      onNavigate: vi.fn(),
      onInspect: vi.fn(),
      onError: vi.fn(),
      onNotice: vi.fn(),
      onAuthorityChanged: vi.fn(() => Promise.resolve()),
    }));
    expect(html).toContain("Closed Codex External App Pilot");
    expect(html).toContain("What leaves this device");
    expect(html).toContain("model_proposed");
    expect(html).toContain("Import is not acceptance");
    expect(html).toContain("new ephemeral session");
    expect(html).not.toContain("automatic retry");
  });
});
