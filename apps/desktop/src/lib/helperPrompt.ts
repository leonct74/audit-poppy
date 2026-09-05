/**
 * The helper prompt (AGENTS.md §9 — REQUIRED on the primary configuration
 * surface). The user pastes it into whatever AI they already use, adds one
 * sentence about their company, and gets back exactly what to tick and type
 * in AuditPoppy. The four rules:
 *   1. GENERATED from the same catalogues the forms render (never a parallel
 *      hand-written text) — CHECK_SERVICES + the live policy templates.
 *   2. States the poppy's non-negotiables as constraints to plan within.
 *   3. Demands a fixed answer shape mapping 1:1 onto the form's fields.
 *   4. Ends mid-sentence so the user's next words are their situation.
 */
import { POLICY_TEMPLATES } from "@auditpoppy/core";
import { CHECK_SERVICES, HARD_RULES } from "./optionCatalog";

export function buildHelperPrompt(): string {
  const services = CHECK_SERVICES.map((s) => `- ${s.label}: ${s.what} (${s.caution})`).join("\n");
  const policies = POLICY_TEMPLATES.map((t) => {
    const fields = t.fields
      .filter((f) => f.register === "customer-entered")
      .map((f) => `    - ${f.id}: ${f.label}${f.suggestion ? ` (a common answer: "${f.suggestion}")` : ""}`)
      .join("\n");
    return `- ${t.title} (${t.purpose})\n${fields}`;
  }).join("\n");

  return `You are helping me set up AuditPoppy, an app that gets my cloud account audit-ready for a SOC 2 audit from inside my own cloud account. Plan WITHIN these rules — they are how the app works, not preferences:
${HARD_RULES.map((r) => `- ${r}`).join("\n")}

It can enable these two cloud services (my choice, costs shown first):
${services}

It also pre-fills these written policies from what it observes; I answer the company-specific fields:
${policies}

Ask me at most three clarifying questions if you need them. Then answer in EXACTLY this shape, so I can copy each line into the app:
START THE AUDIT: yes / not yet — one line on why
POLICY ANSWERS:
<policy title>:
  <fieldId>: <my answer>
(one block per policy, every field filled)
NOTES FOR MY AUDITOR: up to three short bullet points I should add in the Export tab

MY COMPANY AND SITUATION: `;
}
