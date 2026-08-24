import chokidar, { type FSWatcher } from "chokidar";
import { loadConfig, resolveConfigPath, ConfigError } from "./loader.js";
import type { TurnstileConfig } from "./schema.js";
import type { Logger } from "../logging/logger.js";

export interface ConfigWatcherHandle {
  current: () => TurnstileConfig;
  close: () => Promise<void>;
}

// Hot-reload scope per §16: policies dir, prices file, model_routes, mcp_servers.
// Ports/data_dir/storage require a restart; this watcher re-validates the whole
// file on every change but callers should ignore fields outside the hot-reload
// scope until a restart (documented limitation for M0).
export function watchConfig(explicitPath: string | undefined, logger: Logger): ConfigWatcherHandle {
  const path = resolveConfigPath(explicitPath);
  let current = loadConfig(path);

  const watcher: FSWatcher = chokidar.watch(path, { ignoreInitial: true });
  watcher.on("change", () => {
    try {
      const next = loadConfig(path);
      current = next;
      logger.info({ path }, "config reloaded");
    } catch (err) {
      // Keep last-good config; loud log + the caller surfaces a dashboard banner.
      const message = err instanceof ConfigError ? err.message : (err as Error).message;
      logger.error({ path, err: message }, "config reload failed; keeping last-good config");
    }
  });

  return {
    current: () => current,
    close: () => watcher.close(),
  };
}
