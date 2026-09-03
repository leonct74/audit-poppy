/**
 * The licensing copy, pinned where it actually bites: the FIRST tier is where
 * every evaluation starts — a 200-person prospect included — so it must never
 * again be named after the smallest user of it. (Founder review, 2026-09-03:
 * "Personal use & evaluation" read to an enterprise as either "not for us" or
 * "we are already in breach".)
 */
import { describe, expect, it } from "vitest";
import { EVALUATION_LINE, LICENSE_LINE, LICENSE_TIERS, WATERMARK_TEXT, exportsWatermarked } from "./licensing";
import { checkCopy } from "./naming";

describe("the licence ladder — three lines, and the first is for everyone", () => {
  const [everyone, small, business] = LICENSE_TIERS;

  it("names the free tier for EVERYONE, never 'personal'", () => {
    expect(everyone?.name.toLowerCase()).not.toContain("personal");
    expect(everyone?.name).toBe("Everyone");
    expect(everyone?.detail.toLowerCase()).toContain("any company size");
    expect(everyone?.exports).toBe("Watermarked");
  });

  it("states the whole model in one headline sentence", () => {
    const line = EVALUATION_LINE.toLowerCase();
    expect(line).toContain("full access for everyone");
    expect(line).toContain("watermark");
    expect(line).toContain("10");
  });

  it("keeps the two ways to take the watermark off distinct", () => {
    expect(small?.cost).toBe("Free");
    expect(small?.registration.toLowerCase()).toContain("sign up");
    expect(small?.exports).toBe("Clean");
    expect(business?.cost.toLowerCase()).toContain("subscription");
    expect(business?.exports).toBe("Clean");
  });

  it("states the USE-based rule as the small print", () => {
    expect(LICENSE_LINE).toContain("Business use requires a license");
    expect(LICENSE_LINE.toLowerCase()).toContain("auditor");
  });

  it("gates nothing but the watermark", () => {
    expect(exportsWatermarked(false)).toBe(true);
    expect(exportsWatermarked(true)).toBe(false);
    expect(WATERMARK_TEXT.toLowerCase()).toContain("not licensed for business use");
  });

  it("obeys the naming and pricing laws (no tier may carry a price)", () => {
    for (const tier of LICENSE_TIERS) {
      expect(checkCopy(`${tier.name} ${tier.cost} ${tier.registration} ${tier.detail}`), tier.id).toEqual([]);
    }
    expect(checkCopy(`${LICENSE_LINE} ${EVALUATION_LINE}`)).toEqual([]);
  });
});
