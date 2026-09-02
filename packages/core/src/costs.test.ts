import { describe, expect, it } from "vitest";
import { APPROX_UNIT_PRICES, estimateMonthlyCosts, freeTrial } from "./costs";

describe("estimateMonthlyCosts", () => {
  it("prices from the account's actual shape and carries the source label", () => {
    const est = estimateMonthlyCosts(
      { resourceCount: 200, enabledControls: 80 },
      { configPerItem: 0.003, configPerRuleEvaluation: 0.001, securityHubPerCheck: 0.001, source: "live", currency: "USD" },
    );
    // config: 200*3*0.003 + 80*8*0.001 = 1.8 + 0.64 = 2.44; hub: 80*30*0.001 = 2.4
    expect(est.items.find((i) => i.service === "config")?.monthlyUsd).toBeCloseTo(2.44, 2);
    expect(est.items.find((i) => i.service === "securityhub")?.monthlyUsd).toBeCloseTo(2.4, 2);
    expect(est.source).toBe("live");
    expect(est.totalMonthlyUsd).toBeCloseTo(2.44 + 2.4 + 0.05, 2);
  });

  it("degrades honestly: the fallback is labelled approx", () => {
    const est = estimateMonthlyCosts({ resourceCount: 50, enabledControls: 40 }, APPROX_UNIT_PRICES);
    expect(est.source).toBe("approx");
    for (const item of est.items) expect(item.detail.length).toBeGreaterThan(10);
  });
});

describe("freeTrial (the founder's free-trial rule)", () => {
  it("computes the end date and days left", () => {
    const t = freeTrial("2026-09-02T10:12:00Z", new Date("2026-09-12T10:12:00Z"));
    expect(t?.endsOn).toBe("2026-10-02");
    expect(t?.daysLeft).toBe(20);
    expect(t?.expired).toBe(false);
  });

  it("reports expiry", () => {
    const t = freeTrial("2026-09-02T10:12:00Z", new Date("2026-10-03T00:00:00Z"));
    expect(t?.expired).toBe(true);
    expect(t?.daysLeft).toBe(0);
  });

  it("returns undefined for a malformed start", () => {
    expect(freeTrial("never", new Date())).toBeUndefined();
  });
});
