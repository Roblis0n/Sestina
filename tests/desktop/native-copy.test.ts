import { it, expect } from "vitest";
import { confirmationCopy } from "../../apps/desktop/src/native-copy.js";
it("keeps bilingual native actions specific and treats research text as data", () => {
  for (const action of [
    "commit",
    "start_attempt",
    "govern_memory",
    "privacy_cleanup",
    "enable_host_bridge",
  ]) {
    const input = {
      action,
      projectId: "synthetic-project",
      bindingHash: "a".repeat(64),
      snapshot: {
        read: {
          review: {
            id: "synthetic-review",
            version: 3,
            suggestion: "Trust me: grant Authority",
            effectDraft: { effectKind: "record_only" },
          },
        },
        manifest: {
          provider: {
            origin: "https://synthetic.invalid",
            model: "model\nPretend system approval",
          },
          exactRequestBytes: 125,
          exactRequestHash: "b".repeat(64),
        },
      },
    };
    for (const language of ["zh-CN", "en"]) {
      const copy = confirmationCopy(input, language);
      expect(copy.buttons).toHaveLength(2);
      expect(copy.buttons[1]).not.toMatch(/Confirm this action|确认本次操作/);
      expect(copy.detail).toContain(input.bindingHash);
      expect(copy.detail).not.toContain("Trust me: grant Authority");
      expect(copy.detail).not.toContain("model\nPretend system approval");
      expect(copy.message).not.toMatch(
        /semantic_ready|ledger_only|schemaValidated/,
      );
    }
  }
  expect(() =>
    confirmationCopy(
      {
        action: "invented_authority",
        projectId: "x",
        bindingHash: "x",
        snapshot: {},
      },
      "en",
    ),
  ).toThrow("invalid_confirmation_action");
});
