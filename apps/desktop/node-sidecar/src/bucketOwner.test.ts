import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { evidenceBucketRef } from "./template";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The bug this guards was one missing field at one call site, and it would have put
 * attacker-authored JSON into a document destined for an auditor. A code review catches it
 * once; this catches it every time. It reads the source rather than mocking S3 because the
 * failure is textual — someone writes `Bucket: <name>` and stops there.
 */
describe("every S3 call asserts who owns the bucket", () => {
  const files = readdirSync(HERE)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "testUtil.ts")
    .map((f) => ({ name: f, text: readFileSync(join(HERE, f), "utf8") }));

  it("never names the evidence bucket in a command without spreading the owner with it", () => {
    // `Bucket:` is allowed only as part of a ref spread (`...evidenceBucketRef(x)` supplies
    // both fields) or inside the CloudFormation template, where the field is CFN's, not S3's.
    const offenders: string[] = [];
    for (const { name, text } of files) {
      if (name === "template.ts") continue; // defines the pair; its own `Bucket:` is CFN's
      for (const [i, line] of text.split("\n").entries()) {
        if (!/\bBucket:\s/.test(line)) continue;
        offenders.push(`${name}:${i + 1} ${line.trim()}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `Spread evidenceBucketRef(accountId) instead of passing Bucket alone:\n${offenders.join("\n")}`,
    );
  });

  it("hands back both halves together, so a caller cannot take one", () => {
    assert.deepEqual(evidenceBucketRef("111122223333"), {
      Bucket: "auditpoppy-evidence-111122223333",
      ExpectedBucketOwner: "111122223333",
    });
  });
});
