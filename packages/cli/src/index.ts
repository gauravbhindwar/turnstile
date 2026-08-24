#!/usr/bin/env node
import { writeFileSync, existsSync } from "node:fs";

const EXAMPLE_CONFIG = `server:
  port: 8787
  forward_proxy_port: 8888
  host: 127.0.0.1
data_dir: ./turnstile-data
admin:
  token: \${TURNSTILE_ADMIN_TOKEN}
upstreams:
  - name: openai
    kind: openai_compat
    base_url: https://api.openai.com/v1
    credential_env: OPENAI_API_KEY
model_routes:
  - { match: "gpt-*", upstream: openai }
policies_dir: ./policies
plugins_dir: ./plugins
`;

const [, , command] = process.argv;

function printUsage(): void {
  console.log(`turnstile <command>

Commands:
  init            Write a starter turnstile.yaml in the current directory
  start           Start the gateway (delegates to @turnstile/gateway)
  keys            Manage agent keys (Milestone 1)
  verify-ledger   Verify the ledger hash chain (Milestone 1)
`);
}

async function main(): Promise<void> {
  switch (command) {
    case "init": {
      const path = "./turnstile.yaml";
      if (existsSync(path)) {
        console.error(`${path} already exists; refusing to overwrite.`);
        process.exit(1);
      }
      writeFileSync(path, EXAMPLE_CONFIG, "utf8");
      console.log(`Wrote ${path}. Set TURNSTILE_ADMIN_TOKEN and run "turnstile start".`);
      break;
    }
    case "start": {
      await import("@turnstile/gateway");
      break;
    }
    case "keys":
    case "verify-ledger": {
      console.error(`"${command}" ships in Milestone 1 (see AGENT_GATEWAY_SPEC.md §24).`);
      process.exit(1);
      break;
    }
    default: {
      printUsage();
      process.exit(command ? 1 : 0);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
