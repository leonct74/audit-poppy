/**
 * The licensing copy, pinned where it actually bites: the FIRST tier is where
 * every evaluation starts — a 200-person prospect included — so it must never
 * again be named after the smallest user of it. (Founder review, 2026-09-03:
 * "Personal use & evaluation" read to an enterprise as either "not for us" or
 * "we are already in breach".)
 */
import { describe, expect, it } from "vitest";
import {
  accountEntitlementUrl,
  BUSINESS_PRODUCT_ID,
  EVALUATION_LINE,
  LICENSE_LINE,
  LICENSE_TIERS,
  POPPY_ID,
  registrationUrlFor,
  SMALL_COMPANY_REGISTRATION_URL,
  WATERMARK_TEXT,
  exportsWatermarked,
} from "./licensing";
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
    // And it must NOT call its reader a hobbyist. The free row is where a 500-person
    // evaluation starts; "personal use" on their evidence says the product is not for them —
    // the same mistake the tier names were renamed to avoid.
    expect(WATERMARK_TEXT.toLowerCase()).not.toContain("personal");
  });

  it("obeys the naming and pricing laws (no tier may carry a price)", () => {
    for (const tier of LICENSE_TIERS) {
      expect(checkCopy(`${tier.name} ${tier.cost} ${tier.registration} ${tier.detail}`), tier.id).toEqual([]);
    }
    expect(checkCopy(`${LICENSE_LINE} ${EVALUATION_LINE}`)).toEqual([]);
  });
});

describe("where a licence lives — the reinstall answer", () => {
  it("checks the CLOUD ACCOUNT, not the install, so a reinstall keeps the licence", () => {
    const url = new URL(accountEntitlementUrl("111122223333"));
    expect(url.origin).toBe("https://agentspoppy.com");
    expect(url.pathname).toBe("/api/entitlement");
    // `target` is the platform's cross-install key — a buyerId here would be the bug.
    expect(url.searchParams.get("target")).toBe("111122223333");
    expect(url.searchParams.get("buyerId")).toBeNull();
    expect(url.searchParams.get("productId")).toBe(BUSINESS_PRODUCT_ID);
    expect(url.searchParams.get("poppyId")).toBe(POPPY_ID);
  });

  it("prefills the signup with the account, so nobody retypes an id", () => {
    expect(registrationUrlFor("111122223333")).toBe(`${SMALL_COMPANY_REGISTRATION_URL}?account=111122223333`);
    expect(registrationUrlFor(null)).toBe(SMALL_COMPANY_REGISTRATION_URL);
  });
});
