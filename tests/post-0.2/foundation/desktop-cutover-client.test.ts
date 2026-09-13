import { afterEach, expect, it, vi } from "vitest";
import { ResearchRoomApi } from "../../../apps/research-room/client/src/api/desktop-client.js";

afterEach(() => vi.unstubAllGlobals());
it("the installed client never falls back to an HTTP research service when its bridge is absent", async () => {
  vi.stubGlobal("window", {});
  const outbound = vi.fn().mockRejectedValue(new Error("unexpected HTTP"));
  vi.stubGlobal("fetch", outbound);
  await expect(new ResearchRoomApi().status()).rejects.toMatchObject({
    code: "offline",
  });
  expect(outbound).not.toHaveBeenCalled();
});
it("the installed client does not expose the old generic or Room/Pilot writing surface", () => {
  const client = new ResearchRoomApi();
  for (const name of [
    "prepareReview",
    "commitReview",
    "createClosedExternalAppPilot",
    "createDeliberationRoom",
    "prepareResearchRoomReview",
  ])
    expect(Reflect.get(client, name), name).toBeUndefined();
});
