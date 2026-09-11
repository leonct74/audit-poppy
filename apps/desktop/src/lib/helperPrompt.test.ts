/**
 * The helper prompt's four compliance rules (AGENTS.md §9), pinned — the
 * CrewPoppy reference pattern: a drifting hand-written prompt is worse than
 * none, so the tests hold it to the live catalogues.
 */
import { describe, expect, it } from "vitest";
import { checkCopy, POLICY_TEMPLATES } from "@auditpoppy/core";
import { buildHelperPrompt } from "./helperPrompt";
import { CHECK_SERVICES, HARD_RULES } from "./optionCatalog";

describe("the helper prompt", () => {
  const prompt = buildHelperPrompt();

  it("rule 1: is generated from the SAME catalogues the forms render", () => {
    for (const service of CHECK_SERVICES) {
      expect(prompt).toContain(service.label);
      expect(prompt).toContain(service.caution);
    }
    for (const template of POLICY_TEMPLATES) {
      expect(prompt).toContain(template.title);
      for (const field of template.fields.filter((f) => f.register === "customer-entered")) {
        expect(prompt, `${template.id}.${field.id}`).toContain(`${field.id}: ${field.label}`);
      }
    }
  });

  it("rule 2: states the non-negotiables as constraints to plan within", () => {
    for (const rule of HARD_RULES) expect(prompt).toContain(rule);
  });

  it("rule 3: demands a fixed answer shape mapping onto the form's fields", () => {
    expect(prompt).toContain("START THE AUDIT:");
    expect(prompt).toContain("POLICY ANSWERS:");
    expect(prompt).toContain("NOTES FOR MY AUDITOR:");
    expect(prompt).toContain("at most three clarifying questions");
  });

  it("rule 4: ends mid-sentence so the user's next words are their situation", () => {
    expect(prompt.endsWith("MY COMPANY AND SITUATION: ")).toBe(true);
  });

  it("obeys the naming and pricing laws", () => {
    expect(checkCopy(prompt)).toEqual([]);
  });
});

describe("the copy affordance", () => {
  it("falls back when the async Clipboard API is blocked", async () => {
    // AuditPoppy runs inside the host's webview, where clipboard-write may not be delegated.
    // The original banner called navigator.clipboard directly and swallowed the rejection: the
    // label never changed and nothing told the user. A copy button that silently fails is a
    // dead button (AGENTS.md §9).
    const { copyText } = await import("./clipboard");
    const original = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { writeText: () => Promise.reject(new Error("blocked")) } },
      configurable: true,
    });
    let selected = false;
    globalThis.document = {
      createElement: () => ({ style: {}, setAttribute: () => {}, select: () => (selected = true), value: "" }),
      body: { appendChild: () => {}, removeChild: () => {} },
      execCommand: () => true,
    } as unknown as Document;

    await expect(copyText("hello")).resolves.toBe(true);
    expect(selected).toBe(true);
    Object.defineProperty(globalThis, "navigator", { value: original, configurable: true });
  });

  it("reports failure rather than pretending, when both paths fail", async () => {
    const { copyText } = await import("./clipboard");
    const original = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { writeText: () => Promise.reject(new Error("blocked")) } },
      configurable: true,
    });
    globalThis.document = {
      createElement: () => {
        throw new Error("no DOM");
      },
    } as unknown as Document;
    await expect(copyText("hello")).resolves.toBe(false);
    Object.defineProperty(globalThis, "navigator", { value: original, configurable: true });
  });
});
