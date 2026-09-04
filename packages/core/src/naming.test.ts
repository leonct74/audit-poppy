/**
 * The naming law (DESIGN §0) + pricing law (DESIGN §8), test-pinned — like the
 * platform dossier pins its copy. The scan walks every SHIPPED source file in
 * the repo, so a forbidden phrase or a hardcoded dollar amount anywhere in the
 * poppy fails CI, whoever wrote it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { APPROVED, checkCopy } from "./naming";

describe("checkCopy", () => {
  it("flags the forbidden certification claims", () => {
    expect(checkCopy("Become SOC 2 compliant today!")).toHaveLength(1);
    expect(checkCopy("SOC 2 certified evidence")).toHaveLength(1);
    expect(checkCopy("Get certified in weeks")).toHaveLength(1);
    expect(checkCopy("your SOC2-compliant cloud")).toHaveLength(1);
  });

  it("accepts the approved vocabulary", () => {
    expect(checkCopy(APPROVED.productLine)).toHaveLength(0);
    expect(checkCopy(APPROVED.whatItSells)).toHaveLength(0);
    expect(checkCopy(APPROVED.mappedTo)).toHaveLength(0);
    expect(checkCopy("audit-ready evidence, mapped to the SOC 2 Trust Services Criteria")).toHaveLength(0);
  });

  it("flags hardcoded dollar amounts but allows the $0 state", () => {
    expect(checkCopy("only $499/yr")).toHaveLength(1);
    expect(checkCopy("about $ 15 per month")).toHaveLength(1);
    expect(checkCopy("$0 — nothing running, nothing billing")).toHaveLength(0);
  });
});

describe("the repo-wide scan (both laws bind every shipped word)", () => {
  const repoRoot = join(__dirname, "..", "..", "..");
  // Shipped source only. Docs (DESIGN.md, phase logs) discuss the laws and are
  // allowed to quote them; tests quote violations on purpose.
  const SCAN_DIRS = [
    "packages/core/src",
    "apps/desktop/src",
    "apps/desktop/node-sidecar/src",
    "lambdas/src",
  ];
  const SCAN_FILES = ["apps/desktop/extension.json", "apps/desktop/index.html", "README.md"];
  const EXT = new Set([".ts", ".tsx", ".json", ".html", ".css", ".md"]);

  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === "node_modules" || name === "dist" || name === "generated" || name === "vendor") continue;
        walk(p);
      } else if (EXT.has(extname(p)) && !/\.test\.tsx?$/.test(p)) {
        files.push(p);
      }
    }
  };
  for (const d of SCAN_DIRS) walk(join(repoRoot, d));
  for (const f of SCAN_FILES) {
    try {
      if (statSync(join(repoRoot, f)).isFile()) files.push(join(repoRoot, f));
    } catch {
      /* not created yet — fine */
    }
  }

  it("finds files to scan", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  /**
   * The laws bind what a USER reads, not what developers write to each other:
   * a code comment saying the bootstrap carries "the resolved AWS account" is
   * accurate and must stay. So comments come out before the scan; strings,
   * JSX text and markdown stay in.
   */
  const stripComments = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

  it("finds no forbidden phrase, hardcoded price or AWS-only wording in shipped copy", () => {
    const problems: string[] = [];
    for (const file of files) {
      const text = stripComments(readFileSync(file, "utf8"));
      for (const v of checkCopy(text)) {
        problems.push(`${file}: "${v.phrase}" → ${v.instead}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

/**
 * This repository is going PUBLIC, and its git history goes with it (CLAUDE.md).
 * A checklist would be forgotten, so the rule is a test.
 *
 * A cloud account id is not a secret, but it is the seed for cross-account role probing,
 * bucket-name guessing and support-desk social engineering — and it buys a reader of an
 * open-source compliance tool exactly nothing. AWS's own documented example ids are the
 * way to write one down.
 */
describe("nothing identifying may reach a repo that is going public", () => {
  const repoRoot = join(__dirname, "..", "..", "..");
  const EXT = new Set([".ts", ".tsx", ".mjs", ".js", ".json", ".html", ".css", ".md", ".yml", ".yaml"]);
  const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "generated", "vendor", "coverage"]);
  // The ids AWS itself uses in public documentation. Anything else that shape is a real one.
  const EXAMPLE_IDS = new Set(["111122223333", "123456789012", "444455556666", "555555555555"]);

  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (SKIP_DIRS.has(name) || name === "package-lock.json") continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (EXT.has(extname(p))) files.push(p);
    }
  };
  walk(repoRoot);

  it("scans the whole repository, docs included — the leak was in a doc", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith("DESIGN.md"))).toBe(true);
  });

  it("contains no real cloud account id", () => {
    const found: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/(?<![0-9A-Za-z_-])(\d{12})(?![0-9A-Za-z_-])/g)) {
        if (!EXAMPLE_IDS.has(m[1])) {
          const line = text.slice(0, m.index).split("\n").length;
          found.push(`${file.slice(repoRoot.length + 1)}:${line} — use a placeholder or an AWS example id`);
        }
      }
    }
    expect(found).toEqual([]);
  });
});
