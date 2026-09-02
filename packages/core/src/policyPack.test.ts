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
