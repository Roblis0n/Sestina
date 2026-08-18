/**
 * Research actors: who produced a piece of research state. Only user
 * actors can hold user authority; model, system and import actors are
 * structurally distinct so they can never be mistaken for the user.
 */
import { researchError } from "../errors.js";
import { err, ok } from "../result.js";
import type { ResearchResult } from "../result.js";

export type ResearchActor =
  | { kind: "user"; actorId: string }
  | {
      kind: "model";
      provider?: string;
      model?: string;
      sessionId?: string;
    }
  | { kind: "system"; component: string }
  | { kind: "import"; sourceSystem: string };

export type ResearchActorKind = ResearchActor["kind"];

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateResearchActor(
  actor: unknown,
): ResearchResult<ResearchActor> {
  if (typeof actor !== "object" || actor === null) {
    return err(researchError("invalid_actor"));
  }
  const record = actor as Record<string, unknown>;
  switch (record.kind) {
    case "user":
      if (!isNonBlankString(record.actorId)) {
        return err(researchError("invalid_actor", { field: "actorId" }));
      }
      return ok({ kind: "user", actorId: record.actorId });
    case "model": {
      const validated: {
        kind: "model";
        provider?: string;
        model?: string;
        sessionId?: string;
      } = { kind: "model" };
      for (const field of ["provider", "model", "sessionId"] as const) {
        const value = record[field];
        if (value === undefined) continue;
        if (!isNonBlankString(value)) {
          return err(researchError("invalid_actor", { field }));
        }
        validated[field] = value;
      }
      return ok(validated);
    }
    case "system":
      if (!isNonBlankString(record.component)) {
        return err(researchError("invalid_actor", { field: "component" }));
      }
      return ok({ kind: "system", component: record.component });
    case "import":
      if (!isNonBlankString(record.sourceSystem)) {
        return err(researchError("invalid_actor", { field: "sourceSystem" }));
      }
      return ok({ kind: "import", sourceSystem: record.sourceSystem });
    default:
      return err(researchError("invalid_actor", { field: "kind" }));
  }
}
