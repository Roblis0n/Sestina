import { describe, expect, expectTypeOf, it } from "vitest";
import {
  RESEARCH_PAGE_LIMIT_MAX,
  parseResearchPageRequest,
  type ResearchRepositories,
  type ResearchUnitOfWork,
} from "../src/index.js";

describe("research persistence ports", () => {
  it("defines bounded stable page requests for research repositories", () => {
    expect(parseResearchPageRequest({ limit: 25 })).toEqual({
      ok: true,
      value: { limit: 25 },
    });
    expect(parseResearchPageRequest({ limit: RESEARCH_PAGE_LIMIT_MAX + 1 })).toMatchObject({
      ok: false,
      error: { code: "invalid_pagination" },
    });
    expect(parseResearchPageRequest({ limit: 10, cursor: "" })).toMatchObject({
      ok: false,
      error: { code: "invalid_pagination" },
    });
  });

  it("exposes the repository composition required by a unit of work", () => {
    expectTypeOf<ResearchRepositories>().toHaveProperty("snapshots");
    expectTypeOf<ResearchUnitOfWork>().toHaveProperty("commit");
  });
});
