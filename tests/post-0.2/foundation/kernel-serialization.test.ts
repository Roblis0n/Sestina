import { expect, it } from "vitest";
import { clearKernelSerializationCache, freezeKernel, kernelCanonicalJson, kernelHash } from "@sestina/research";

it("canonical bytes retain numeric-key order, Unicode normalization and shared-value semantics", () => {
  const value = { z: "e\u0301", "10": "ten", "2": "two", a: [null, -0, true] };
  const frozen = freezeKernel(value);
  const expected = '{"2":"two","10":"ten","a":[null,0,true],"z":"é"}';
  expect(kernelCanonicalJson(value)).toBe(expected);
  expect(kernelCanonicalJson(frozen)).toBe(expected);
  expect(kernelCanonicalJson({ left: frozen, right: frozen })).toBe(
    `{"left":${expected},"right":${expected}}`,
  );
  expect(kernelHash(frozen)).toBe(kernelHash(value));
  clearKernelSerializationCache();
  expect(kernelCanonicalJson(frozen)).toBe(expected);
});

it("caller-frozen wrappers and changing getters cannot reuse stale canonical bytes", () => {
  const child = { value: "first" };
  const wrapper = Object.freeze({ child });
  const before = kernelHash(wrapper);
  child.value = "second";
  expect(kernelHash(wrapper)).not.toBe(before);
  let current = "first";
  const getter = Object.freeze({ get value() { return current; } });
  const first = freezeKernel(getter);
  current = "second";
  expect(kernelHash(getter)).not.toBe(kernelHash(first));
  expect(kernelCanonicalJson(first)).toBe('{"value":"first"}');
  let reads = 0;
  const changing = freezeKernel({ get value() { return ++reads; } });
  expect(kernelCanonicalJson(changing)).toBe(JSON.stringify(changing));
});

it("previously serialized immutable children never bypass depth, size or cycle checks", () => {
  const frozen = freezeKernel({ leaf: "kept" });
  kernelCanonicalJson(frozen);
  let nested: unknown = frozen;
  for (let i = 0; i < 64; i++) nested = { child: nested };
  expect(() => kernelCanonicalJson(nested)).toThrow("invalid_record");
  const large = freezeKernel({ text: "x".repeat(4_200_000) });
  kernelCanonicalJson(large);
  expect(() => kernelCanonicalJson({ a: large, b: large })).toThrow("invalid_record");
  const cycle: { child?: unknown } = {};
  cycle.child = cycle;
  expect(() => kernelCanonicalJson(cycle)).toThrow("invalid_record");
});
