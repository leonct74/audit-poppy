/**
 * The tab bar, pinned — because two of its rules are load-bearing and neither is obvious from
 * reading App.tsx.
 *
 * "Feedback is the LAST tab" is a LISTING requirement (AGENTS.md §9a): a poppy without it, or
 * with it out of place, is not listable. Nothing enforced that until a Remove tab was inserted
 * right next to it on 2026-09-10 — an edit one character away from making the poppy unlistable,
 * with nothing to catch it.
 *
 * Reading the source rather than importing App: the tab list is a const in a module that pulls
 * in the whole view tree, and this needs to hold whatever those views import.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const tabs = (source.match(/const TABS = \[(.*?)\] as const;/s)?.[1] ?? "")
  .split(",")
  .map((t) => t.trim().replace(/^"|"$/g, ""))
  .filter(Boolean);

describe("the tab bar", () => {
  it("was found at all — the rest of this file is worthless if the regex silently missed", () => {
    expect(tabs.length).toBeGreaterThan(3);
  });

  it("ends with Feedback, which is a listing requirement and not a preference", () => {
    expect(tabs[tabs.length - 1]).toBe("Feedback");
  });

  it("offers a findable way out", () => {
    // Removal lived at the bottom of Costs, and the founder — who specified that placement —
    // looked for it and failed twice. A destructive action nobody can find is not tucked away
    // safely: the person hunting for it has already decided, and what they do instead is worse.
    expect(tabs).toContain("Remove");
  });

  it("opens on Readiness, so the first screen is the one that starts the work", () => {
    expect(/useState<Tab>\("Readiness"\)/.test(source)).toBe(true);
  });
});
