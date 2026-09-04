import { describe, expect, it } from "vitest";
import { APPROX_UNIT_PRICES, estimateMonthlyCosts, freeTrial, type UnitPrices } from "./costs";

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

  it("charges the up-front sweep from the LIVE rate and the account's real size", () => {
    // The whole point of the line: it must move when either input moves. A figure that stayed
    // put while prices or the account changed would be a hardcoded number wearing a disguise.
    const live: UnitPrices = { ...APPROX_UNIT_PRICES, configPerItem: 0.006, source: "live" };
    const small = estimateMonthlyCosts({ resourceCount: 100, enabledControls: 40 }, live);
    const big = estimateMonthlyCosts({ resourceCount: 1000, enabledControls: 40 }, live);

    expect(small.initialUsd).toBeCloseTo(100 * 0.006, 2);
    expect(big.initialUsd).toBeCloseTo(1000 * 0.006, 2);
    // Halve the live rate and the figure halves too.
    const cheaper = estimateMonthlyCosts({ resourceCount: 100, enabledControls: 40 }, { ...live, configPerItem: 0.003 });
    expect(cheaper.initialUsd).toBeCloseTo(small.initialUsd / 2, 2);
  });

  it("carries the source through, so an approximate figure can never render as live", () => {
    const approx = estimateMonthlyCosts({ resourceCount: 100, enabledControls: 40 }, APPROX_UNIT_PRICES);
    expect(approx.source).toBe("approx");
    const live = estimateMonthlyCosts({ resourceCount: 100, enabledControls: 40 }, { ...APPROX_UNIT_PRICES, source: "live" });
    expect(live.source).toBe("live");
  });

  it("is what a short test actually costs — the number the monthly figure hides", () => {
    // A few minutes of running still pays the whole initial sweep; only the monthly part is
    // avoided by turning it off. If these two were ever the same number the screen would be
    // saying nothing.
    const e = estimateMonthlyCosts({ resourceCount: 500, enabledControls: 79 }, APPROX_UNIT_PRICES);
    expect(e.initialUsd).toBeGreaterThan(0);
    expect(e.initialUsd).not.toBeCloseTo(e.totalMonthlyUsd, 2);
  });
});
