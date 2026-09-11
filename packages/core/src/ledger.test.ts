import { describe, expect, it } from "vitest";
import { emptyLedger, entryFor, parseLedger, recordService, servicesToDisable } from "./ledger";

const now = new Date("2026-09-02T10:00:00Z");

describe("the enablement ledger (found enabled, not ours)", () => {
  it("records first observation and never overwrites it", () => {
    let ledger = emptyLedger();
    ledger = recordService(ledger, "securityhub", false, now);
    // A later (buggy) attempt to re-record as pre-existing must not flip it.
    ledger = recordService(ledger, "securityhub", true, now);
    expect(entryFor(ledger, "securityhub")?.preExisting).toBe(false);
    expect(ledger.entries).toHaveLength(1);
  });

  it("teardown disables only what is OURS", () => {
    let ledger = emptyLedger();
    ledger = recordService(ledger, "config-recorder", true, now); // found enabled — not ours
    ledger = recordService(ledger, "securityhub", false, now);
    ledger = recordService(ledger, "securityhub-standard:cis-1.2.0", false, now);
    expect(servicesToDisable(ledger)).toEqual(["securityhub", "securityhub-standard:cis-1.2.0"]);
  });

  it("an unrecorded service is never disabled", () => {
    expect(servicesToDisable(emptyLedger())).toEqual([]);
  });

  it("round-trips through JSON and survives garbage", () => {
    let ledger = emptyLedger();
    ledger = recordService(ledger, "config-slr", false, now);
    expect(parseLedger(JSON.stringify(ledger))).toEqual(ledger);
    expect(parseLedger("not json")).toEqual(emptyLedger());
    expect(parseLedger(undefined)).toEqual(emptyLedger());
    expect(parseLedger('{"schemaVersion":1,"entries":[{"bad":true}]}').entries).toEqual([]);
  });
});
