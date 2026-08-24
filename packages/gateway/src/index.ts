import { loadConfig, assertBootSecurityGate, createLogger, watchConfig } from "@turnstile/core";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const config = loadConfig();
  assertBootSecurityGate(config);

  const logger = createLogger(config.logging);
  const configWatcher = watchConfig(process.env.TURNSTILE_CONFIG, logger);

  const app = buildApp({ config, logger });

  await app.listen({ port: config.server.port, host: config.server.host });
  logger.info({ port: config.server.port, host: config.server.host }, "turnstile gateway listening");

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down");
    await configWatcher.close();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("fatal boot error:", err);
  process.exit(1);
});
