import { minimatch } from "minimatch";
import { decryptCredential } from "@turnstile/core";
import type { GatewayContext } from "./context.js";

export interface ResolvedUpstream {
  name: string;
  baseUrl: string;
  apiKey: string | null;
}

export class UpstreamResolutionError extends Error {}

// model -> upstream via model_routes (first glob match wins); explicit
// `x-turnstile-upstream` header override (§7.1). No smart routing (N3).
export function resolveUpstreamName(ctx: GatewayContext, model: string, overrideHeader?: string): string {
  if (overrideHeader) return overrideHeader;
  const route = ctx.config.model_routes.find((r) => minimatch(model, r.match));
  if (!route) {
    throw new UpstreamResolutionError(`no model_routes entry matches model "${model}"`);
  }
  return route.upstream;
}

export function resolveUpstream(ctx: GatewayContext, upstreamName: string): ResolvedUpstream {
  const upstream = ctx.storage.upstreams.get(upstreamName);
  if (!upstream) {
    throw new UpstreamResolutionError(`unknown upstream "${upstreamName}"`);
  }
  let apiKey: string | null = null;
  if (upstream.credentialId) {
    const credential = ctx.storage.credentials.get(upstream.credentialId);
    if (credential) {
      apiKey = decryptCredential(ctx.credentialMasterKey, credential.ciphertext);
    }
  }
  return { name: upstream.name, baseUrl: upstream.baseUrl, apiKey };
}
