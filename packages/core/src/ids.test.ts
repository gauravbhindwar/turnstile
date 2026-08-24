import { describe, it, expect } from "vitest";
import { uuidv7 } from "./ids.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("uuidv7", () => {
  it("produces well-formed v7 UUIDs", () => {
    for (let i = 0; i < 20; i++) {
      expect(uuidv7()).toMatch(UUID_RE);
    }
  });

  it("is unique across many calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(ids.size).toBe(1000);
  });

  it("is time-sortable: later calls sort lexicographically after earlier ones", async () => {
    const a = uuidv7();
    await new Promise((r) => setTimeout(r, 5));
    const b = uuidv7();
    expect(a < b).toBe(true);
  });
});
