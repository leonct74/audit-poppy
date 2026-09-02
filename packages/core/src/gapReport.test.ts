import { describe, expect, it } from "vitest";
import { buildGapReport, isWarmingUp } from "./gapReport";
import type { ControlState, RecorderState, StandardState } from "./types";

const recorder: RecorderState = { present: true, recording: true };

const control = (over: Partial<ControlState>): ControlState => ({
  controlId: "CIS.1.13",
  standard: "cis-1.2.0",
  title: "Ensure MFA is enabled for the root account",
  enabled: true,
  severity: "CRITICAL",
  compliance: "FAILED",
  ...over,
});

const ready: StandardState[] = [
  { standard: "cis-1.2.0", status: "READY" },
  { standard: "fsbp-1.0.0", status: "READY" },
];

describe("warming up (phase-0 finding 4: never a falsely clean report)", () => {
  it("is warming while any standard is PENDING or INCOMPLETE", () => {
    expect(isWarmingUp([{ standard: "cis-1.2.0", status: "PENDING" }])).toBe(true);
    expect(isWarmingUp([{ standard: "cis-1.2.0", status: "INCOMPLETE" }])).toBe(true);
    expect(isWarmingUp(ready)).toBe(false);
  });

  it("stamps the report even when zero controls came back", () => {
    const report = buildGapReport({
      accountId: "111122223333",
      region: "eu-west-1",
      standards: [{ standard: "cis-1.2.0", status: "PENDING" }],
      recorder,
      controls: [],
    });
    expect(report.warmingUp).toBe(true);
    expect(report.groups).toEqual([]);
  });
});

describe("buildGapReport", () => {
  it("groups mapped controls under their criteria with auditor prose", () => {
    const report = buildGapReport({
      accountId: "111122223333",
      region: "eu-west-1",
      standards: ready,
      recorder,
      controls: [
        control({}),
        control({ controlId: "CIS.2.1", title: "CloudTrail in all regions", compliance: "PASSED", severity: "HIGH" }),
      ],
    });
    const cc6 = report.groups.find((g) => g.tsc === "CC6");
    const cc7 = report.groups.find((g) => g.tsc === "CC7");
    expect(cc6?.controls.map((c) => c.controlId)).toContain("CIS.1.13");
    expect(cc7?.controls.map((c) => c.controlId)).toContain("CIS.2.1");
    expect(cc6?.controls[0]?.auditorNote).toBeTruthy();
    expect(cc6?.controls[0]?.fix).toBeTruthy();
  });

  it("keeps unknown controls visible, flagged unmapped", () => {
    const report = buildGapReport({
      accountId: "111122223333",
      region: "eu-west-1",
      standards: ready,
      recorder,
      controls: [control({ controlId: "XYZ.99", title: "A brand new AWS check" })],
    });
    expect(report.unmapped).toHaveLength(1);
    expect(report.unmapped[0]?.controlId).toBe("XYZ.99");
    expect(report.groups).toEqual([]);
  });

  it("counts totals and sorts failures first, by severity", () => {
    const report = buildGapReport({
      accountId: "111122223333",
      region: "eu-west-1",
      standards: ready,
      recorder,
      controls: [
        control({ controlId: "CIS.1.2", compliance: "PASSED", severity: "MEDIUM", title: "MFA for console users" }),
        control({ controlId: "CIS.1.4", compliance: "FAILED", severity: "MEDIUM", title: "Rotate keys" }),
        control({ controlId: "CIS.1.13", compliance: "FAILED", severity: "CRITICAL" }),
        control({ controlId: "CIS.1.3", compliance: "NO_DATA", severity: "LOW", title: "Unused creds" }),
        control({ controlId: "CIS.1.12", enabled: false, compliance: "NO_DATA", title: "Root access key" }),
      ],
    });
    expect(report.totals).toEqual({ passed: 1, failed: 2, warning: 0, noData: 1, disabled: 1 });
    const cc6 = report.groups.find((g) => g.tsc === "CC6");
    const order = cc6?.controls.map((c) => c.controlId);
    // FAILED CRITICAL, then FAILED MEDIUM, then NO_DATA, then PASSED.
    expect(order?.[0]).toBe("CIS.1.13");
    expect(order?.[1]).toBe("CIS.1.4");
    expect(order?.[order.length - 1]).toBe("CIS.1.2");
  });
});
