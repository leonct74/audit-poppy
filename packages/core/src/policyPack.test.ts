import { describe, expect, it } from "vitest";
import { checkCopy } from "./naming";
import { POLICY_TEMPLATES, observedValues, renderPolicy } from "./policyPack";
import type { ObservedPosture } from "./types";

const posture: ObservedPosture = {
  accountId: "111122223333",
  region: "eu-west-1",
  iamUserCount: 7,
  usersWithoutMfa: 2,
  passwordPolicy: { present: true, minimumLength: 14, requireSymbols: true, maxAgeDays: 90 },
  cloudTrailEnabled: true,
  multiRegionTrail: true,
  observedAt: "2026-09-02T10:00:00Z",
};

describe("the policy pack", () => {
  it("ships the five auditor-required policies", () => {
    expect(POLICY_TEMPLATES.map((t) => t.id).sort()).toEqual([
      "access-control",
      "change-management",
      "data-retention",
      "incident-response",
      "vendor-management",
    ]);
  });

  it("every placeholder resolves — no {{token}} survives rendering", () => {
    for (const template of POLICY_TEMPLATES) {
      const rendered = renderPolicy(template, posture, { companyName: "Acme Ltd" });
      for (const section of rendered.sections) {
        expect(section.body, `${template.id} / ${section.heading}`).not.toMatch(/\{\{|\[\w+\]/);
      }
    }
  });

  it("keeps the registers distinct and marks observed facts as observed", () => {
    const rendered = renderPolicy(POLICY_TEMPLATES[0]!, posture, { companyName: "Acme Ltd" });
    const observed = rendered.fields.filter((f) => f.register === "platform-observed");
    const entered = rendered.fields.filter((f) => f.register === "customer-entered");
    expect(observed.length).toBeGreaterThan(0);
    expect(entered.length).toBeGreaterThan(0);
    expect(observed.find((f) => f.id === "iamUserCount")?.value).toBe("7");
  });

  it("carries the guidance-not-legal-advice framing and the naming law", () => {
    for (const template of POLICY_TEMPLATES) {
      const rendered = renderPolicy(template, posture, {});
      expect(rendered.disclaimer).toContain("not legal advice");
      const all = rendered.sections.map((s) => `${s.heading}\n${s.body}`).join("\n");
      expect(checkCopy(all), template.id).toEqual([]);
    }
  });

  it("describes an absent password policy honestly", () => {
    const values = observedValues({ ...posture, passwordPolicy: { present: false } });
    expect(values.passwordPolicySummary).toContain("no account password policy");
  });
});

describe("a fact we could not observe changes the sentence — it never appears inside one", () => {
  const access = POLICY_TEMPLATES.find((t) => t.id === "access-control")!;
  const mfaSection = (posture: ObservedPosture): string =>
    renderPolicy(access, posture, {}).sections.find((s) => s.heading.toLowerCase().includes("multi") || s.body.includes("Multi-factor"))!.body;

  const base = { accountId: "111122223333", region: "eu-west-1", observedAt: "2026-09-07T00:00:00.000Z" };

  it("states both numbers when the whole scan succeeded", () => {
    const body = mfaSection({ ...base, iamUserCount: 11, usersWithoutMfa: 1 });
    expect(body).toContain("11 user accounts, of which 1 lack MFA.");
    expect(body).not.toContain("not yet observed");
  });

  it("NEVER writes 'not yet observed' into a sentence — the live 2026-09-07 bug", () => {
    // 11 users listed, then the per-user MFA read failed: the document said
    // "11 user accounts, of which not yet observed lack MFA" — in a file destined for an auditor.
    const body = mfaSection({ ...base, iamUserCount: 11, mfaScanProblem: "Multi-factor authentication could only be checked for 0 of 11 accounts." });
    expect(body).toContain("11 user accounts.");
    expect(body).not.toMatch(/of which/);
    expect(body).not.toContain("not yet observed");
    // and it SAYS so, rather than quietly omitting a control an auditor will ask about
    expect(body).toContain("could only be checked for 0 of 11");
  });

  it("calls a partial scan a floor, never a total", () => {
    // "1 lack MFA" and "at least 1 of the 9 we could check" are different claims. Only one is
    // true here, and it is the weaker one — the same discipline as inheritFindings refusing to
    // assert a specific failure it cannot attribute.
    const body = mfaSection({ ...base, iamUserCount: 11, usersWithoutMfa: 1, mfaUsersChecked: 9 });
    expect(body).toContain("at least 1 lack MFA");
    expect(body).toContain("covers the 9 accounts we could check");
  });

  it("drops the whole clause when even the user list could not be read", () => {
    const body = mfaSection({ ...base, mfaScanProblem: "The list of user accounts could not be read (access denied)." });
    expect(body).not.toContain("user accounts,");
    expect(body).toContain("could not be read");
    expect(body).toContain("The account password policy:");
  });

  it("still shows 'not yet observed' on the CHIP, where it reads correctly", () => {
    const rendered = renderPolicy(access, { ...base, iamUserCount: 11 }, {});
    expect(rendered.fields.find((f) => f.id === "usersWithoutMfa")?.value).toBe("not yet observed");
    expect(rendered.fields.find((f) => f.id === "iamUserCount")?.value).toBe("11");
  });

  it("treats a customer answer as text, never as a replacement pattern", () => {
    const body = renderPolicy(access, base, { companyName: "$& Ltd" }).sections[0]!.body;
    expect(body).toContain("$& Ltd");
    expect(body).not.toContain("{{companyName}}");
  });
});
