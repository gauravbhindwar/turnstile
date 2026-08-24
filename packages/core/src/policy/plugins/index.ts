import type { PolicyPlugin } from "../types.js";
import { spendCapPlugin } from "./spendCap.js";
import { allowlistPlugin } from "./allowlist.js";

export { spendCapPlugin } from "./spendCap.js";
export { allowlistPlugin } from "./allowlist.js";

export function builtinPlugins(): Map<string, PolicyPlugin> {
  return new Map<string, PolicyPlugin>([
    [spendCapPlugin.name, spendCapPlugin],
    [allowlistPlugin.name, allowlistPlugin],
  ]);
}
