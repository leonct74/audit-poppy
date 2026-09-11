/**
 * A tiny, dependency-free PDF writer for text documents — enough for the gap
 * report, the policy pack and the auditor export, generated locally (in the
 * poppy UI or the sidecar), never by a cloud service (DESIGN §3).
 *
 * Four standard fonts carry the register discipline (DESIGN §2.4):
 *   - Helvetica          → platform voice / platform-observed facts
 *   - Helvetica-Bold     → headings
 *   - Helvetica-Oblique  → customer-entered statements (visibly distinct)
 *   - Courier            → data (ids, ARNs, timestamps)
 *
 * Uncompressed streams, standard 14 fonts only — every viewer renders these.
 */

export type PdfFont = "regular" | "bold" | "italic" | "mono";

export interface PdfBlock {
  text: string;
  font?: PdfFont;
  size?: number;
  /** Extra vertical space before the block, in points. */
  spaceBefore?: number;
  /** Gray level 0 (black) – 1 (white). */
  gray?: number;
}

export interface PdfDocumentSpec {
  title: string;
  /** Printed on every page's footer when set (the licensing watermark). */
  watermark?: string;
  blocks: PdfBlock[];
}

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 54;
const FOOTER_H = 30;

const FONT_RES: Record<PdfFont, { res: string; base: string; widthEm: number }> = {
  regular: { res: "F1", base: "Helvetica", widthEm: 0.52 },
  bold: { res: "F2", base: "Helvetica-Bold", widthEm: 0.55 },
  italic: { res: "F3", base: "Helvetica-Oblique", widthEm: 0.52 },
  mono: { res: "F4", base: "Courier", widthEm: 0.6 },
};

function escapePdfText(s: string): string {
  // Standard-font PDFs are WinAnsi; replace what can't encode, escape delimiters.
  return s
    .replace(/[\\()]/g, (c) => `\\${c}`)
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[—–]/g, "-")
    .replace(/[≈]/g, "~")
    .replace(/[↔→]/g, "-")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
}

function wrap(text: string, font: PdfFont, size: number, maxWidth: number): string[] {
  const charW = FONT_RES[font].widthEm * size;
  const maxChars = Math.max(8, Math.floor(maxWidth / charW));
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.trim() === "") {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line === "" ? word : `${line} ${word}`;
      if (candidate.length <= maxChars) {
        line = candidate;
      } else {
        if (line !== "") out.push(line);
        // A single over-long token (an ARN) hard-wraps.
        let rest = word;
        while (rest.length > maxChars) {
          out.push(rest.slice(0, maxChars));
          rest = rest.slice(maxChars);
        }
        line = rest;
      }
    }
    out.push(line);
  }
  return out;
}

interface Line {
  text: string;
  font: PdfFont;
  size: number;
  gray: number;
  spaceBefore: number;
}

/** Build the PDF bytes. */
export function buildPdf(spec: PdfDocumentSpec): Uint8Array {
  const contentWidth = PAGE_W - 2 * MARGIN;

  // 1. Flatten blocks into wrapped lines.
  const lines: Line[] = [];
  for (const block of spec.blocks) {
    const font = block.font ?? "regular";
    const size = block.size ?? 10.5;
    const wrapped = wrap(block.text, font, size, contentWidth);
    wrapped.forEach((text, i) => {
      lines.push({ text, font, size, gray: block.gray ?? 0, spaceBefore: i === 0 ? block.spaceBefore ?? 0 : 0 });
    });
  }

  // 2. Paginate.
  const pages: Line[][] = [];
  let current: Line[] = [];
  let y = PAGE_H - MARGIN;
  const bottom = MARGIN + FOOTER_H;
  for (const line of lines) {
    const lineHeight = line.size * 1.35;
    if (y - line.spaceBefore - lineHeight < bottom && current.length > 0) {
      pages.push(current);
      current = [];
      y = PAGE_H - MARGIN;
    }
    y -= line.spaceBefore + lineHeight;
    current.push(line);
  }
  pages.push(current);

  // 3. Content stream per page.
  const contentStreams = pages.map((pageLines, pageIndex) => {
    let stream = "";
    let cy = PAGE_H - MARGIN;
    for (const line of pageLines) {
      const lineHeight = line.size * 1.35;
      cy -= line.spaceBefore + lineHeight;
      if (line.text !== "") {
        stream += `BT /${FONT_RES[line.font].res} ${line.size} Tf ${line.gray.toFixed(2)} g ${MARGIN} ${cy.toFixed(2)} Td (${escapePdfText(line.text)}) Tj ET\n`;
      }
    }
    // Footer: watermark (when unlicensed) + page number, on every page.
    const footerY = MARGIN - 10;
    if (spec.watermark) {
      stream += `BT /F3 8 Tf 0.45 g ${MARGIN} ${footerY} Td (${escapePdfText(spec.watermark)}) Tj ET\n`;
    }
    const pageLabel = `Page ${pageIndex + 1} of ${pages.length}`;
    stream += `BT /F1 8 Tf 0.45 g ${PAGE_W - MARGIN - pageLabel.length * 4.2} ${footerY} Td (${escapePdfText(pageLabel)}) Tj ET\n`;
    return stream;
  });

  // 4. Assemble objects: 1 catalog, 2 pages, 3-6 fonts, then per page (page, content).
  const objects: string[] = [];
  const fontIds: Record<PdfFont, number> = { regular: 3, bold: 4, italic: 5, mono: 6 };
  const firstPageObj = 7;
  const kids = pages.map((_, i) => `${firstPageObj + i * 2} 0 R`).join(" ");
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  (Object.keys(fontIds) as PdfFont[]).forEach((font) => {
    objects[fontIds[font]] = `<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_RES[font].base} /Encoding /WinAnsiEncoding >>`;
  });
  const fontDict = `<< ${(Object.keys(fontIds) as PdfFont[]).map((f) => `/${FONT_RES[f].res} ${fontIds[f]} 0 R`).join(" ")} >>`;
  pages.forEach((_, i) => {
    const pageId = firstPageObj + i * 2;
    const contentId = pageId + 1;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font ${fontDict} >> /Contents ${contentId} 0 R >>`;
    const stream = contentStreams[i] ?? "";
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
  });

  // 5. Serialize with xref.
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefStart = out.length;
  const count = objects.length;
  out += `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id++) {
    out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  // latin-1 encode (all chars are <= 0xff after escaping).
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
