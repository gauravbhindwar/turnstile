import { join } from "node:path";
import { loadConfig, SqliteStorage, uuidv7, generateAgentKey } from "@turnstile/core";

// Mirrors @turnstile/gateway's bootstrap.ts db path convention
// (data_dir/turnstile.db) — duplicated here rather than imported so the CLI
// doesn't need to boot the whole gateway just to touch storage.
function dbPathFor(dataDir: string): string {
  return dataDir === ":memory:" ? ":memory:" : join(dataDir, "turnstile.db");
}

export async function keysCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  const config = loadConfig();
  const storage = new SqliteStorage(dbPathFor(config.data_dir));
  await storage.init();

  try {
    switch (sub) {
      case "create": {
        const agentName = rest[0];
        if (!agentName) {
          console.error("Usage: turnstile keys create <agent-name> [--workspace <name>]");
          process.exitCode = 1;
          return;
        }
        const workspaceFlagIndex = rest.indexOf("--workspace");
        const workspaceName = workspaceFlagIndex !== -1 ? rest[workspaceFlagIndex + 1] : "default";
        if (!workspaceName) {
          console.error("--workspace requires a value");
          process.exitCode = 1;
          return;
        }

        let workspace = storage.workspaces.getByName(workspaceName);
        if (!workspace) {
          workspace = { id: uuidv7(), name: workspaceName, createdAt: new Date().toISOString() };
          storage.workspaces.create(workspace);
        }

        let agent = storage.agents.getByName(workspace.id, agentName);
        if (!agent) {
          agent = { id: uuidv7(), workspaceId: workspace.id, name: agentName, createdAt: new Date().toISOString(), disabled: false };
          storage.agents.create(agent);
        }

        const generated = generateAgentKey();
        storage.agentKeys.create({
          id: uuidv7(),
          agentId: agent.id,
          keyHash: generated.hash,
          prefix: generated.prefix,
          createdAt: new Date().toISOString(),
          revokedAt: null,
          lastUsedAt: null,
        });

        console.log(`Agent "${agentName}" ready in workspace "${workspaceName}".`);
        console.log("");
        console.log(`  ${generated.raw}`);
        console.log("");
        console.log("This key is shown once — save it now. Use it as: Authorization: Bearer <key>");
        break;
      }
      case "revoke": {
        const keyId = rest[0];
        if (!keyId) {
          console.error("Usage: turnstile keys revoke <key-id>");
          process.exitCode = 1;
          return;
        }
        storage.agentKeys.revoke(keyId);
        console.log(`Key ${keyId} revoked.`);
        break;
      }
      case "list": {
        const agentName = rest[0];
        if (!agentName) {
          console.error("Usage: turnstile keys list <agent-name> [--workspace <name>]");
          process.exitCode = 1;
          return;
        }
        const workspaceFlagIndex = rest.indexOf("--workspace");
        const workspaceName = (workspaceFlagIndex !== -1 ? rest[workspaceFlagIndex + 1] : "default") ?? "default";
        const workspace = storage.workspaces.getByName(workspaceName);
        const agent = workspace ? storage.agents.getByName(workspace.id, agentName) : null;
        if (!agent) {
          console.error(`No agent "${agentName}" in workspace "${workspaceName}"`);
          process.exitCode = 1;
          return;
        }
        for (const key of storage.agentKeys.listForAgent(agent.id)) {
          console.log(`${key.prefix}...  created=${key.createdAt}  revoked=${key.revokedAt ?? "no"}  lastUsed=${key.lastUsedAt ?? "never"}`);
        }
        break;
      }
      default: {
        console.log(`turnstile keys <create|revoke|list>

  keys create <agent-name> [--workspace <name>]   Create an agent (if needed) + a new key
  keys revoke <key-id>                            Revoke a key
  keys list <agent-name> [--workspace <name>]     List an agent's keys (hashes never shown)
`);
        process.exitCode = sub ? 1 : 0;
      }
    }
  } finally {
    await storage.close();
  }
}
