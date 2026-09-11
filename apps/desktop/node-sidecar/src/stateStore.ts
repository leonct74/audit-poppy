/**
 * Small persisted state: the customer's policy answers, auditor notes, and the
 * moment we enabled Security Hub (the free-trial clock). Primary copy in the
 * host-assigned dataDir; scan history is additionally recorded in the stack's
 * assessments table once it exists, so the cloud holds the audit trail of runs
 * (DESIGN §3) — best-effort, never blocking the UI on DynamoDB.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import type { GapReport } from "@auditpoppy/core";
import type { Clients } from "./clients";
import { TABLE_NAME } from "./template";

export interface SidecarState {
  schemaVersion: 1;
  /** Per-policy customer answers: { [policyId]: { [fieldId]: value } }. */
  policyAnswers: Record<string, Record<string, string>>;
  /** Customer notes for the auditor export. */
  notes: string[];
  /** ISO time WE enabled Security Hub — the free-trial clock (DESIGN §7). */
  securityHubEnabledAt?: string;
}

const FILE = "state.json";

export class StateStore {
  private readonly path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, FILE);
  }

  read(): SidecarState {
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as Partial<SidecarState>;
      if (raw?.schemaVersion === 1) {
        return {
          schemaVersion: 1,
          policyAnswers: raw.policyAnswers && typeof raw.policyAnswers === "object" ? raw.policyAnswers : {},
          notes: Array.isArray(raw.notes) ? raw.notes.filter((n): n is string => typeof n === "string") : [],
          securityHubEnabledAt: typeof raw.securityHubEnabledAt === "string" ? raw.securityHubEnabledAt : undefined,
        };
      }
    } catch {
      /* absent or malformed → fresh state */
    }
    return { schemaVersion: 1, policyAnswers: {}, notes: [] };
  }

  write(state: SidecarState): void {
    writeFileSync(this.path, `${JSON.stringify(state, null, 2)}\n`);
  }

  update(fn: (state: SidecarState) => void): SidecarState {
    const state = this.read();
    fn(state);
    this.write(state);
    return state;
  }
}

/** Record a scan's summary in the assessments table — best-effort. */
export async function recordScan(clients: Clients, report: GapReport): Promise<boolean> {
  try {
    await clients.dynamodb.send(
      new PutItemCommand({
        TableName: TABLE_NAME,
        Item: {
          pk: { S: "scan" },
          sk: { S: report.generatedAt },
          totals: { S: JSON.stringify(report.totals) },
          warmingUp: { BOOL: report.warmingUp },
          mappingVersion: { S: report.mappingVersion },
        },
      }),
    );
    return true;
  } catch {
    return false; // table not deployed yet, or offline — the UI shows live state anyway
  }
}
