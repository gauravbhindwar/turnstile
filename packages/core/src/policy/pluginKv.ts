import type { Storage } from "../storage/types.js";
import type { PluginKV } from "./types.js";

// Namespaces plugin state by policy id so counters/state can't collide
// across policies, and so a Postgres storage swap keeps working (§8.3: "all
// state via `store`").
export function makePluginKv(storage: Storage, policyId: string): PluginKV {
  const ns = `policy:${policyId}`;
  return {
    get: (key: string) => storage.kv.get(ns, key),
    set: (key: string, value: string, ttlMs?: number) => storage.kv.set(ns, key, value, ttlMs),
    incr: (key: string, by: number, ttlMs?: number) => storage.kv.incr(ns, key, by, ttlMs),
    delete: (key: string) => storage.kv.delete(ns, key),
  };
}
