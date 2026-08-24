import type {
  TurnstileConfig,
  Logger,
  Storage,
  Pipeline,
  PriceSheet,
  PolicyPlugin,
  EventBus,
} from "@turnstile/core";
import type { PolicyFile } from "@turnstile/core";

export interface GatewayContext {
  config: TurnstileConfig;
  logger: Logger;
  storage: Storage;
  pipeline: Pipeline;
  priceSheet: PriceSheet;
  eventBus: EventBus;
  plugins: Map<string, PolicyPlugin>;
  policies: PolicyFile[];
  credentialMasterKey: Buffer;
}
