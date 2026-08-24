import { describe, it, expect } from "vitest";
import { canonicalJson, sha256Hex, computeChainHash } from "./canonical.js";

describe("canonicalJson (RFC 8785 JCS)", () => {
  it("sorts object keys regardless of insertion order", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("is stable across nested objects and arrays", () => {
    const a = { z: [1, 2, { y: 1, x: 2 }], a: "hi" };
    const b = { a: "hi", z: [1, 2, { x: 2, y: 1 }] };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("preserves array element order (arrays are not sorted)", () => {
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
  });

  it("distinguishes numeric types that JSON.stringify would conflate", () => {
    expect(canonicalJson({ n: 1 })).toBe('{"n":1}');
  });

  it("produces different output for different values", () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });
});

describe("sha256Hex", () => {
  it("is deterministic", () => {
    expect(sha256Hex("hello")).toBe(sha256Hex("hello"));
  });

  it("differs for different input", () => {
    expect(sha256Hex("hello")).not.toBe(sha256Hex("hello!"));
  });

  it("matches the known SHA-256 of an empty string", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("computeChainHash", () => {
  it("changes if any input changes", () => {
    const base = computeChainHash("prev", "payload", 0, "2026-01-01T00:00:00.000Z");
    expect(computeChainHash("prev2", "payload", 0, "2026-01-01T00:00:00.000Z")).not.toBe(base);
    expect(computeChainHash("prev", "payload2", 0, "2026-01-01T00:00:00.000Z")).not.toBe(base);
    expect(computeChainHash("prev", "payload", 1, "2026-01-01T00:00:00.000Z")).not.toBe(base);
    expect(computeChainHash("prev", "payload", 0, "2026-01-01T00:00:00.001Z")).not.toBe(base);
  });
});
