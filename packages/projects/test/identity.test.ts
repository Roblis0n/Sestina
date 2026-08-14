import { describe, it, expect } from "vitest";
import {
  canonicalizeRootPath,
  computeRootFingerprint,
  deriveProjectId,
  rootAlias,
} from "../src/index.js";

describe("project identity (docs/30 §3/§4)", () => {
  it("canonicalizes paths with platform case semantics", () => {
    const lower = canonicalizeRootPath("C:\\Users\\Test\\Work", true);
    const upper = canonicalizeRootPath("C:\\USERS\\TEST\\WORK", true);
    expect(lower).toBe(upper);
    // Separators are normalized so fingerprints stay platform-stable.
    expect(lower.includes("\\")).toBe(false);
    // Case-sensitive semantics keep the two spellings distinct.
    expect(canonicalizeRootPath("C:\\Users\\Test\\Work", false)).not.toBe(lower);
  });

  it("derives content-independent fingerprints that survive path moves via git remote", () => {
    const original = computeRootFingerprint("D:\\work\\repo", {
      gitRemote: "https://example.com/org/repo.git",
    });
    const moved = computeRootFingerprint("D:\\new-location\\repo", {
      gitRemote: "https://example.com/org/repo.git",
    });
    // The path identity differs…
    expect(original.pathFingerprint).not.toBe(moved.pathFingerprint);
    expect(original.pathFingerprint).not.toBe(original.fingerprint);
    // …but the remote identity is stable across the move (docs/30 §4).
    expect(original.fingerprint).toBe(moved.fingerprint);
    expect(original.gitRemote).toBe("https://example.com/org/repo.git");
    expect(original.caseSemantics).toBe("case_insensitive");

    // Without a remote, the path fingerprint is the identity.
    const noRemote = computeRootFingerprint("D:\\work\\repo");
    expect(noRemote.fingerprint).toBe(noRemote.pathFingerprint);
    expect(noRemote.gitRemote).toBe("");
  });

  it("derives stable project ids without path plaintext (docs/30 §3)", async () => {
    const a = await deriveProjectId("fp-abc");
    const b = await deriveProjectId("fp-abc");
    const other = await deriveProjectId("fp-def");
    expect(a).toBe(b);
    expect(a).not.toBe(other);
    // A schema-valid ULID shape — no path text survives the derivation.
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("derives root aliases from the canonical path", () => {
    expect(rootAlias("D:/work/repo")).toBe("repo");
    expect(rootAlias("D:/")).toBe("D:");
    expect(rootAlias("/")).toBe("/");
  });
});
