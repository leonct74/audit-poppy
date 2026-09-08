import { describe, expect, it } from "vitest";
import { LISTING } from "./listing";
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
