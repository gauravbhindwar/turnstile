import type { PolicyPlugin } from "../types.js";
import { spendCapPlugin } from "./spendCap.js";
import { allowlistPlugin } from "./allowlist.js";
import { rateLimitPlugin } from "./rateLimit.js";
import { requireApprovalPlugin } from "./requireApproval.js";
import { tokenGuardPlugin } from "./tokenGuard.js";

export { spendCapPlugin } from "./spendCap.js";
export { allowlistPlugin } from "./allowlist.js";
export { rateLimitPlugin } from "./rateLimit.js";
export { requireApprovalPlugin } from "./requireApproval.js";
export { tokenGuardPlugin } from "./tokenGuard.js";

export function builtinPlugins(): Map<string, PolicyPlugin> {
  return new Map<string, PolicyPlugin>([
    [spendCapPlugin.name, spendCapPlugin],
    [allowlistPlugin.name, allowlistPlugin],
    [rateLimitPlugin.name, rateLimitPlugin],
    [requireApprovalPlugin.name, requireApprovalPlugin],
    [tokenGuardPlugin.name, tokenGuardPlugin],
  ]);
}
