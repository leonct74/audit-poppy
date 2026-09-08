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
    expect(body).toContain("11 user accounts, of which 1 lacks MFA.");
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
    expect(body).toContain("at least 1 lacks MFA");
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

describe("an account we are not PERMITTED to read is an exclusion, not a fault", () => {
  const access = POLICY_TEMPLATES.find((t) => t.id === "access-control")!;
  const base = { accountId: "111122223333", region: "eu-west-1", observedAt: "2026-09-08T00:00:00.000Z" };
  const mfa = (p: ObservedPosture): string =>
    renderPolicy(access, p, {}).sections.find((s) => s.body.includes("Multi-factor"))!.body;

  it("states the count exactly and explains the account it could not read", () => {
    // The live shape on 2026-09-08: 11 users, 10 readable, the 11th is AgentsPoppy's own
    // operator identity, denied by the platform's CannotTamperWithAgentsPoppy guardrail.
    const body = mfa({ ...base, iamUserCount: 11, usersWithoutMfa: 1, mfaUsersExcluded: 1 });
    expect(body).toContain("11 user accounts, of which 1 lacks MFA.");
    expect(body).toContain("not permitted to read it");
    // An exclusion is NOT a fault: no "could not be checked" alarm, and no floor language.
    expect(body).not.toContain("could not be checked");
    expect(body).not.toContain("at least");
  });

  it("keeps 'could not be checked' for an actual fault", () => {
    const body = mfa({ ...base, iamUserCount: 11, usersWithoutMfa: 1, mfaUsersChecked: 9, mfaScanProblem: "Multi-factor authentication could not be checked for 2 of 11 accounts. Your cloud provider limited how fast we could check each account — opening this tab again usually clears it." });
    expect(body).toContain("at least 1 lacks MFA");
    expect(body).toContain("could not be checked for 2 of 11");
  });

  it("NEVER lets an identifier into the document, whatever upstream hands it", () => {
    // The 2026-09-08 leak: the provider's own denial message carried an account id, a role ARN,
    // a session id and a console link, and it was being rendered into the policy body. Upstream
    // now classifies instead of passing it through; this proves the last line of defence too.
    const body = mfa({
      ...base,
      iamUserCount: 11,
      mfaScanProblem:
        "User: arn:aws:sts::111122223333:assumed-role/AgentsPoppyBroker/agentspoppy-b1df195f is not authorized. Go to https://console.aws.amazon.com/iam/home#/authorization-details/5arhuwacg4o48yxyin4kcrony",
    });
    expect(body).not.toContain("arn:aws");
    expect(body).not.toContain("111122223333");
    expect(body).not.toContain("console.aws.amazon.com");
    expect(body).not.toContain("5arhuwacg4o48yxyin4kcrony");
  });
});
