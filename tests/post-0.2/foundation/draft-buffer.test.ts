import { expect, test } from "vitest";
import { DraftBuffer } from "../../../apps/research-room/client/src/api/draft-buffer.js";

test("saved acknowledgement cannot resurrect a privacy-redacted editor", () => {
  const draft = new DraftBuffer();
  draft.receive("saved", 1);
  draft.text = "private text";
  draft.receive("", 3, true);
  draft.saved("private text", 2);
  expect(draft.text).toBe("");
  expect(draft.serverText).toBe("");
  expect(draft.dirty).toBe(false);
});

test("save retains subsequent typing and requires explicit conflict resolution", () => {
  const draft = new DraftBuffer();
  draft.receive("base", 1);
  draft.text = "submitted";
  draft.text = "new typing";
  draft.saved("submitted", 2);
  expect(draft.text).toBe("new typing");
  expect(draft.dirty).toBe(true);
  draft.receive("remote change", 3);
  expect(draft.conflict).toBe(true);
  expect(draft.text).toBe("new typing");
  draft.keepLocalAgainstCurrent();
  expect(draft.conflict).toBe(false);
  expect(draft.baseVersion).toBe(3);
  draft.discard();
  expect(draft.text).toBe("remote change");
});
