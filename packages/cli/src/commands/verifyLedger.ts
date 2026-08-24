import { join } from "node:path";
import { loadConfig, SqliteStorage, verifyLedger, loadOrCreateCheckpointKeypair } from "@turnstile/core";

function dbPathFor(dataDir: string): string {
  return dataDir === ":memory:" ? ":memory:" : join(dataDir, "turnstile.db");
}

export async function verifyLedgerCommand(args: string[]): Promise<void> {
  const fromFlag = args.indexOf("--from");
  const toFlag = args.indexOf("--to");
  const from = fromFlag !== -1 ? Number(args[fromFlag + 1]) : undefined;
  const to = toFlag !== -1 ? Number(args[toFlag + 1]) : undefined;

  const config = loadConfig();
  const storage = new SqliteStorage(dbPathFor(config.data_dir));
  await storage.init();

  try {
    const keypair = loadOrCreateCheckpointKeypair(config.data_dir);
    const startedAt = Date.now();
    const result = await verifyLedger(storage, { from, to, publicKeyPem: keypair.publicKeyPem });
    const elapsedMs = Date.now() - startedAt;

    console.log(`Checked ${result.rowsChecked} rows (${result.checkpointsVerified} checkpoints) in ${elapsedMs}ms.`);
    if (result.headSeq !== null) {
      console.log(`Head: seq=${result.headSeq} chainHash=${result.headChainHash}`);
    }

    if (result.ok) {
      console.log("OK — ledger verifies.");
    } else {
      console.error(`FAILED at seq=${result.firstDivergence!.seq}: ${result.firstDivergence!.reason}`);
      process.exitCode = 1;
    }
  } finally {
    await storage.close();
  }
}
