import { describe, it, expect } from "vitest";
import { assertPublicHttpTarget, SsrfBlockedError } from "./ssrfGuard.js";

describe("assertPublicHttpTarget", () => {
  it("allows a public https URL", () => {
    expect(() => assertPublicHttpTarget("https://api.example.com/webhook")).not.toThrow();
  });

  it.each([
    "http://localhost/x",
    "http://127.0.0.1/x",
    "http://10.0.0.5/x",
    "http://172.16.0.1/x",
    "http://192.168.1.1/x",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/x",
  ])("blocks %s", (url) => {
    expect(() => assertPublicHttpTarget(url)).toThrow(SsrfBlockedError);
  });

  it("rejects a malformed URL", () => {
    expect(() => assertPublicHttpTarget("not a url")).toThrow(SsrfBlockedError);
  });

  it("rejects a non-HTTP(S) protocol", () => {
    expect(() => assertPublicHttpTarget("file:///etc/passwd")).toThrow(SsrfBlockedError);
  });

  it("allows a public IP that merely starts with a blocked private prefix's neighbor", () => {
    // 172.32.x.x is outside the RFC1918 172.16-172.31 range.
    expect(() => assertPublicHttpTarget("http://172.32.0.1/x")).not.toThrow();
  });
});
