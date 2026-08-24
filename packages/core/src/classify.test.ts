import { describe, it, expect } from "vitest";
import { classifyAction } from "./classify.js";

describe("classifyAction", () => {
  it("classifies model calls as spend", () => {
    expect(classifyAction({ kind: "model.chat" })).toBe("spend");
    expect(classifyAction({ kind: "model.embed" })).toBe("spend");
  });

  it("classifies mcp.resource_read as read", () => {
    expect(classifyAction({ kind: "mcp.resource_read" })).toBe("read");
  });

  it("classifies mcp.tool_call by readOnlyHint", () => {
    expect(classifyAction({ kind: "mcp.tool_call", mcpReadOnlyHint: true })).toBe("read");
    expect(classifyAction({ kind: "mcp.tool_call", mcpReadOnlyHint: false })).toBe("mutate");
    expect(classifyAction({ kind: "mcp.tool_call" })).toBe("mutate");
  });

  it("classifies http.request by method", () => {
    expect(classifyAction({ kind: "http.request", method: "GET" })).toBe("read");
    expect(classifyAction({ kind: "http.request", method: "HEAD" })).toBe("read");
    expect(classifyAction({ kind: "http.request", method: "POST" })).toBe("mutate");
    expect(classifyAction({ kind: "http.request" })).toBe("read");
  });

  it("classifies custom.action from declaredClass, defaulting to mutate", () => {
    expect(classifyAction({ kind: "custom.action" })).toBe("mutate");
    expect(classifyAction({ kind: "custom.action", declaredClass: "read" })).toBe("read");
  });
});
