import { describe, it, expect } from "vitest";
import { interpolateEnv } from "./interpolate.js";

describe("interpolateEnv", () => {
  it("replaces ${VAR} with env value", () => {
    const result = interpolateEnv({ token: "${FOO_TOKEN}" }, { FOO_TOKEN: "abc123" });
    expect(result).toEqual({ token: "abc123" });
  });

  it("resolves a missing whole-string var to null", () => {
    const result = interpolateEnv({ token: "${MISSING_VAR}" }, {});
    expect(result).toEqual({ token: null });
  });

  it("resolves a missing var embedded in a larger string to empty string", () => {
    const result = interpolateEnv({ url: "https://${MISSING_HOST}/v1" }, {});
    expect(result).toEqual({ url: "https:///v1" });
  });

  it("interpolates inside arrays and nested objects", () => {
    const result = interpolateEnv(
      { list: [{ url: "${HOST}/v1" }], nested: { deep: "${HOST}" } },
      { HOST: "http://x" },
    );
    expect(result).toEqual({ list: [{ url: "http://x/v1" }], nested: { deep: "http://x" } });
  });

  it("leaves non-template strings untouched", () => {
    expect(interpolateEnv("plain string", {})).toBe("plain string");
  });

  it("passes through numbers and booleans", () => {
    expect(interpolateEnv({ n: 42, b: true, nil: null }, {})).toEqual({ n: 42, b: true, nil: null });
  });
});
