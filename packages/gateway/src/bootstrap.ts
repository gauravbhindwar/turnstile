import { join } from "node:path";
import {
  SqliteStorage,
  Pipeline,
  EventBus,
  loadPriceSheet,
  loadOrCreateMasterKey,
  loadOrCreateCheckpointKeypair,
  builtinPlugins,
  loadPolicies,
  encryptCredential,
  uuidv7,
  type TurnstileConfig,
  type Logger,
} from "@turnstile/core";
import type { GatewayContext } from "./context.js";

export async function bootstrap(config: TurnstileConfig, logger: Logger): Promise<GatewayContext> {
  const dbPath = config.data_dir === ":memory:" ? ":memory:" : join(config.data_dir, "turnstile.db");
  const storage = new SqliteStorage(dbPath);
  await storage.init();

  const priceSheet = loadPriceSheet(config.prices_file);
  const credentialMasterKey = loadOrCreateMasterKey(config.data_dir);
  const checkpointKeypair = loadOrCreateCheckpointKeypair(config.data_dir);
  const plugins = builtinPlugins();

  const { policies, errors } = loadPolicies(config.policies_dir, plugins);
  for (const err of errors) {
    logger.error({ file: err.file, message: err.message }, "policy failed to load; skipped");
  }
  logger.info({ count: policies.length }, "policies loaded");

  for (const upstream of config.upstreams) {
    const existing = storage.upstreams.get(upstream.name);
    let credentialId = existing?.credentialId ?? null;
    if (!credentialId && upstream.credential_env) {
      const apiKey = process.env[upstream.credential_env];
      if (apiKey) {
        credentialId = uuidv7();
        storage.credentials.create({
          id: credentialId,
          label: `${upstream.name}-key`,
          ciphertext: encryptCredential(credentialMasterKey, apiKey),
          createdAt: new Date().toISOString(),
        });
      }
    }
    storage.upstreams.upsert({ name: upstream.name, kind: upstream.kind, baseUrl: upstream.base_url, credentialId });
  }

  const eventBus = new EventBus();
  const pipeline = new Pipeline(
    {
      storage,
      logger,
      eventBus,
      priceSheet,
      defaultActionByClass: config.defaults.default_action_by_class,
      failMode: config.fail_mode,
      checkpointKeypair,
      checkpointEveryRows: config.ledger.checkpoint_every_rows,
      checkpointEveryMs: config.ledger.checkpoint_every_s * 1000,
    },
    policies,
    plugins,
  );

  return { config, logger, storage, pipeline, priceSheet, eventBus, plugins, policies, credentialMasterKey };
}
