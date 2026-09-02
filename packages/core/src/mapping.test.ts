import { describe, expect, it } from "vitest";
import { MAPPING, MAPPING_VERSION, TSC_META, findMapping } from "./mapping";
import { checkCopy } from "./naming";

/** The complete Security Hub CIS v1.2.0 control set — pinned so a table edit
 *  can't silently drop a control. (Security Hub supports this 43-control
 *  subset of the benchmark; the sidecar's live sync check guards drift the
 *  other way — AWS adding/renaming.) */
const CIS_CONTROLS = [
  "CIS.1.1", "CIS.1.2", "CIS.1.3", "CIS.1.4", "CIS.1.5", "CIS.1.6", "CIS.1.7", "CIS.1.8",
  "CIS.1.9", "CIS.1.10", "CIS.1.11", "CIS.1.12", "CIS.1.13", "CIS.1.14", "CIS.1.16",
  "CIS.1.20", "CIS.1.22",
  "CIS.2.1", "CIS.2.2", "CIS.2.3", "CIS.2.4", "CIS.2.5", "CIS.2.6", "CIS.2.7", "CIS.2.8", "CIS.2.9",
  "CIS.3.1", "CIS.3.2", "CIS.3.3", "CIS.3.4", "CIS.3.5", "CIS.3.6", "CIS.3.7", "CIS.3.8",
  "CIS.3.9", "CIS.3.10", "CIS.3.11", "CIS.3.12", "CIS.3.13", "CIS.3.14",
  "CIS.4.1", "CIS.4.2", "CIS.4.3",
];

describe("the TSC mapping table", () => {
  it("has a calendar version", () => {
    expect(MAPPING_VERSION).toMatch(/^\d{4}\.\d{2}\.\d+$/);
  });

  it("maps every check exactly once per standard", () => {
    const keys = MAPPING.map((m) => `${m.standard}:${m.checkId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers the full Security Hub CIS 1.2.0 control set", () => {
    const cis = MAPPING.filter((m) => m.standard === "cis-1.2.0").map((m) => m.checkId);
    expect(cis.sort()).toEqual([...CIS_CONTROLS].sort());
  });

  it("gives every entry real auditor prose, a fix, and valid criteria", () => {
    for (const m of MAPPING) {
      expect(m.auditorNote.length, m.checkId).toBeGreaterThan(30);
      expect(m.fix.length, m.checkId).toBeGreaterThan(15);
      expect(m.tsc.length, m.checkId).toBeGreaterThan(0);
      for (const t of m.tsc) expect(TSC_META[t], `${m.checkId} → ${t}`).toBeDefined();
    }
  });

  it("keeps the naming law in every note and fix", () => {
    for (const m of MAPPING) {
      expect(checkCopy(m.auditorNote), m.checkId).toEqual([]);
      expect(checkCopy(m.fix), m.checkId).toEqual([]);
    }
  });

  it("looks up by standard + id", () => {
    expect(findMapping("cis-1.2.0", "CIS.1.13")?.tsc).toContain("CC6");
    expect(findMapping("fsbp-1.0.0", "Config.1")?.tsc).toContain("CC8");
    expect(findMapping("fsbp-1.0.0", "NOPE.1")).toBeUndefined();
  });
});
