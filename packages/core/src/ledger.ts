/**
 * The enablement ledger (DESIGN §3): Config and Security Hub are account-level
 * services, not stack resources, so the poppy records exactly what IT enabled —
 * and what it found already on ("found enabled, not ours"). Teardown may only
 * disable the former; the latter is untouchable, always.
 *
 * Pure logic + (de)serialization; the sidecar persists this in its dataDir.
 */
import type { LedgerEntry, LedgerService } from "./types";

export interface Ledger {
  schemaVersion: 1;
  entries: LedgerEntry[];
}

export function emptyLedger(): Ledger {
  return { schemaVersion: 1, entries: [] };
}

/** Record a service state exactly once — first observation wins. */
export function recordService(ledger: Ledger, service: LedgerService, preExisting: boolean, now: Date): Ledger {
  if (ledger.entries.some((e) => e.service === service)) return ledger;
  return {
    ...ledger,
    entries: [...ledger.entries, { service, at: now.toISOString(), preExisting }],
  };
}

export function entryFor(ledger: Ledger, service: LedgerService): LedgerEntry | undefined {
  return ledger.entries.find((e) => e.service === service);
}

/**
 * What teardown may disable: only services the ledger shows AS OURS. Anything
 * pre-existing — or never recorded at all — is left exactly as found.
 */
export function servicesToDisable(ledger: Ledger): LedgerService[] {
  return ledger.entries.filter((e) => !e.preExisting).map((e) => e.service);
}

/** Parse a persisted ledger; malformed/absent input yields an empty ledger. */
export function parseLedger(json: string | undefined | null): Ledger {
  if (!json) return emptyLedger();
  try {
    const raw = JSON.parse(json) as Partial<Ledger>;
    if (raw?.schemaVersion !== 1 || !Array.isArray(raw.entries)) return emptyLedger();
    const entries = raw.entries.filter(
      (e): e is LedgerEntry =>
        !!e && typeof e === "object" && typeof (e as LedgerEntry).service === "string" &&
        typeof (e as LedgerEntry).at === "string" && typeof (e as LedgerEntry).preExisting === "boolean",
    );
    return { schemaVersion: 1, entries };
  } catch {
    return emptyLedger();
  }
}
