/**
 * Persistence for the enablement ledger — in the host-assigned dataDir, the
 * only writable place under confinement. The ledger is the teardown contract
 * (DESIGN §3): lose it and "disable exactly what we enabled" has no memory,
 * so writes are synchronous and before the AWS call they describe.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Ledger, parseLedger } from "@auditpoppy/core";

const FILE = "enablement-ledger.json";

export class LedgerStore {
  private readonly path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, FILE);
  }

  read(): Ledger {
    let raw: string | undefined;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch {
      raw = undefined; // absent (or unreadable) → empty ledger
    }
    return parseLedger(raw);
  }

  write(ledger: Ledger): void {
    writeFileSync(this.path, `${JSON.stringify(ledger, null, 2)}\n`);
  }
}
