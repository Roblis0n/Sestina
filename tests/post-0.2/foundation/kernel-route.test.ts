import { expect, it } from "vitest";
import { parseKernelRoute as route } from "../../../apps/research-room/client/src/routing/kernel-route.js";
const id = "00000000000000000000000001";
it("G9: old object links retain their target and old workflows stay in source-labelled history", () => {
  expect(route(`/project/decisions/rdec_${id}`).redirect).toBe(
    `/project/state?object=rdec_${id}`,
  );
  expect(route(`/project/receipts/rrcp_${id}`).redirect).toBe(
    `/project/history/research_room_receipts/rrcp_${id}`,
  );
  expect(route(`/project/external-app-pilots/rpil_${id}`).redirect).toBe(
    `/project/history/closed_external_app_pilots/rpil_${id}`,
  );
  expect(route("/project/review").redirect).toBe("/project/today");
  expect(route("/project/state", `?object=rclm_${id}%3Arevd_${id}`).page).toBe(
    "project",
  );
  expect(route("/project/kernel", `?review=rrvw_${id}`).redirect).toBe(
    `/project/reviews/rrvw_${id}`,
  );
  for (const path of [
    "/appeals/new",
    "/deliberation-rooms/new",
    "/external-app-pilots/new",
    "/project/appeals/new",
  ])
    expect(route(path).page).toBe("read_only");
  for (const path of [
    "/project/history/evil/x",
    "/project/reviews/wrong",
    "/project/made-up",
    "/project/settings/unknown",
  ])
    expect(route(path).page).toBe("not_found");
  expect(route("/project/state", "?object=../../outside").page).toBe(
    "not_found",
  );
});
