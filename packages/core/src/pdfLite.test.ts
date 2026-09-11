import { describe, expect, it } from "vitest";
import { buildPdf } from "./pdfLite";

const asText = (b: Uint8Array): string => Buffer.from(b).toString("latin1");

describe("pdfLite", () => {
  it("emits a structurally sound single-page document", () => {
    const pdf = asText(buildPdf({ title: "t", blocks: [{ text: "Hello auditor" }] }));
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("/Type /Catalog");
    expect(pdf).toContain("/Count 1");
    expect(pdf).toContain("(Hello auditor) Tj");
    expect(pdf).toContain("startxref");
  });

  it("escapes PDF delimiters and folds unencodable characters", () => {
    const pdf = asText(buildPdf({ title: "t", blocks: [{ text: "a(b)c\\d — “e” ✓" }] }));
    expect(pdf).toContain("a\\(b\\)c\\\\d");
    expect(pdf).not.toMatch(/[“”—✓]/);
  });

  it("paginates long content and numbers every page", () => {
    const blocks = Array.from({ length: 300 }, (_, i) => ({ text: `Line ${i} of a very long report body.` }));
    const pdf = asText(buildPdf({ title: "t", blocks }));
    const count = pdf.match(/\/Count (\d+)/)?.[1];
    expect(Number(count)).toBeGreaterThan(1);
    expect(pdf).toContain(`(Page 1 of ${count}) Tj`);
    expect(pdf).toContain(`(Page ${count} of ${count}) Tj`);
  });

  it("prints the watermark on every page when set", () => {
    const blocks = Array.from({ length: 300 }, (_, i) => ({ text: `Line ${i}` }));
    const pdf = asText(buildPdf({ title: "t", watermark: "for personal use only", blocks }));
    const count = Number(pdf.match(/\/Count (\d+)/)?.[1]);
    const marks = pdf.match(/\(for personal use only\) Tj/g)?.length ?? 0;
    expect(marks).toBe(count);
  });
});
