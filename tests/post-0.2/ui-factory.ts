import { createUi02Project } from "../helpers/ui02-project.js";
import { createRi51Project } from "../helpers/ri51-project.js";

/** Real synthetic projects for the shipped client/server. No screenshot-only state. */
export async function productionUiProject(state: "ready" | "long" | "memory_states" = "ready") {
  if (state === "memory_states") return createRi51Project();
  return createUi02Project({ title: "Synthetic G1 production-state fixture", question: state === "long" ? "Synthetic bounded question 合成研究边界。".repeat(150) : "Which explicit user change preserves research authority?" });
}
