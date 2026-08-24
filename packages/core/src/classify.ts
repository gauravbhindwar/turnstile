import type { ActionClass, ActionKind } from "./types/action.js";

export interface ClassifyInput {
  kind: ActionKind;
  method?: string;
  mcpReadOnlyHint?: boolean;
  declaredClass?: ActionClass;
}

// Deterministic classification rules per §6. ActionClass drives fail-open/
// closed behavior (D10) and default policy strictness.
export function classifyAction(input: ClassifyInput): ActionClass {
  switch (input.kind) {
    case "model.chat":
    case "model.embed":
      return "spend";
    case "mcp.resource_read":
      return "read";
    case "mcp.tool_call":
      return input.mcpReadOnlyHint ? "read" : "mutate";
    case "http.request": {
      const method = (input.method ?? "GET").toUpperCase();
      return method === "GET" || method === "HEAD" ? "read" : "mutate";
    }
    case "custom.action":
      return input.declaredClass ?? "mutate";
    default:
      return "mutate";
  }
}
