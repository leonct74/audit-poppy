import { describe, expect, it } from "vitest";
import { LISTING, CATALOG} from "./listing";
import { checkCopy } from "./naming";

/** Every string a buyer reads, flattened. */
const strings: [string, string][] = [
  ["name", LISTING.name],
  ["tagline", LISTING.tagline],
  ["publisher", LISTING.publisher],
  ["description", LISTING.description],
  ...LISTING.highlights.map((h, i) => [`highlight ${i}`, h] as [string, string]),
];

describe("the listing obeys the three laws", () => {
  it("never claims compliance or certification, and never says AWS where it means cloud", () => {
    for (const [where, text] of strings) {
      expect(checkCopy(text), `${where}: "${text}"`).toEqual([]);
    }
  });

  it("keeps SOC 2 in the tagline and out of the name (DESIGN §11.1)", () => {
    expect(LISTING.name).not.toMatch(/soc/i);
    expect(LISTING.tagline).toContain("SOC 2");
  });

  it("names no price anywhere — the pricing law keeps every amount in the commerce database", () => {
    for (const [where, text] of strings) {
      expect(text, where).not.toMatch(/[$€£]\s?\d|\d+\s?(usd|eur|gbp)\b/i);
    }
  });

  it("keeps the proper nouns that make the product findable and usable", () => {
    // §0a exempts proper nouns deliberately: renaming "AWS Config" makes the product unusable,
    // not neutral — and it is what a buyer searches for.
    expect(LISTING.description).toContain("AWS Config");
    expect(LISTING.description).toContain("AWS Security Hub");
  });

  it("points `repo` at a real repository — the directory's open-repo rule is not optional", () => {
    expect(LISTING.repo).toMatch(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/);
  });
});

describe("the catalog gate", () => {
  it("names a minHost, because an older host strands this poppy's stack on removal", () => {
    // Not cosmetic: on ≤0.3.19 the host's maintenance session cannot finish deleting the stack,
    // so removing from AgentsPoppy's own screen leaves the bucket, table, role and function
    // billing. The gate converts that into an update prompt. Raise it, never drop it.
    expect(LISTING.minHost).toMatch(/^\d+\.\d+\.\d+$/);
    const [major, minor, patch] = LISTING.minHost.split(".").map(Number);
    expect(major * 1_000_000 + minor * 1_000 + patch).toBeGreaterThanOrEqual(0 * 1_000_000 + 3 * 1_000 + 20);
  });
});

describe("the catalogue entry (what agentspoppy.com/poppies/auditpoppy renders)", () => {
  const strings = [
    CATALOG.categoryLabel,
    ...CATALOG.features.flatMap((f) => [f.title, f.description]),
  ];

  it("obeys the same three laws as the rest of the listing", () => {
    for (const text of strings) expect(checkCopy(text)).toEqual([]);
  });

  it("declares that nothing leaves the customer's cloud — the claim the page is built around", () => {
    expect(CATALOG.dataStaysInYourCloud).toBe(true);
  });

  it("offers every capability free and charges only for the unwatermarked export", () => {
    // A compliance tool that withholds your own evidence behind a paywall has lost its argument.
    const paid = CATALOG.features.filter((f) => f.tier === "paid");
    expect(paid).toHaveLength(1);
    expect(paid[0]?.title.toLowerCase()).toContain("export");
    expect(CATALOG.features.filter((f) => f.tier === "free").length).toBeGreaterThan(4);
  });
});
