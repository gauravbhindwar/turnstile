import { minimatch } from "minimatch";
import type { ActionEvent } from "../types/action.js";
import type { PolicyMatch } from "./schema.js";

// All listed conditions must hold (AND); an omitted field matches everything (§8.2).
export function matchesEvent(match: PolicyMatch, event: ActionEvent): boolean {
  if (match.workspaces && !match.workspaces.includes(event.principal.workspaceId)) return false;
  if (match.agents && !match.agents.some((a) => a === event.principal.agentId || a === event.principal.agentName)) {
    return false;
  }
  if (match.kinds && !match.kinds.includes(event.kind)) return false;
  if (match.classes && !match.classes.includes(event.actionClass)) return false;
  if (match.targets && !match.targets.some((glob) => minimatch(event.resource.target, glob))) return false;
  return true;
}
