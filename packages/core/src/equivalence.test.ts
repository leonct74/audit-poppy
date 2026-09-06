import { describe, expect, it } from "vitest";
import { CIS_EQUIVALENTS, UNPAIRED_NOTES, inheritFindings } from "./equivalence";
import { MAPPING } from "./mapping";

const control = (controlId: string, compliance: string, extra: Record<string, unknown> = {}) => ({
  controlId,
  compliance,
  ...extra,
});

describe("filling CIS controls from the security control that carries their finding", () => {
  it("copies a one-to-one result, and the resources it names", () => {
    // The live symptom (2026-09-06): CIS.1.12 blank while IAM.4 — the same check — had FAILED.
    const out = inheritFindings([
      control("CIS.1.12", "NO_DATA"),
      control("IAM.4", "FAILED", { failedResources: ["root"] }),
    ]);
    const cis = out.find((c) => c.controlId === "CIS.1.12");
    expect(cis?.compliance).toBe("FAILED");
    expect(cis?.failedResources).toEqual(["root"]);
    expect(cis?.derivedFrom).toBe("IAM.4");
  });

  it("never overwrites a control that has a result of its own", () => {
    const out = inheritFindings([
      control("CIS.1.12", "PASSED"),
      control("IAM.4", "FAILED", { failedResources: ["root"] }),
    ]);
    const cis = out.find((c) => c.controlId === "CIS.1.12");
    expect(cis?.compliance).toBe("PASSED");
    expect(cis?.derivedFrom).toBeUndefined();
  });

  it("infers a PASS across a shared control, because a pass there means every rule passed", () => {
    const out = inheritFindings([control("CIS.1.9", "NO_DATA"), control("IAM.7", "PASSED")]);
    expect(out.find((c) => c.controlId === "CIS.1.9")?.compliance).toBe("PASSED");
  });

  it("REFUSES to assert a specific failure it cannot attribute", () => {
    // IAM.7 failing means the password policy is weak — not that the minimum-length rule in
    // particular failed. Claiming CIS.1.9 FAILED would put a false specific finding in a
    // document an auditor reads. A warning says what is true: something here is wrong.
    const out = inheritFindings([
      control("CIS.1.5", "NO_DATA"),
      control("CIS.1.9", "NO_DATA"),
      control("IAM.7", "FAILED", { failedResources: ["policy"] }),
    ]);
    for (const id of ["CIS.1.5", "CIS.1.9"]) {
      const c = out.find((x) => x.controlId === id);
      expect(c?.compliance).toBe("WARNING");
      expect(c?.derivedFrom).toBe("IAM.7");
      expect(c?.failedResources).toBeUndefined();
    }
  });

  it("leaves a control alone when its pair has no result either", () => {
    const out = inheritFindings([control("CIS.1.12", "NO_DATA"), control("IAM.4", "NO_DATA")]);
    expect(out.find((c) => c.controlId === "CIS.1.12")?.compliance).toBe("NO_DATA");
  });

  it("leaves an unpaired control honestly empty rather than guessing", () => {
    const out = inheritFindings([control("CIS.3.1", "NO_DATA"), control("IAM.4", "FAILED")]);
    expect(out.find((c) => c.controlId === "CIS.3.1")?.compliance).toBe("NO_DATA");
  });
});

describe("the equivalence table itself", () => {
  it("pairs only CIS controls the mapping table actually carries", () => {
    const known = new Set(MAPPING.filter((m) => m.standard === "cis-1.2.0").map((m) => m.checkId));
    for (const e of CIS_EQUIVALENTS) {
      expect(known.has(e.cis), `${e.cis} is paired but not in the mapping table`).toBe(true);
    }
  });

  it("points only at security controls the mapping table carries — a pair to nothing is a blank", () => {
    const known = new Set(MAPPING.filter((m) => m.standard === "fsbp-1.0.0").map((m) => m.checkId));
    for (const e of CIS_EQUIVALENTS) {
      expect(known.has(e.securityControl), `${e.cis} → ${e.securityControl}, which is not mapped`).toBe(true);
    }
  });

  it("never pairs one CIS control twice", () => {
    const ids = CIS_EQUIVALENTS.map((e) => e.cis);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("marks every many-to-one pairing as shared, so no failure gets misattributed", () => {
    const counts = new Map<string, string[]>();
    for (const e of CIS_EQUIVALENTS) {
      counts.set(e.securityControl, [...(counts.get(e.securityControl) ?? []), e.cis]);
    }
    for (const [securityControl, cisIds] of counts) {
      if (cisIds.length < 2) continue;
      for (const cis of cisIds) {
        const e = CIS_EQUIVALENTS.find((x) => x.cis === cis);
        expect(e?.shared, `${cis} shares ${securityControl} with others but is not marked shared`).toBe(true);
      }
    }
  });

  it("accounts for every CIS control: paired, or explained as deliberately unpaired", () => {
    // The point is that nobody can quietly forget one. A control is either joined to its
    // security control or it has a written reason why not.
    const paired = new Set(CIS_EQUIVALENTS.map((e) => e.cis));
    const unexplained = MAPPING.filter((m) => m.standard === "cis-1.2.0")
      .map((m) => m.checkId)
      .filter((id) => !paired.has(id) && !UNPAIRED_NOTES[id] && !id.startsWith("CIS.3."));
    expect(unexplained).toEqual([]);
  });
});
